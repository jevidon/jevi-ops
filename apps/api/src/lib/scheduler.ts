import { Cron } from 'croner';
import type { FastifyBaseLogger } from 'fastify';
import { getDb, isDatabaseConfigured } from './db.js';
import { getAppTz } from './app-settings.js';
import { isPushoverConfigured } from './pushover.js';
import { runReminders } from './reminders.js';
import { runRoutineReminders, runRoutineMissed } from './routine-reminders.js';
import { runOverdue } from './overdue.js';
import { runDailySummary } from './daily-summary.js';
import { runObservations } from './observations.js';
import { runAttention } from './attention.js';
import { runCalendarSync } from './calendar-sync.js';

// In-process scheduler — replaces the external HTTP cron pingers (XCloud).
// Calls the same run* functions the /api/cron/* endpoints use; those
// endpoints stay registered for manual triggering and smoke tests.
//
// croner: IANA timezone support, correct DST handling, and protect:true so
// a slow run (e.g. a hanging Google call in calendar-sync) can't overlap
// the next tick of the same job.
//
// Enabled via CRON_ENABLED=true — default false so `tsx watch` restarts in
// dev don't double-fire, and only the single compose api container runs it.

interface Job {
  name: string;
  pattern: string;
  handler: () => Promise<unknown>;
  /** Skip (quietly) unless these hold. */
  needsPushover?: boolean;
}

export async function startScheduler(log: FastifyBaseLogger): Promise<() => void> {
  // Timezone is read once at start — matches the app's "settings change =
  // restart-rare" posture. A tz change via Settings needs an API restart to
  // reschedule; document in Settings UI if that ever bites.
  const tz = await getAppTz();

  const jobs: Job[] = [
    {
      // Task reminders + routine reminders + missed sweep piggyback on one
      // per-minute tick — all three queries are cheap and independent.
      name: 'reminders',
      pattern: '* * * * *',
      needsPushover: true,
      handler: async () => {
        const db = getDb();
        const [tasks, routines, missed] = await Promise.allSettled([
          runReminders(db),
          runRoutineReminders(db),
          runRoutineMissed(db),
        ]);
        for (const [label, r] of [['task', tasks], ['routine', routines], ['missed', missed]] as const) {
          if (r.status === 'rejected') log.error({ err: r.reason }, `${label} reminders failed`);
          else if ((r.value as { dispatched: number }).dispatched > 0) {
            log.info({ event: `${label}_reminders`, ...r.value }, `${label} reminders dispatched`);
          }
        }
      },
    },
    {
      name: 'calendar-sync',
      pattern: '*/15 * * * *',
      handler: async () => {
        const result = await runCalendarSync(log);
        if (result.ok && (result.events_upserted > 0 || result.events_deleted > 0 || result.orphans_pushed > 0)) {
          log.info({ event: 'calendar_sync', ...result }, 'calendar sync complete');
        }
      },
    },
    {
      name: 'observations',
      pattern: '0 * * * *',
      handler: async () => {
        const result = await runObservations(getDb());
        if (result.inserted > 0) {
          log.info({ event: 'observations', ...result }, 'observations inserted');
        }
      },
    },
    {
      // Waking hours in the app timezone — croner evaluates the pattern in
      // tz, so this replaces the old "13-03 UTC" hack.
      name: 'overdue',
      pattern: '0 7-21 * * *',
      needsPushover: true,
      handler: () => runOverdue(getDb()),
    },
    {
      name: 'daily-summary',
      pattern: '0 7 * * *',
      needsPushover: true,
      handler: async () => {
        const result = await runDailySummary(getDb());
        log.info({ event: 'daily_summary', ...result }, 'daily summary run');
      },
    },
    {
      // Before the 7am daily summary so the day starts with fresh items.
      name: 'attention',
      pattern: '0 5 * * *',
      handler: async () => {
        const result = await runAttention(getDb());
        log.info({ event: 'attention_run', ...result }, 'attention run complete');
      },
    },
  ];

  const crons = jobs.map((job) =>
    new Cron(job.pattern, { timezone: tz, protect: true, name: job.name }, async () => {
      if (!isDatabaseConfigured()) return;
      if (job.needsPushover && !isPushoverConfigured()) return;
      try {
        await job.handler();
      } catch (err) {
        log.error({ err, job: job.name }, 'scheduled job failed');
      }
    }),
  );

  log.info(
    { jobs: jobs.map((j) => `${j.name} (${j.pattern})`), timezone: tz },
    'in-process scheduler started',
  );

  return () => {
    for (const c of crons) c.stop();
    log.info('in-process scheduler stopped');
  };
}
