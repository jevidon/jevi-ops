import type { FastifyPluginAsync } from 'fastify';
import { and, asc, gte, lte } from 'drizzle-orm';
import { runCalendarSync } from '../lib/calendar-sync.js';
import { getDb } from '../lib/db.js';
import { calendar_events } from '../db/schema.js';

// Calendar sync:
//   POST /api/sync/calendar/pull  — fetch Google events for ±7 days, upsert
//     into calendar_events keyed on google_event_id.
//   GET  /api/calendar/upcoming   — next 4 events on or after now.
//
// Both are user-auth-gated. Cron-driven sync lives in routes/cron.ts at
// /api/cron/calendar-sync and reuses the same runCalendarSync function.

export const calendarRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.requireAuth);

  // Manual pull (the "Sync" button on /settings).
  app.post('/api/sync/calendar/pull', async (req, reply) => {
    const result = await runCalendarSync(req.log);
    if (!result.ok) {
      const statusCode =
        result.status === 'not_connected' ? 409 :
        result.status === 'api_failed' ? 502 :
        500;
      return reply.code(statusCode).send({ error: result.status, message: result.message });
    }
    return reply.code(200).send({
      status: result.status,
      events_fetched: result.events_fetched,
      events_upserted: result.events_upserted,
      events_deleted: result.events_deleted,
      orphans_pushed: result.orphans_pushed,
      orphans_failed: result.orphans_failed,
      window: result.window,
    });
  });

  // Next N events for Today's "Up next" section.
  app.get<{ Querystring: { limit?: string } }>('/api/calendar/upcoming', async (req) => {
    const limit = Math.min(parseInt(req.query.limit ?? '4', 10) || 4, 20);
    const nowIso = new Date().toISOString();
    const events = await getDb().query.calendar_events.findMany({
      where: gte(calendar_events.end_at, nowIso), // include events currently in progress
      orderBy: asc(calendar_events.start_at),
      limit,
    });
    return { events };
  });

  // Range list for the /calendar page. Defaults to ±30 days.
  app.get<{ Querystring: { from?: string; to?: string } }>('/api/calendar/events', async (req) => {
    const now = new Date();
    const defaultFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const defaultTo = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000).toISOString();
    const from = req.query.from ?? defaultFrom;
    const to = req.query.to ?? defaultTo;
    const events = await getDb().query.calendar_events.findMany({
      where: and(gte(calendar_events.start_at, from), lte(calendar_events.start_at, to)),
      orderBy: asc(calendar_events.start_at),
      limit: 500,
    });
    return { events, range: { from, to } };
  });
};
