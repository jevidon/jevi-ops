import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z, ZodError } from 'zod';
import {
  CAPTURE_MEDIA_MAX_BYTES, CaptureCreateEnvelopeSchema, CaptureFinalizeEnvelopeSchema, CaptureListQuerySchema,
} from '@jevi-ops/shared';
import { getDb, isDatabaseConfigured } from '../lib/db.js';
import { CommandError } from '../lib/command-error.js';
import {
  acceptCapture, CaptureError, finalizeCapture, getCapture, getOperation, listCaptures, readMedia, uploadCaptureMedia, type CaptureActor,
} from '../lib/capture/service.js';
import { CaptureMediaError } from '../lib/capture/media-store.js';

// Durable capture API (capture program, Gate B).
//
//   POST /api/captures                          capture.create envelope → 201 receipt (200 on replay)
//   PUT  /api/capture-uploads/:attachment_id    raw bytes for a reserved attachment
//   POST /api/captures/:id/finalize             capture.finalize envelope → 200 receipt
//   GET  /api/captures?state=a,b&limit=n        list (state 'legacy' = pre-0060 rows)
//   GET  /api/captures/:id                      detail with truthful storage/processing state
//   GET  /api/captures/:id/media/:attachment_id authenticated download of a verified original
//   GET  /api/operations/:operation_id          durable result after a lost response
//
// Nothing here calls a model, transcription, geocoding, or Hermes. Sessions
// and legacy tokens pass; capture_client tokens need the declared scope.

const uuid = (value: unknown) => z.string().uuid().parse(value);

export function captureActor(req: FastifyRequest): CaptureActor {
  return {
    actor: req.authMethod === 'session' ? `session:${req.user!.email}` : req.user!.email,
    credentialId: req.credentialId ?? null,
    restrictToCredential: req.permissionProfile === 'capture_client',
    log: req.log,
  };
}

export async function respondCapture(reply: FastifyReply, fn: () => Promise<unknown>) {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof ZodError) return reply.code(400).send({ error: 'invalid_payload', details: error.flatten() });
    if (error instanceof CaptureError || error instanceof CaptureMediaError || error instanceof CommandError) {
      return reply.code(error.status).send({ error: error.code, message: error.message, ...error.details });
    }
    throw error;
  }
}

export const captureProgramRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.requireAuth);
  app.addHook('preHandler', async (_req, reply) => {
    if (!isDatabaseConfigured()) return reply.code(503).send({ error: 'database_not_configured' });
  });
  // Raw uploads: bytes only, bounded, parsed into a Buffer for this plugin only.
  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: CAPTURE_MEDIA_MAX_BYTES }, (_req, body, done) => done(null, body));
  const write = { config: { captureScope: 'capture:write' as const } };
  const read = { config: { captureScope: 'capture:read' as const } };

  app.post('/api/captures', write, (req, reply) => respondCapture(reply, async () => {
    const envelope = CaptureCreateEnvelopeSchema.parse(req.body);
    const r = await acceptCapture(getDb(), envelope, captureActor(req));
    return reply.code(r.replayed && r.status === 201 ? 200 : r.status).send(r.body);
  }));

  app.put<{ Params: { attachment_id: string } }>('/api/capture-uploads/:attachment_id', { ...write, bodyLimit: CAPTURE_MEDIA_MAX_BYTES }, (req, reply) => respondCapture(reply, async () => {
    const attachmentId = uuid(req.params.attachment_id);
    if (!Buffer.isBuffer(req.body)) return reply.code(415).send({ error: 'octet_stream_required', message: 'Send the file bytes as application/octet-stream.' });
    return uploadCaptureMedia(getDb(), attachmentId, req.body, captureActor(req));
  }));

  app.post<{ Params: { id: string } }>('/api/captures/:id/finalize', write, (req, reply) => respondCapture(reply, async () => {
    const envelope = CaptureFinalizeEnvelopeSchema.parse(req.body);
    if (envelope.payload.capture_id !== uuid(req.params.id)) return reply.code(400).send({ error: 'capture_id_mismatch' });
    const r = await finalizeCapture(getDb(), envelope, captureActor(req));
    return reply.code(r.status).send(r.body);
  }));

  app.get<{ Querystring: Record<string, string | undefined> }>('/api/captures', read, (req, reply) => respondCapture(reply, async () => {
    const query = CaptureListQuerySchema.parse(req.query ?? {});
    return { captures: await listCaptures(getDb(), query, captureActor(req)) };
  }));

  app.get<{ Params: { id: string } }>('/api/captures/:id', read, (req, reply) => respondCapture(reply, async () => ({
    capture: await getCapture(getDb(), uuid(req.params.id), captureActor(req)),
  })));

  app.get<{ Params: { id: string; attachment_id: string } }>('/api/captures/:id/media/:attachment_id', read, (req, reply) => respondCapture(reply, async () => {
    const file = await readMedia(getDb(), uuid(req.params.id), uuid(req.params.attachment_id), captureActor(req));
    return reply
      .header('Cache-Control', 'private, no-store')
      .header('X-Content-Type-Options', 'nosniff')
      .header('Content-Disposition', `attachment; filename="${req.params.attachment_id}"`)
      .header('Content-Length', String(file.size_bytes))
      .type(file.media_type)
      .send(file.bytes);
  }));

  app.get<{ Params: { operation_id: string } }>('/api/operations/:operation_id', read, (req, reply) => respondCapture(reply, async () => {
    const operation = await getOperation(getDb(), uuid(req.params.operation_id), captureActor(req));
    if (!operation) return reply.code(404).send({ error: 'operation_not_found' });
    return { operation };
  }));
};
