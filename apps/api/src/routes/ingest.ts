import type { FastifyPluginAsync } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { IngestRequestSchema, CaptureTranscriptSourceSchema } from '@jevi-ops/shared/schemas';
import { env } from '../lib/env.js';
import { getDb, isDatabaseConfigured } from '../lib/db.js';
import { captured_data } from '../db/schema.js';
import { parseTranscript } from '../lib/parser.js';
import { executeActions } from '../lib/executor.js';
import { isLlmConfigured } from '../lib/llm.js';

// POST /api/ingest — generic capture endpoint (spec §3, §7).
//
// Called by external systems (Zapier, n8n, Cowork workflows, future
// smart-glasses webhooks). Auth: shared secret in X-Ingest-Secret header,
// compared with timingSafeEqual. If INGEST_WEBHOOK_SECRET is unset the
// endpoint refuses all requests rather than silently accepting them.

function checkSecret(provided: string | undefined): boolean {
  const expected = env.INGEST_WEBHOOK_SECRET;
  if (!expected || !provided) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export const ingestRoutes: FastifyPluginAsync = async (app) => {
  app.post('/api/ingest', async (req, reply) => {
    if (!env.INGEST_WEBHOOK_SECRET) {
      return reply.code(503).send({
        error: 'ingest_disabled',
        reason: 'INGEST_WEBHOOK_SECRET not set',
      });
    }
    const provided = req.headers['x-ingest-secret'];
    const single = Array.isArray(provided) ? provided[0] : provided;
    if (!checkSecret(single)) {
      return reply.code(401).send({ error: 'unauthorized' });
    }

    const parsed = IngestRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'invalid_payload',
        details: parsed.error.flatten().fieldErrors,
      });
    }

    if (!isDatabaseConfigured()) {
      req.log.info({ event: 'ingest_stub', body: parsed.data }, 'captured (no db)');
      return reply.code(202).send({ status: 'accepted_no_db', stub: true });
    }

    // Direct insert — webhook is not a user-authenticated context; the
    // secret check above is the auth.
    try {
      const [row] = await getDb()
        .insert(captured_data)
        .values({
          source: parsed.data.source,
          type: parsed.data.type,
          payload: parsed.data.payload,
          tags: parsed.data.tags ?? [],
          display_hint: parsed.data.display_hint ?? 'log',
          source_ref: parsed.data.source_ref ?? null,
        })
        .returning({ id: captured_data.id, created_at: captured_data.created_at });
      return reply.code(201).send(row);
    } catch (err) {
      req.log.error({ err }, 'ingest insert failed');
      // Surface the Postgres message in the response. Single-user app —
      // no risk of cross-tenant info leakage — and it makes debugging
      // schema/constraint mismatches from a watch shortcut much easier
      // than spelunking through PM2 logs.
      const pgCode = (err as { code?: string })?.code;
      return reply.code(500).send({
        error: 'insert_failed',
        message: err instanceof Error ? err.message : 'unknown',
        code: pgCode,
      });
    }
  });

  // POST /api/ingest/capture — secret-gated equivalent of /api/capture/voice.
  // Accepts a pre-transcribed string, runs the same Claude parser + executor
  // pipeline that Cmd+J and the mic FAB use. Designed for clients that don't
  // have a Supabase JWT — e.g. an Apple Watch / Wear OS shortcut that
  // dictates text and posts the transcript.
  //
  // Body:
  //   transcript: string                  (required)
  //   source?:    'voice' | 'text'        (defaults to 'voice' — the watch
  //                                        user typically spoke it, even
  //                                        though dictation hands us text)
  //
  // Returns the same response shape as /api/capture/voice:
  //   200 { status:'executed', actions: [...], transcript }
  //   200 { status:'needs_disambiguation', field, candidates, transcript }
  //   422 { status:'parse_error', error, transcript }
  app.post('/api/ingest/capture', async (req, reply) => {
    if (!env.INGEST_WEBHOOK_SECRET) {
      return reply.code(503).send({ error: 'ingest_disabled', reason: 'INGEST_WEBHOOK_SECRET not set' });
    }
    const provided = req.headers['x-ingest-secret'];
    const single = Array.isArray(provided) ? provided[0] : provided;
    if (!checkSecret(single)) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    if (!(await isLlmConfigured())) {
      return reply.code(503).send({ error: 'llm_not_configured' });
    }
    if (!isDatabaseConfigured()) {
      return reply.code(503).send({ error: 'database_not_configured' });
    }

    const BodySchema = z.object({
      transcript: z.string().min(1),
      source: CaptureTranscriptSourceSchema.optional(),
    });
    const parsed = BodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'invalid_payload',
        details: parsed.error.flatten().fieldErrors,
      });
    }
    const transcript = parsed.data.transcript.trim();
    const captureSource = parsed.data.source ?? 'voice';

    // Webhook context — no JWT user. The secret check above is the auth
    // boundary.
    const db = getDb();

    let result;
    try {
      result = await parseTranscript(transcript, db);
    } catch (err) {
      req.log.error({ err }, 'webhook capture parser failed');
      return reply.code(502).send({
        error: 'parser_failed',
        message: err instanceof Error ? err.message : 'unknown_parser_error',
      });
    }

    if (result.kind === 'error') {
      return reply.code(422).send({
        status: 'parse_error',
        error: result.error,
        transcript: result.transcript,
      });
    }
    if (result.kind === 'disambiguation') {
      return reply.code(200).send({
        status: 'needs_disambiguation',
        field: result.field,
        candidates: result.candidates,
        transcript,
      });
    }

    const executionResults = await executeActions(db, result.actions, { captureSource });
    req.log.info(
      {
        event: 'webhook_capture',
        transcript_chars: transcript.length,
        source: captureSource,
        action_count: result.actions.length,
        success_count: executionResults.filter((x) => x.status === 'success').length,
      },
      'webhook capture pipeline executed',
    );

    return reply.code(200).send({
      status: 'executed',
      actions: executionResults,
      transcript,
    });
  });
};
