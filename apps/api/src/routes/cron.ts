import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { env } from '../lib/env.js';
import { supabaseAdmin, isSupabaseConfigured } from '../lib/supabase.js';
import { runObservations } from '../lib/observations.js';
import { runReminders } from '../lib/reminders.js';
import { isPushoverConfigured } from '../lib/pushover.js';

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

function readSecret(req: FastifyRequest): string | undefined {
  // Prefer the dedicated header; fall back to ?secret= so simple cron
  // services that don't let you set headers can still call us.
  const headerRaw = req.headers['x-cron-secret'];
  const fromHeader = Array.isArray(headerRaw) ? headerRaw[0] : headerRaw;
  if (fromHeader) return fromHeader;
  const q = (req.query as { secret?: string } | undefined)?.secret;
  return typeof q === 'string' ? q : undefined;
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

  // /api/cron/reminders — runs every minute. Dispatches Pushover pushes for
  // any task whose due-time + a reminder_offset just elapsed. Idempotent
  // via tasks.reminders_sent so the same offset never re-fires.
  //
  // Accepts GET so simple cron services (curl, cron-job.org's URL pinger,
  // XCloud's HTTP cron) can hit it without POST body plumbing.
  const remindersHandler = async (req: FastifyRequest, reply: import('fastify').FastifyReply) => {
    if (!env.CRON_SECRET) {
      return reply.code(503).send({ error: 'cron_disabled', reason: 'CRON_SECRET not set' });
    }
    if (!checkSecret(readSecret(req))) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    if (!isSupabaseConfigured()) {
      return reply.code(503).send({ error: 'supabase_not_configured' });
    }
    if (!isPushoverConfigured()) {
      // Soft-disable rather than hard-fail — the user may not have set
      // up Pushover yet. The cron job can run safely; nothing fires.
      return reply.code(200).send({ skipped: 'pushover_not_configured' });
    }

    try {
      const result = await runReminders(supabaseAdmin());
      // Only log when something happened, to keep per-minute log volume low.
      if (result.dispatched > 0 || result.failed > 0) {
        req.log.info({ event: 'reminders_run', ...result }, 'reminders cron dispatched');
      }
      return reply.code(200).send(result);
    } catch (err) {
      req.log.error({ err }, 'reminders cron failed');
      return reply.code(500).send({
        error: 'reminders_failed',
        message: err instanceof Error ? err.message : 'unknown',
      });
    }
  };
  app.get('/api/cron/reminders', remindersHandler);
  app.post('/api/cron/reminders', remindersHandler);
};
