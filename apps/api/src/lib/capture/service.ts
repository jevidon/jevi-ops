import { and, asc, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { z } from 'zod';
import {
  CAPTURE_MEDIA_MAX_BYTES, CAPTURE_PROTOCOL_VERSION, type CaptureSourceSchema, type IngestRequestSchema,
  type CaptureAttachmentReservation, type CaptureCreateEnvelope, type CaptureDetail, type CaptureFinalizeEnvelope,
  type CaptureListState, type CaptureMediaType, type CaptureModality, type CaptureReceipt, type CaptureReceiptResponse,
  type CaptureProcessingState,
} from '@jevi-ops/shared';

type CaptureSource = z.infer<typeof CaptureSourceSchema>;
type IngestRequest = z.infer<typeof IngestRequestSchema>;
import { capture_attempts, capture_media, capture_receipts, captured_data } from '../../db/schema.js';
import { CommandError } from '../command-error.js';
import { inTransaction, type DbOrTx } from '../maintenance-tx.js';
import { envelopeDigest } from './digest.js';
import { CaptureMediaError, readCaptureMedia, validateMediaBytes, verifyStoredMedia, writeVerifiedMedia } from './media-store.js';
import { readOperation, withOperation, type OperationContext } from './ledger.js';

// Durable capture acceptance. This module is inference-free BY CONSTRUCTION:
// it must never import the parser, executor, STT, LLM, storage (geocoding),
// Google, or notification modules. test/capture-accept.test.ts enforces that
// statically and with runtime spies. Interpretation lives in
// legacy-bridge.ts (transitional) and, later, the Gate C consumer.

export class CaptureError extends Error {
  constructor(public status: number, public code: string, message: string, public details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'CaptureError';
  }
}

export interface CaptureActor {
  /** Server-derived: "session:<email>", "token:<name>", or "ingest:webhook". */
  actor: string;
  credentialId: string | null;
  /** capture_client credentials see only their own captures/operations. */
  restrictToCredential: boolean;
  log?: FastifyBaseLogger;
}

type ReceiptRow = typeof capture_receipts.$inferSelect;
type MediaRow = typeof capture_media.$inferSelect;
type RawRow = typeof captured_data.$inferSelect;

const defaultModality: Record<CaptureCreateEnvelope['payload']['kind'], CaptureModality> = { text: 'typed', audio: 'spoken', image: 'photo' };

function uploadSlots(media: MediaRow[]) {
  return media.filter((m) => m.state !== 'verified').map((m) => ({
    attachment_id: m.attachment_id, put_url: `/api/capture-uploads/${m.attachment_id}`, max_bytes: CAPTURE_MEDIA_MAX_BYTES, resumable: false as const,
  }));
}

function buildReceipt(receipt: ReceiptRow, media: MediaRow[], identity: { dataSpaceId: string; serverEpoch: number }): CaptureReceipt {
  return {
    capture_id: receipt.capture_id,
    operation_id: receipt.operation_id,
    data_space_id: identity.dataSpaceId,
    server_epoch: identity.serverEpoch,
    receipt_kind: receipt.storage_state === 'complete' ? 'server_saved' : 'awaiting_media',
    storage_state: receipt.storage_state,
    processing_state: receipt.processing_state,
    created_at: receipt.created_at,
    uploads: uploadSlots(media),
  };
}

function operationContext(actor: CaptureActor, envelope: { operation_id: string; command: string; protocol_version: number }, digest: string): OperationContext {
  return {
    operationId: envelope.operation_id, command: envelope.command, protocolVersion: envelope.protocol_version,
    actor: actor.actor, credentialId: actor.credentialId, restrictToCredential: actor.restrictToCredential, digest,
  };
}

function authorized(receipt: ReceiptRow | null | undefined, actor: CaptureActor): boolean {
  if (!actor.restrictToCredential) return true;
  return Boolean(receipt && receipt.credential_id === actor.credentialId);
}

// ─── capture.create ───────────────────────────────────────────────────────

export async function acceptCapture(db: DbOrTx, envelope: CaptureCreateEnvelope, actor: CaptureActor, options: { source?: CaptureSource } = {}) {
  const digest = envelopeDigest(envelope as unknown as Record<string, unknown>);
  const p = envelope.payload;
  const attachments = p.attachments ?? [];
  const result = await withOperation<CaptureReceiptResponse | { error: string; capture_id: string }>(db, operationContext(actor, envelope, digest), async (tx, identity) => {
    const [existing] = await tx.select({ id: captured_data.id }).from(captured_data).where(eq(captured_data.id, p.capture_id));
    if (existing) {
      // Same capture id under a different operation: memoised as a conflict so
      // the retry of THIS operation keeps failing the same way.
      return { disposition: 'conflict', status: 409, result: { error: 'capture_id_conflict', capture_id: p.capture_id }, resourceRef: `capture:${p.capture_id}` };
    }
    const hasMedia = attachments.length > 0;
    const [raw] = await tx.insert(captured_data).values({
      id: p.capture_id,
      source: options.source ?? 'manual',
      type: `capture_${p.kind}`,
      payload: {
        kind: p.kind, intent: p.intent, modality: p.modality ?? defaultModality[p.kind], text: p.text ?? null,
        captured_at: p.captured_at, time_zone: p.time_zone ?? null, client: p.client, source_item_id: p.source_item_id ?? null,
        attachments: attachments.map((a) => a.attachment_id),
      },
      tags: p.tags ?? [],
      display_hint: 'log',
      processed_status: 'raw',
    }).returning({ id: captured_data.id, created_at: captured_data.created_at });
    if (!raw) throw new Error('insert_returned_no_row');
    const [receipt] = await tx.insert(capture_receipts).values({
      capture_id: p.capture_id, data_space_id: identity.dataSpaceId, operation_id: envelope.operation_id,
      actor: actor.actor, credential_id: actor.credentialId, client: p.client, source_item_id: p.source_item_id ?? null,
      kind: p.kind, intent: p.intent, modality: p.modality ?? defaultModality[p.kind], captured_at: p.captured_at, time_zone: p.time_zone ?? null,
      storage_state: hasMedia ? 'awaiting_media' : 'complete', processing_state: hasMedia ? 'awaiting_media' : 'queued',
    }).returning();
    if (!receipt) throw new Error('insert_returned_no_row');
    const media = hasMedia
      ? await tx.insert(capture_media).values(attachments.map((a: CaptureAttachmentReservation) => ({
        attachment_id: a.attachment_id, capture_id: p.capture_id, media_type: a.media_type, size_bytes: a.size_bytes, sha256: a.sha256,
      }))).returning()
      : [];
    return {
      disposition: 'applied', status: 201,
      result: { receipt: buildReceipt(receipt, media, identity), replayed: false },
      resourceRef: `capture:${p.capture_id}`,
    };
  });
  return { status: result.status, replayed: result.replayed, body: 'error' in (result.result as object) ? result.result : { ...(result.result as CaptureReceiptResponse), replayed: result.replayed } };
}

// ─── Legacy webhook ingest through the same ledger ────────────────────────

export async function acceptIngestEnvelope(db: DbOrTx, body: IngestRequest & { operation_id: string }, actor: CaptureActor) {
  const { operation_id, ...content } = body;
  const envelope = { protocol_version: CAPTURE_PROTOCOL_VERSION, operation_id, command: 'ingest.create', payload: content };
  const digest = envelopeDigest(envelope);
  const text = typeof content.payload.text === 'string' ? content.payload.text : typeof content.payload.transcript === 'string' ? content.payload.transcript : null;
  const result = await withOperation<{ id: string; created_at: string }>(db, operationContext(actor, envelope, digest), async (tx, identity) => {
    const [raw] = await tx.insert(captured_data).values({
      source: content.source, type: content.type, payload: content.payload, tags: content.tags ?? [],
      display_hint: content.display_hint ?? 'log', source_ref: content.source_ref ?? null,
    }).returning({ id: captured_data.id, created_at: captured_data.created_at });
    if (!raw) throw new Error('insert_returned_no_row');
    await tx.insert(capture_receipts).values({
      capture_id: raw.id, data_space_id: identity.dataSpaceId, operation_id, actor: actor.actor, credential_id: null,
      client: { name: 'ingest', surface: content.source }, source_item_id: content.source_ref ?? null,
      kind: 'text', intent: 'capture_only', modality: text ? 'typed' : null, captured_at: raw.created_at, time_zone: null,
      storage_state: 'complete', processing_state: 'queued',
    });
    return { disposition: 'applied', status: 201, result: { id: raw.id, created_at: raw.created_at }, resourceRef: `capture:${raw.id}` };
  });
  return { status: result.status, replayed: result.replayed, body: result.result };
}

// ─── Media upload ─────────────────────────────────────────────────────────

export async function uploadCaptureMedia(db: DbOrTx, attachmentId: string, bytes: Buffer, actor: CaptureActor) {
  const [row] = await db.select({ media: capture_media, receipt: capture_receipts }).from(capture_media)
    .innerJoin(capture_receipts, eq(capture_media.capture_id, capture_receipts.capture_id))
    .where(eq(capture_media.attachment_id, attachmentId));
  if (!row || !authorized(row.receipt, actor)) throw new CaptureError(404, 'attachment_not_found', 'No such media reservation.');
  if (row.receipt.processing_state === 'cancelled') throw new CaptureError(409, 'capture_cancelled', 'This capture was cancelled.');
  const media = row.media;
  if (bytes.length === 0 || bytes.length > CAPTURE_MEDIA_MAX_BYTES) throw new CaptureError(413, 'media_size_invalid', 'Upload between 1 byte and 25 MiB.');
  validateMediaBytes(bytes, media.media_type as CaptureMediaType);
  // Bytes are verified and durable BEFORE the row says so.
  const { adopted } = await writeVerifiedMedia(attachmentId, bytes, { sha256: media.sha256, size_bytes: media.size_bytes });
  const replayed = media.state === 'verified';
  const verified = await inTransaction(db, async (tx) => {
    const [current] = await tx.select().from(capture_media).where(eq(capture_media.attachment_id, attachmentId)).for('update');
    if (!current) throw new CaptureError(404, 'attachment_not_found', 'No such media reservation.');
    if (current.state === 'verified') return current;
    const [updated] = await tx.update(capture_media)
      .set({ state: 'verified', storage_key: attachmentId, verified_at: new Date().toISOString() })
      .where(eq(capture_media.attachment_id, attachmentId)).returning();
    return updated!;
  });
  actor.log?.info({ event: 'capture_media_verified', attachment_id: attachmentId, capture_id: media.capture_id, adopted }, 'capture media verified');
  return { attachment_id: verified.attachment_id, capture_id: verified.capture_id, state: verified.state, sha256: verified.sha256, size_bytes: verified.size_bytes, replayed };
}

// ─── capture.finalize ─────────────────────────────────────────────────────

/** Foreground recovery: a verified file with a still-reserved row (crash after rename) is adopted. */
async function adoptRecoveredMedia(db: DbOrTx, captureId: string): Promise<void> {
  const reserved = await db.select().from(capture_media).where(and(eq(capture_media.capture_id, captureId), eq(capture_media.state, 'reserved')));
  for (const m of reserved) {
    const ok = await verifyStoredMedia(m.attachment_id, { sha256: m.sha256, size_bytes: m.size_bytes }).catch(() => false);
    if (!ok) continue;
    await db.update(capture_media).set({ state: 'verified', storage_key: m.attachment_id, verified_at: new Date().toISOString() })
      .where(and(eq(capture_media.attachment_id, m.attachment_id), eq(capture_media.state, 'reserved')));
  }
}

export async function finalizeCapture(db: DbOrTx, envelope: CaptureFinalizeEnvelope, actor: CaptureActor) {
  const digest = envelopeDigest(envelope as unknown as Record<string, unknown>);
  const captureId = envelope.payload.capture_id;
  // Filesystem checks stay outside the ledger transaction.
  const [pre] = await db.select().from(capture_receipts).where(eq(capture_receipts.capture_id, captureId));
  if (!pre || !authorized(pre, actor)) throw new CaptureError(404, 'capture_not_found', 'Capture not found.');
  if (pre.storage_state !== 'complete') await adoptRecoveredMedia(db, captureId);
  const result = await withOperation<CaptureReceiptResponse>(db, operationContext(actor, envelope, digest), async (tx, identity) => {
    const [receipt] = await tx.select().from(capture_receipts).where(eq(capture_receipts.capture_id, captureId)).for('update');
    if (!receipt || !authorized(receipt, actor)) throw new CaptureError(404, 'capture_not_found', 'Capture not found.');
    const media = await tx.select().from(capture_media).where(eq(capture_media.capture_id, captureId)).orderBy(asc(capture_media.created_at));
    if (receipt.storage_state === 'complete') {
      return { disposition: 'applied', status: 200, result: { receipt: buildReceipt(receipt, media, identity), replayed: false }, resourceRef: `capture:${captureId}` };
    }
    const missing = media.filter((m) => m.state !== 'verified').map((m) => m.attachment_id);
    if (missing.length > 0) {
      // Non-terminal: no receipt is written, so a later finalize can succeed.
      throw new CaptureError(409, 'media_incomplete', 'Not every reserved attachment has been uploaded and verified.', { missing });
    }
    const [updated] = await tx.update(capture_receipts).set({
      storage_state: 'complete', processing_state: 'queued', finalized_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).where(eq(capture_receipts.capture_id, captureId)).returning();
    return { disposition: 'applied', status: 200, result: { receipt: buildReceipt(updated!, media, identity), replayed: false }, resourceRef: `capture:${captureId}` };
  });
  return { status: result.status, replayed: result.replayed, body: { ...result.result, replayed: result.replayed } };
}

// ─── Reads ────────────────────────────────────────────────────────────────

/** Explicit retry is allowed only for failures known to precede any effect. */
export function retryPermitted(receipt: Pick<ReceiptRow, 'processing_state' | 'error_code'> | null): boolean {
  if (!receipt) return false;
  if (receipt.processing_state === 'blocked') return receipt.error_code !== 'image_processing_unavailable';
  if (receipt.processing_state === 'needs_review') return receipt.error_code === 'parser_failed';
  return false;
}

function detail(raw: RawRow, receipt: ReceiptRow | null, media: MediaRow[], attempts: Array<typeof capture_attempts.$inferSelect>): CaptureDetail {
  const payload = raw.payload as Record<string, unknown>;
  const text = typeof payload.text === 'string' ? payload.text : typeof payload.transcript === 'string' ? payload.transcript : null;
  return {
    capture_id: raw.id,
    operation_id: receipt?.operation_id ?? null,
    data_space_id: receipt?.data_space_id ?? null,
    kind: receipt?.kind ?? null,
    intent: receipt?.intent ?? null,
    modality: receipt?.modality ?? null,
    text,
    client: receipt?.client ?? null,
    source_item_id: receipt?.source_item_id ?? null,
    tags: raw.tags,
    captured_at: receipt?.captured_at ?? null,
    storage_state: receipt?.storage_state ?? null,
    processing_state: (receipt?.processing_state ?? 'legacy') as CaptureListState,
    error_code: receipt?.error_code ?? null,
    outcome: receipt?.outcome ?? null,
    media: media.map((m) => ({ attachment_id: m.attachment_id, media_type: m.media_type as CaptureMediaType, size_bytes: m.size_bytes, state: m.state, verified_at: m.verified_at })),
    current_attempt_no: receipt?.current_attempt_no ?? 0,
    retry_permitted: retryPermitted(receipt),
    attempts: attempts.map((a) => ({ attempt_no: a.attempt_no, stage: a.stage, error_code: a.error_code, started_at: a.created_at, finished_at: a.finished_at })),
    created_at: raw.created_at,
    updated_at: receipt?.updated_at ?? null,
  };
}

export async function getCapture(db: DbOrTx, captureId: string, actor: CaptureActor): Promise<CaptureDetail> {
  const [row] = await db.select({ raw: captured_data, receipt: capture_receipts }).from(captured_data)
    .leftJoin(capture_receipts, eq(capture_receipts.capture_id, captured_data.id)).where(eq(captured_data.id, captureId));
  if (!row || !authorized(row.receipt, actor)) throw new CaptureError(404, 'capture_not_found', 'Capture not found.');
  const media = await db.select().from(capture_media).where(eq(capture_media.capture_id, captureId)).orderBy(asc(capture_media.created_at));
  const attempts = await db.select().from(capture_attempts).where(eq(capture_attempts.capture_id, captureId)).orderBy(asc(capture_attempts.attempt_no));
  return detail(row.raw, row.receipt, media, attempts);
}

export async function listCaptures(db: DbOrTx, query: { state?: CaptureListState[]; limit: number }, actor: CaptureActor): Promise<CaptureDetail[]> {
  const states = query.state;
  const wantLegacy = states?.includes('legacy') ?? false;
  const receiptStates = (states ?? []).filter((s): s is CaptureProcessingState => s !== 'legacy');
  const conditions = [] as ReturnType<typeof eq>[];
  if (states) {
    const parts = [] as ReturnType<typeof eq>[];
    if (receiptStates.length) parts.push(inArray(capture_receipts.processing_state, receiptStates));
    if (wantLegacy && !actor.restrictToCredential) parts.push(isNull(capture_receipts.capture_id));
    if (!parts.length) return [];
    conditions.push(or(...parts)!);
  } else {
    // No filter → every capture with a receipt. Legacy rows are opt-in.
    conditions.push(sql`${capture_receipts.capture_id} is not null`);
  }
  if (actor.restrictToCredential) conditions.push(eq(capture_receipts.credential_id, actor.credentialId ?? ''));
  const rows = await db.select({ raw: captured_data, receipt: capture_receipts }).from(captured_data)
    .leftJoin(capture_receipts, eq(capture_receipts.capture_id, captured_data.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(captured_data.created_at)).limit(query.limit);
  const ids = rows.map((r) => r.raw.id);
  const media = ids.length ? await db.select().from(capture_media).where(inArray(capture_media.capture_id, ids)).orderBy(asc(capture_media.created_at)) : [];
  const byCapture = new Map<string, MediaRow[]>();
  for (const m of media) byCapture.set(m.capture_id, [...(byCapture.get(m.capture_id) ?? []), m]);
  return rows.map((r) => detail(r.raw, r.receipt, byCapture.get(r.raw.id) ?? [], []));
}

export async function getOperation(db: DbOrTx, operationId: string, actor: CaptureActor) {
  return readOperation(db, operationId, actor);
}

export async function readMedia(db: DbOrTx, captureId: string, attachmentId: string, actor: CaptureActor): Promise<{ bytes: Buffer; media_type: string; size_bytes: number }> {
  const [row] = await db.select({ media: capture_media, receipt: capture_receipts }).from(capture_media)
    .innerJoin(capture_receipts, eq(capture_media.capture_id, capture_receipts.capture_id))
    .where(and(eq(capture_media.attachment_id, attachmentId), eq(capture_media.capture_id, captureId)));
  if (!row || !authorized(row.receipt, actor)) throw new CaptureError(404, 'attachment_not_found', 'No such attachment.');
  if (row.media.state !== 'verified' || !row.media.storage_key) throw new CaptureError(409, 'media_not_uploaded', 'This attachment has not been uploaded yet.');
  const bytes = await readCaptureMedia(row.media.storage_key);
  return { bytes, media_type: row.media.media_type, size_bytes: row.media.size_bytes };
}

export { CaptureMediaError, CommandError };
