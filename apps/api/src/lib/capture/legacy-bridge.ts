import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { CaptureAttemptStage, CaptureErrorCode, CaptureProcessingState, CaptureRetryEnvelope, InterpretResponse } from '@jevi-ops/shared';
import { capture_attempts, capture_media, capture_receipts, captured_data } from '../../db/schema.js';
import { getAppSettings } from '../app-settings.js';
import type { Db } from '../db.js';
import { executeActions, type ActionResult } from '../executor.js';
import { assertApprovedEndpoint, InferencePolicyError } from '../inference-policy.js';
import { isLlmConfigured, llmBaseUrl } from '../llm.js';
import { inTransaction, type DbOrTx, type Tx } from '../maintenance-tx.js';
import { parseTranscript, type ParsedAction } from '../parser.js';
import { isSttConfigured, sttBaseUrl, transcribeAudio } from '../stt.js';
import { envelopeDigest } from './digest.js';
import { withOperation } from './ledger.js';
import { readCaptureMedia } from './media-store.js';
import { type CaptureActor, CaptureError, retryPermitted } from './service.js';

// TRANSITIONAL: removed in Gate C, when the asynchronous consumer and the
// replay-safe command registry take over interpretation.
//
// The conservative bridge runs the legacy parser + executor over a capture
// that is already durably stored. It is deliberately NOT replay-safe: the
// executor is non-transactional and non-idempotent, so the bridge only
// promises that effects are never applied twice by *this* code path:
//
//   * one persisted attempt at a time, identified by a random token;
//   * every stage transition is a fenced UPDATE (token + expected stage), so
//     a superseded attempt can never reach `executing`;
//   * a stale attempt is reclaimed only while it is provably pre-effect
//     (pending / transcribing / parsing). One that died in executing or
//     recording becomes `needs_review / execution_uncertain` and is never
//     rerun automatically;
//   * the parsed plan is persisted before execution, external actions are
//     excluded from automatic execution, and any per-action failure routes
//     the capture to review instead of "committed".
//
// Local-only policy: every STT/LLM call first checks the configured endpoint
// against lib/inference-policy.ts. An unapproved endpoint blocks the capture
// and sends nothing.

export const STALE_ATTEMPT_MS = 120_000;
export const HEARTBEAT_MS = 30_000;
// Actions with effects outside this database; Gate C gives them their own
// approval + reconciliation model. Here they are routed to review.
export const EXTERNAL_ACTIONS = new Set(['create_calendar_event']);

// Failure injection for tests: throw between execution and recording.
export const bridgeHooks: { afterExecute?: (captureId: string) => Promise<void> | void } = {};

type ReceiptRow = typeof capture_receipts.$inferSelect;
type AttemptRow = typeof capture_attempts.$inferSelect;
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const nowIso = () => new Date().toISOString();

function response(receipt: ReceiptRow, attemptNo: number, replayed: boolean): InterpretResponse {
  return { capture_id: receipt.capture_id, attempt_no: attemptNo, processing_state: receipt.processing_state, outcome: receipt.outcome ?? null, error_code: receipt.error_code ?? null, replayed };
}

async function latestAttempt(tx: DbOrTx, captureId: string): Promise<AttemptRow | undefined> {
  const [row] = await tx.select().from(capture_attempts).where(eq(capture_attempts.capture_id, captureId)).orderBy(desc(capture_attempts.attempt_no)).limit(1);
  return row;
}

function stale(attempt: AttemptRow, now: number): boolean {
  return now - Date.parse(attempt.heartbeat_at) > STALE_ATTEMPT_MS;
}

/** Fenced stage transition. Returns false when the attempt no longer owns the capture. */
export async function advanceAttempt(db: DbOrTx, captureId: string, attemptNo: number, token: string, from: CaptureAttemptStage, to: CaptureAttemptStage, extra: Partial<{ plan: unknown; effects: unknown }> = {}): Promise<boolean> {
  const rows = await db.update(capture_attempts)
    .set({ stage: to, stage_changed_at: nowIso(), heartbeat_at: nowIso(), ...extra })
    .where(and(eq(capture_attempts.capture_id, captureId), eq(capture_attempts.attempt_no, attemptNo), eq(capture_attempts.attempt_token_hash, hash(token)), eq(capture_attempts.stage, from)))
    .returning({ attempt_no: capture_attempts.attempt_no });
  return rows.length === 1;
}

interface Started { kind: 'started'; attemptNo: number; token: string; receipt: ReceiptRow; payload: Record<string, unknown> }
interface Settled { kind: 'settled'; response: InterpretResponse }

async function markUncertain(tx: Tx, receipt: ReceiptRow, attempt: AttemptRow, reason: string): Promise<ReceiptRow> {
  await tx.update(capture_attempts).set({ stage: 'finished', error_code: 'execution_uncertain', finished_at: nowIso() })
    .where(and(eq(capture_attempts.capture_id, receipt.capture_id), eq(capture_attempts.attempt_no, attempt.attempt_no)));
  const [updated] = await tx.update(capture_receipts).set({
    processing_state: 'needs_review', error_code: 'execution_uncertain', updated_at: nowIso(),
    outcome: { status: 'execution_uncertain', reason, attempt_no: attempt.attempt_no, plan: attempt.plan ?? null, effects: attempt.effects ?? null },
  }).where(eq(capture_receipts.capture_id, receipt.capture_id)).returning();
  return updated!;
}

/**
 * Claim the capture for a new attempt inside the caller's transaction.
 * Returns the started attempt, or the settled state to report instead.
 */
async function startAttempt(tx: Tx, captureId: string, actor: CaptureActor, opts: { reason: 'initial' | 'retry'; operationId: string; expectedAttemptNo?: number; now: number }): Promise<Started | Settled> {
  const [row] = await tx.select({ receipt: capture_receipts, raw: captured_data }).from(capture_receipts)
    .innerJoin(captured_data, eq(captured_data.id, capture_receipts.capture_id)).where(eq(capture_receipts.capture_id, captureId)).for('update', { of: capture_receipts });
  if (!row || (actor.restrictToCredential && row.receipt.credential_id !== actor.credentialId)) throw new CaptureError(404, 'capture_not_found', 'Capture not found.');
  const receipt = row.receipt;
  if ((await getAppSettings()).capture_async_enabled) throw new CaptureError(409, 'capture_async_owned', 'Interpretation is owned by the asynchronous consumer while capture_async_enabled is on.');
  if (receipt.processing_state === 'cancelled') throw new CaptureError(409, 'capture_cancelled', 'This capture was cancelled.');
  if (receipt.processing_state === 'awaiting_media') throw new CaptureError(409, 'capture_not_ready', 'Upload and finalize the media before interpreting.');
  const attempt = await latestAttempt(tx, captureId);

  if (receipt.processing_state === 'interpreting') {
    if (!attempt || !stale(attempt, opts.now)) throw new CaptureError(409, 'capture_busy', 'An interpretation attempt is already running.');
    if (attempt.stage === 'executing' || attempt.stage === 'recording') {
      // Effects may have been applied; never rerun automatically.
      const updated = await markUncertain(tx, receipt, attempt, 'The previous attempt stopped after execution began and before its outcome was recorded.');
      return { kind: 'settled', response: response(updated, attempt.attempt_no, false) };
    }
    // Pre-effect stall (model hang, crash while transcribing/parsing): supersede.
    await tx.update(capture_attempts).set({ stage: 'finished', error_code: attempt.error_code ?? 'llm_unavailable', finished_at: nowIso() })
      .where(and(eq(capture_attempts.capture_id, captureId), eq(capture_attempts.attempt_no, attempt.attempt_no)));
  } else if (opts.reason === 'initial') {
    if (receipt.processing_state !== 'queued') return { kind: 'settled', response: response(receipt, receipt.current_attempt_no, true) };
  } else {
    if (!retryPermitted(receipt)) throw new CaptureError(409, 'retry_not_permitted', 'This capture cannot be retried automatically; review it instead.', { processing_state: receipt.processing_state, error_code: receipt.error_code });
    if (opts.expectedAttemptNo !== undefined && opts.expectedAttemptNo !== receipt.current_attempt_no) throw new CaptureError(409, 'attempt_conflict', 'The capture changed since you loaded it; refresh and retry.', { current_attempt_no: receipt.current_attempt_no });
  }

  const attemptNo = receipt.current_attempt_no + 1;
  if (receipt.kind === 'image') {
    // Preserved, never parsed here: image understanding is a Gate C capability.
    await tx.insert(capture_attempts).values({ capture_id: captureId, attempt_no: attemptNo, attempt_token_hash: hash(randomUUID()), operation_id: opts.operationId, stage: 'finished', error_code: 'image_processing_unavailable', finished_at: nowIso() });
    const [updated] = await tx.update(capture_receipts).set({ processing_state: 'blocked', error_code: 'image_processing_unavailable', current_attempt_no: attemptNo, updated_at: nowIso() }).where(eq(capture_receipts.capture_id, captureId)).returning();
    return { kind: 'settled', response: response(updated!, attemptNo, false) };
  }
  const token = randomBytes(24).toString('base64url');
  await tx.insert(capture_attempts).values({ capture_id: captureId, attempt_no: attemptNo, attempt_token_hash: hash(token), operation_id: opts.operationId, stage: 'pending' });
  const [updated] = await tx.update(capture_receipts).set({ processing_state: 'interpreting', error_code: null, current_attempt_no: attemptNo, updated_at: nowIso() }).where(eq(capture_receipts.capture_id, captureId)).returning();
  return { kind: 'started', attemptNo, token, receipt: updated!, payload: row.raw.payload as Record<string, unknown> };
}

class Blocked extends Error {
  constructor(public code: CaptureErrorCode, public outcome: unknown = null, public state: CaptureProcessingState = 'blocked') { super(code); }
}

function providerFailure(kind: 'llm' | 'stt', err: unknown): Blocked {
  if (err instanceof InferencePolicyError) return new Blocked(err.code === 'endpoint_not_configured' ? (kind === 'llm' ? 'llm_not_configured' : 'stt_not_configured') : 'endpoint_not_approved');
  if (kind === 'llm') return new Blocked('llm_unavailable');
  const name = (err as { name?: string })?.name ?? '';
  return new Blocked(/Connection|Timeout|Abort/.test(name) ? 'stt_unavailable' : 'stt_failed');
}

const filenameFor = (mediaType: string) => `voice.${mediaType.includes('webm') ? 'webm' : mediaType.includes('mp4') || mediaType.includes('m4a') ? 'm4a' : mediaType.includes('wav') ? 'wav' : mediaType.includes('ogg') ? 'ogg' : 'webm'}`;

async function approvedBaseUrl(kind: 'llm' | 'stt'): Promise<void> {
  const configured = kind === 'llm' ? await isLlmConfigured() : await isSttConfigured();
  if (!configured) throw new InferencePolicyError('endpoint_not_configured', kind, `No ${kind} endpoint is configured.`);
  assertApprovedEndpoint(kind, kind === 'llm' ? await llmBaseUrl() : await sttBaseUrl());
}

/** Runs the pipeline for a started attempt. Every transition is fenced. */
async function runAttempt(db: Db, started: Started, log?: FastifyBaseLogger): Promise<InterpretResponse> {
  const { attemptNo, token, receipt } = started;
  const captureId = receipt.capture_id;
  const fence = async (from: CaptureAttemptStage, to: CaptureAttemptStage, extra?: Partial<{ plan: unknown; effects: unknown }>) => {
    if (!(await advanceAttempt(db, captureId, attemptNo, token, from, to, extra))) throw new Superseded();
  };
  const heartbeat = setInterval(() => {
    db.update(capture_attempts).set({ heartbeat_at: nowIso() })
      .where(and(eq(capture_attempts.capture_id, captureId), eq(capture_attempts.attempt_no, attemptNo), eq(capture_attempts.attempt_token_hash, hash(token))))
      .catch(() => {});
  }, HEARTBEAT_MS);
  heartbeat.unref();

  let stage: CaptureAttemptStage = 'pending';
  try {
    // ── transcript ──
    let transcript: string;
    if (receipt.kind === 'audio') {
      await fence('pending', 'transcribing'); stage = 'transcribing';
      try { await approvedBaseUrl('stt'); } catch (err) { throw providerFailure('stt', err); }
      const [media] = await db.select().from(capture_media).where(and(eq(capture_media.capture_id, captureId), eq(capture_media.state, 'verified')));
      if (!media?.storage_key) throw new Blocked('stt_failed');
      const bytes = await readCaptureMedia(media.storage_key);
      try { transcript = await transcribeAudio(bytes, filenameFor(media.media_type), media.media_type); }
      catch (err) { throw providerFailure('stt', err); }
      if (!transcript) throw new Blocked('parser_failed', { status: 'parse_error', error: 'empty_transcript', transcript: '' }, 'needs_review');
      await fence('transcribing', 'parsing'); stage = 'parsing';
    } else {
      transcript = typeof started.payload.text === 'string' ? started.payload.text : typeof started.payload.transcript === 'string' ? started.payload.transcript : '';
      if (!transcript.trim()) throw new Blocked('parser_failed', { status: 'parse_error', error: 'empty_transcript', transcript: '' }, 'needs_review');
      await fence('pending', 'parsing'); stage = 'parsing';
    }

    // ── parse ──
    try { await approvedBaseUrl('llm'); } catch (err) { throw providerFailure('llm', err); }
    let parsed: Awaited<ReturnType<typeof parseTranscript>>;
    try { parsed = await parseTranscript(transcript, db, { log }); }
    catch (err) { throw providerFailure('llm', err); }
    if (parsed.kind === 'error') throw new Blocked('parser_failed', { status: 'parse_error', error: parsed.error, transcript });
    if (parsed.kind === 'disambiguation') {
      await settle(db, captureId, attemptNo, token, stage, 'needs_review', null, { status: 'needs_disambiguation', field: parsed.field, candidates: parsed.candidates, transcript });
      return response(await reload(db, captureId), attemptNo, false);
    }
    const plan: ParsedAction[] = parsed.actions;
    const external = plan.filter((a) => EXTERNAL_ACTIONS.has(a.action));
    if (external.length > 0) {
      await settle(db, captureId, attemptNo, token, stage, 'needs_review', 'external_effect_requires_review', { status: 'needs_review', reason: 'external_effect_requires_review', actions: plan, transcript }, { plan });
      return response(await reload(db, captureId), attemptNo, false);
    }
    // ── execute (plan persisted in the same fenced transition) ──
    await fence('parsing', 'executing', { plan }); stage = 'executing';
    const modality = started.payload.modality;
    const effects: ActionResult[] = await executeActions(db, plan, { captureSource: modality === 'typed' ? 'text' : 'voice' });
    await bridgeHooks.afterExecute?.(captureId);
    await fence('executing', 'recording', { effects }); stage = 'recording';
    const allOk = effects.every((e) => e.status === 'success');
    const outcome = { status: 'executed', actions: effects, transcript };
    await settle(db, captureId, attemptNo, token, stage, allOk ? 'committed' : 'needs_review', allOk ? null : 'partial_execution', outcome, { effects });
    if (allOk) await db.update(captured_data).set({ processed_status: 'parsed' }).where(eq(captured_data.id, captureId));
    return response(await reload(db, captureId), attemptNo, false);
  } catch (err) {
    if (err instanceof Superseded) {
      log?.warn({ capture_id: captureId, attempt_no: attemptNo }, 'capture attempt superseded; no effects applied');
      return response(await reload(db, captureId), attemptNo, true);
    }
    if (stage === 'executing' || stage === 'recording') {
      // Effects may exist; record uncertainty instead of guessing.
      await inTransaction(db, async (tx) => {
        const [current] = await tx.select().from(capture_receipts).where(eq(capture_receipts.capture_id, captureId)).for('update');
        const attempt = await latestAttempt(tx, captureId);
        if (current && attempt && attempt.attempt_no === attemptNo) await markUncertain(tx, current, attempt, err instanceof Error ? err.message : 'unknown');
      });
      log?.error({ err, capture_id: captureId, attempt_no: attemptNo }, 'capture execution uncertain');
      return response(await reload(db, captureId), attemptNo, false);
    }
    const blocked = err instanceof Blocked ? err : new Blocked('parser_failed', { status: 'parse_error', error: err instanceof Error ? err.message : 'unknown', transcript: '' });
    await settle(db, captureId, attemptNo, token, stage, blocked.state, blocked.code, blocked.outcome);
    return response(await reload(db, captureId), attemptNo, false);
  } finally {
    clearInterval(heartbeat);
  }
}

class Superseded extends Error { constructor() { super('superseded'); } }

async function settle(db: Db, captureId: string, attemptNo: number, token: string, from: CaptureAttemptStage, state: CaptureProcessingState, errorCode: CaptureErrorCode | null, outcome: unknown, extra: Partial<{ plan: unknown; effects: unknown }> = {}): Promise<void> {
  await inTransaction(db, async (tx) => {
    const owned = await advanceAttempt(tx, captureId, attemptNo, token, from, 'finished', extra);
    if (!owned) throw new Superseded();
    await tx.update(capture_attempts).set({ error_code: errorCode, finished_at: nowIso() }).where(and(eq(capture_attempts.capture_id, captureId), eq(capture_attempts.attempt_no, attemptNo)));
    await tx.update(capture_receipts).set({ processing_state: state, error_code: errorCode, outcome, updated_at: nowIso() }).where(eq(capture_receipts.capture_id, captureId));
  });
}

async function reload(db: DbOrTx, captureId: string): Promise<ReceiptRow> {
  const [row] = await db.select().from(capture_receipts).where(eq(capture_receipts.capture_id, captureId));
  if (!row) throw new CaptureError(404, 'capture_not_found', 'Capture not found.');
  return row;
}

/** Initial interpretation of a queued capture (web save-then-interpret). */
export async function interpretCapture(db: Db, captureId: string, actor: CaptureActor, opts: { log?: FastifyBaseLogger; now?: number } = {}): Promise<InterpretResponse> {
  const started = await inTransaction(db, (tx) => startAttempt(tx, captureId, actor, { reason: 'initial', operationId: randomUUID(), now: opts.now ?? Date.now() }));
  if (started.kind === 'settled') return started.response;
  return runAttempt(db, started, opts.log);
}

/** Explicit retry: new operation identity, same capture, pre-effect failures only. */
export async function retryInterpretation(db: Db, envelope: CaptureRetryEnvelope, actor: CaptureActor, opts: { log?: FastifyBaseLogger; now?: number } = {}): Promise<InterpretResponse> {
  const digest = envelopeDigest(envelope as unknown as Record<string, unknown>);
  const captureId = envelope.payload.capture_id;
  // The ledger memoises that this retry operation started attempt N. The
  // attempt row carries the outcome, so a replayed retry never starts a
  // second run; the token stays in this closure for the run below.
  let started: Started | null = null;
  const result = await withOperation<{ attempt_no: number; settled: InterpretResponse | null }>(db, {
    operationId: envelope.operation_id, command: envelope.command, protocolVersion: envelope.protocol_version,
    actor: actor.actor, credentialId: actor.credentialId, restrictToCredential: actor.restrictToCredential, digest,
  }, async (tx) => {
    const s = await startAttempt(tx, captureId, actor, { reason: 'retry', operationId: envelope.operation_id, expectedAttemptNo: envelope.payload.expected_attempt_no, now: opts.now ?? Date.now() });
    if (s.kind === 'settled') return { disposition: 'applied', status: 200, result: { attempt_no: s.response.attempt_no, settled: s.response }, resourceRef: `capture:${captureId}` };
    started = s;
    return { disposition: 'applied', status: 200, result: { attempt_no: s.attemptNo, settled: null }, resourceRef: `capture:${captureId}` };
  });
  if (result.replayed) return response(await reload(db, captureId), result.result.attempt_no, true);
  if (result.result.settled) return result.result.settled;
  if (!started) return response(await reload(db, captureId), result.result.attempt_no, true);
  return runAttempt(db, started, opts.log);
}
