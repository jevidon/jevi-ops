import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { CaptureRetryEnvelopeSchema } from '@jevi-ops/shared';
import { getDb, isDatabaseConfigured } from '../lib/db.js';
import { interpretCapture, retryInterpretation } from '../lib/capture/legacy-bridge.js';
import { captureActor, respondCapture } from './captures.js';

// TRANSITIONAL: removed in Gate C.
//
//   POST /api/captures/:id/interpret            first interpretation of a queued capture
//   POST /api/captures/:id/retry-interpretation capture.retry_interpretation envelope
//
// Owner sessions and legacy tokens only. capture_client credentials are
// denied by the auth plugin (no captureScope here) and again below.

const uuid = (value: unknown) => z.string().uuid().parse(value);

export const captureBridgeRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.requireAuth);
  app.addHook('preHandler', async (req, reply) => {
    if (!isDatabaseConfigured()) return reply.code(503).send({ error: 'database_not_configured' });
    if (req.permissionProfile === 'capture_client') return reply.code(403).send({ error: 'session_or_legacy_required' });
  });

  app.post<{ Params: { id: string } }>('/api/captures/:id/interpret', (req, reply) => respondCapture(reply, () =>
    interpretCapture(getDb(), uuid(req.params.id), captureActor(req), { log: req.log }),
  ));

  app.post<{ Params: { id: string } }>('/api/captures/:id/retry-interpretation', (req, reply) => respondCapture(reply, async () => {
    const envelope = CaptureRetryEnvelopeSchema.parse(req.body);
    if (envelope.payload.capture_id !== uuid(req.params.id)) return reply.code(400).send({ error: 'capture_id_mismatch' });
    return retryInterpretation(getDb(), envelope, captureActor(req), { log: req.log });
  }));
};
