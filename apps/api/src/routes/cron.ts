import type { FastifyPluginAsync } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { env } from '../lib/env.js';
import { supabaseAdmin, isSupabaseConfigured } from '../lib/supabase.js';
import { runObservations } from '../lib/observations.js';

// /api/cron/* — secret-gated endpoints external schedulers hit on a cadence.
// Same shape as /api/ingest: shared secret in a header, timingSafeEqual
// comparison, service-role Supabase client (cron isn't a user-authenticated
// context).

function checkSecret(provided: string | undefined): boolean {
  const expected = env.CRON_SECRET;
  if (!expected || !provided) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function readSecret(req: import('fastify').FastifyRequest): string | undefined {
  const raw = req.headers['x-cron-secret'];
  return Array.isArray(raw) ? raw[0] : raw;
}

export const cronRoutes: FastifyPluginAsync = async (app) => {
  app.post('/api/cron/observations', async (req, reply) => {
    if (!env.CRON_SECRET) {
      return reply.code(503).send({
        error: 'cron_disabled',
        reason: 'CRON_SECRET not set',
      });
    }
    if (!checkSecret(readSecret(req))) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    if (!isSupabaseConfigured()) {
      return reply.code(503).send({ error: 'supabase_not_configured' });
    }

    try {
      const result = await runObservations(supabaseAdmin());
      req.log.info({ event: 'observations_run', ...result }, 'observations cron complete');
      return reply.code(200).send(result);
    } catch (err) {
      req.log.error({ err }, 'observations cron failed');
      return reply.code(500).send({
        error: 'observations_failed',
        message: err instanceof Error ? err.message : 'unknown',
      });
    }
  });
};
