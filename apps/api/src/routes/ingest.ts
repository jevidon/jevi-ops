import type { FastifyPluginAsync } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { IngestRequestSchema, CaptureSourceSchema } from '@jerad-ops/shared/schemas';
import { env } from '../lib/env.js';
import { supabaseAdmin, isSupabaseConfigured } from '../lib/supabase.js';
import { parseTranscript } from '../lib/parser.js';
import { executeActions } from '../lib/executor.js';
import { isAnthropicConfigured } from '../lib/anthropic.js';

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

    if (!isSupabaseConfigured()) {
      req.log.info({ event: 'ingest_stub', body: parsed.data }, 'captured (no db)');
      return reply.code(202).send({ status: 'accepted_no_db', stub: true });
    }

    // Service-role client — webhook is not a user-authenticated context;
    // RLS would block this insert. The secret check above is the auth.
    const { data, error } = await supabaseAdmin()
      .from('captured_data')
      .insert({
        source: parsed.data.source,
        type: parsed.data.type,
        payload: parsed.data.payload,
        tags: parsed.data.tags ?? [],
        display_hint: parsed.data.display_hint ?? 'log',
        source_ref: parsed.data.source_ref ?? null,
      })
      .select('id, created_at')
      .single();

    if (error) {
      req.log.error({ error }, 'ingest insert failed');
      // Surface the Postgres message in the response. Single-user app —
      // no risk of cross-tenant info leakage — and it makes debugging
      // schema/constraint mismatches from a watch shortcut much easier
      // than spelunking through PM2 logs.
      return reply.code(500).send({
        error: 'insert_failed',
        message: error.message,
        code: error.code,
      });
    }

    return reply.code(201).send(data);
  });

  // POST /api/ingest/capture — secret-gated equivalent of /api/capture/voice.
  // Accepts a pre-transcribed string, runs the same Claude parser + executor
  // pipeline that Cmd+J and the mic FAB use. Designed for clients that don't
  // have a Supabase JWT — e.g. an Apple Watch / Wear OS shortcut that
  // dictates text and posts the transcript.
  //
  // Body:
  //   transcript: string  (required)
  //   source?:    'watch' | 'webhook' | 'manual' | …  (defaults to 'watch')
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
    if (!isAnthropicConfigured()) {
      return reply.code(503).send({ error: 'anthropic_not_configured' });
    }
    if (!isSupabaseConfigured()) {
      return reply.code(503).send({ error: 'supabase_not_configured' });
    }

    const BodySchema = z.object({
      transcript: z.string().min(1),
      source: CaptureSourceSchema.optional(),
    });
    const parsed = BodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'invalid_payload',
        details: parsed.error.flatten().fieldErrors,
      });
    }
    const transcript = parsed.data.transcript.trim();
    const captureSource = parsed.data.source ?? 'watch';

    // Webhook context — no JWT user, so use the service-role client
    // throughout. The secret check above is the auth boundary.
    const sb = supabaseAdmin();

    let result;
    try {
      result = await parseTranscript(transcript, sb);
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

    const executionResults = await executeActions(sb, result.actions, { captureSource });
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
