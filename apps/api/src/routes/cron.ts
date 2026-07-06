import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { env } from '../lib/env.js';
import { getDb, isDatabaseConfigured } from '../lib/db.js';
import { runObservations } from '../lib/observations.js';
import { runReminders } from '../lib/reminders.js';
import { runRoutineReminders, runRoutineMissed } from '../lib/routine-reminders.js';
import { runOverdue } from '../lib/overdue.js';
import { runDailySummary } from '../lib/daily-summary.js';
import { runCalendarSync } from '../lib/calendar-sync.js';
import { isPushoverConfigured } from '../lib/pushover.js';

// /api/cron/* — secret-gated endpoints external schedulers hit on a cadence.
// Same shape as /api/ingest: shared secret in a header, timingSafeEqual
// comparison, direct db handle (cron isn't a user-authenticated context).

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
  // /api/cron/observations — fires hourly (XCloud cron). Runs all failure-pattern
  // rules across domains and writes any new matches to the observations table,
  // which feeds the "Slipping" panel on Today + the chat tool.
  //
  // GET-friendly like the other cron endpoints so a plain URL-pinger
  // (XCloud's HTTP cron, cron-job.org, etc.) can hit it without POST plumbing.
  const observationsHandler = async (req: FastifyRequest, reply: import('fastify').FastifyReply) => {
    if (!env.CRON_SECRET) {
      return reply.code(503).send({
        error: 'cron_disabled',
        reason: 'CRON_SECRET not set',
      });
    }
    if (!checkSecret(readSecret(req))) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    if (!isDatabaseConfigured()) {
      return reply.code(503).send({ error: 'database_not_configured' });
    }

    try {
      const result = await runObservations(getDb());
      req.log.info({ event: 'observations_run', ...result }, 'observations cron complete');
      return reply.code(200).send(result);
    } catch (err) {
      req.log.error({ err }, 'observations cron failed');
      return reply.code(500).send({
        error: 'observations_failed',
        message: err instanceof Error ? err.message : 'unknown',
      });
    }
  };
  app.get('/api/cron/observations', observationsHandler);
  app.post('/api/cron/observations', observationsHandler);

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
    if (!isDatabaseConfigured()) {
      return reply.code(503).send({ error: 'database_not_configured' });
    }
    if (!isPushoverConfigured()) {
      // Soft-disable rather than hard-fail — the user may not have set
      // up Pushover yet. The cron job can run safely; nothing fires.
      return reply.code(200).send({ skipped: 'pushover_not_configured' });
    }

    try {
      // Run task + routine reminders in parallel with the routine "missed"
      // sweep. Routines piggyback on the existing per-minute cron rather
      // than adding a second job — all three queries are cheap and the
      // domains are independent.
      const db = getDb();
      const [tasks, routines, missed] = await Promise.allSettled([
        runReminders(db),
        runRoutineReminders(db),
        runRoutineMissed(db),
      ]);

      const taskResult = tasks.status === 'fulfilled'
        ? tasks.value
        : { considered: 0, dispatched: 0, failed: 1 };
      const routineResult = routines.status === 'fulfilled'
        ? routines.value
        : { considered: 0, dispatched: 0, failed: 1, skipped_done: 0 };
      const missedResult = missed.status === 'fulfilled'
        ? missed.value
        : { considered: 0, dispatched: 0, failed: 1 };

      // Only log when something happened, to keep per-minute log volume low.
      if (taskResult.dispatched > 0 || taskResult.failed > 0) {
        req.log.info({ event: 'reminders_run', ...taskResult }, 'task reminders dispatched');
      }
      if (routineResult.dispatched > 0 || routineResult.failed > 0) {
        req.log.info({ event: 'routine_reminders_run', ...routineResult }, 'routine reminders dispatched');
      }
      if (missedResult.dispatched > 0 || missedResult.failed > 0) {
        req.log.info({ event: 'routine_missed_run', ...missedResult }, 'routine missed pings dispatched');
      }
      if (tasks.status === 'rejected') req.log.error({ err: tasks.reason }, 'task reminders failed');
      if (routines.status === 'rejected') req.log.error({ err: routines.reason }, 'routine reminders failed');
      if (missed.status === 'rejected') req.log.error({ err: missed.reason }, 'routine missed failed');

      return reply.code(200).send({ tasks: taskResult, routines: routineResult, missed: missedResult });
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

  // /api/cron/daily-summary — fire once daily (XCloud cron at 7am Mountain)
  // to send a single Pushover summarizing tasks due, events, observations,
  // and any needs_review notes. Bails cleanly if there's nothing to report
  // or if Pushover isn't configured.
  const dailySummaryHandler = async (req: FastifyRequest, reply: import('fastify').FastifyReply) => {
    if (!env.CRON_SECRET) {
      return reply.code(503).send({ error: 'cron_disabled', reason: 'CRON_SECRET not set' });
    }
    if (!checkSecret(readSecret(req))) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    if (!isDatabaseConfigured()) {
      return reply.code(503).send({ error: 'database_not_configured' });
    }
    if (!isPushoverConfigured()) {
      return reply.code(200).send({ skipped: 'pushover_not_configured' });
    }

    try {
      const result = await runDailySummary(getDb());
      req.log.info({ event: 'daily_summary_run', ...result }, 'daily summary cron complete');
      return reply.code(200).send(result);
    } catch (err) {
      req.log.error({ err }, 'daily summary cron failed');
      return reply.code(500).send({
        error: 'daily_summary_failed',
        message: err instanceof Error ? err.message : 'unknown',
      });
    }
  };
  app.get('/api/cron/daily-summary', dailySummaryHandler);
  app.post('/api/cron/daily-summary', dailySummaryHandler);

  // /api/cron/overdue — fire hourly during waking hours (e.g., 13-03 UTC =
  // 7am-9pm Mountain). Picks up tasks that passed their due time 5min-24h
  // ago. Dedups via reminders_sent.overdue so each task only alerts once.
  const overdueHandler = async (req: FastifyRequest, reply: import('fastify').FastifyReply) => {
    if (!env.CRON_SECRET) {
      return reply.code(503).send({ error: 'cron_disabled', reason: 'CRON_SECRET not set' });
    }
    if (!checkSecret(readSecret(req))) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    if (!isDatabaseConfigured()) {
      return reply.code(503).send({ error: 'database_not_configured' });
    }
    if (!isPushoverConfigured()) {
      return reply.code(200).send({ skipped: 'pushover_not_configured' });
    }

    try {
      const result = await runOverdue(getDb());
      if (result.dispatched > 0 || result.failed > 0) {
        req.log.info({ event: 'overdue_run', ...result }, 'overdue cron dispatched');
      }
      return reply.code(200).send(result);
    } catch (err) {
      req.log.error({ err }, 'overdue cron failed');
      return reply.code(500).send({
        error: 'overdue_failed',
        message: err instanceof Error ? err.message : 'unknown',
      });
    }
  };
  app.get('/api/cron/overdue', overdueHandler);
  app.post('/api/cron/overdue', overdueHandler);

  // /api/cron/calendar-sync — pull Google Calendar events into the local DB
  // and push any locally-created orphans back. Designed to run every
  // ~15 minutes so /today's "Up next" + the /calendar page stay fresh
  // without the user clicking "Sync" in /settings. Idempotent — upserts
  // are keyed on google_event_id.
  //
  // Returns 200 with status:'not_connected' (rather than 4xx) if Google
  // isn't connected yet, so a forgotten cron doesn't keep alerting.
  const calendarSyncHandler = async (req: FastifyRequest, reply: import('fastify').FastifyReply) => {
    if (!env.CRON_SECRET) {
      return reply.code(503).send({ error: 'cron_disabled', reason: 'CRON_SECRET not set' });
    }
    if (!checkSecret(readSecret(req))) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    if (!isDatabaseConfigured()) {
      return reply.code(503).send({ error: 'database_not_configured' });
    }

    try {
      const result = await runCalendarSync(req.log);
      if (!result.ok) {
        // Soft-skip when Google isn't connected — cron stays clean.
        if (result.status === 'not_connected') {
          return reply.code(200).send({ skipped: 'google_not_connected' });
        }
        req.log.warn({ event: 'calendar_sync_failed', ...result }, 'calendar sync cron failed');
        return reply.code(200).send({ failed: result.status, message: result.message });
      }
      // Only log when something actually moved, to keep the per-15-min
      // log volume low.
      if (
        (result.events_upserted ?? 0) > 0 ||
        (result.events_deleted ?? 0) > 0 ||
        (result.orphans_pushed ?? 0) > 0 ||
        (result.orphans_failed ?? 0) > 0
      ) {
        req.log.info({ event: 'calendar_sync_run', ...result }, 'calendar sync cron complete');
      }
      return reply.code(200).send(result);
    } catch (err) {
      req.log.error({ err }, 'calendar sync cron crashed');
      return reply.code(500).send({
        error: 'calendar_sync_failed',
        message: err instanceof Error ? err.message : 'unknown',
      });
    }
  };
  app.get('/api/cron/calendar-sync', calendarSyncHandler);
  app.post('/api/cron/calendar-sync', calendarSyncHandler);
};
