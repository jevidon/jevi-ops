import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { sendPushover, isPushoverConfigured } from './pushover.js';
import type { Db } from './db.js';
import { routine_completions, routines } from '../db/schema.js';
import { env } from './env.js';
import { getAppTz } from './app-settings.js';

// Routine reminder runner — invoked by /api/cron/reminders every minute
// alongside runReminders() for tasks. Finds active routines that:
//   - have reminder_enabled = true
//   - have a specific_time set
//   - haven't already fired today (last_reminder_sent_date != today)
//   - have no completion row for today (don't ping if you already did it)
//
// Fires a Pushover at the exact specific_time in the app's home TZ
// (America/Denver). One reminder per routine per day, no "X min before"
// offsets — habits don't have a lead time concept.

// Cron fires per minute; allow a small window in case the cron runs a
// few seconds late or the scheduler skews. Routines fire when |now -
// specific_time| < FIRE_WINDOW_MIN minutes. Keep it small so we don't
// double-fire across two cron ticks (last_reminder_sent_date does the
// real dedup, but a tight window also helps).
const FIRE_WINDOW_MIN = 1.5;

interface RoutineRow {
  id: string;
  name: string;
  description: string | null;
  time_of_day: 'morning' | 'afternoon' | 'evening' | 'anytime' | null;
  specific_time: string | null;       // HH:MM[:SS]
  reminder_enabled: boolean;
  last_reminder_sent_date: string | null;
  last_missed_sent_date: string | null;
  active: boolean;
}

export interface RoutineReminderResult {
  considered: number;
  dispatched: number;
  failed: number;
  skipped_done: number;
}

export interface RoutineMissedResult {
  considered: number;
  dispatched: number;
  failed: number;
}

// Bucket deadlines in minutes-since-midnight (America/Denver). When the
// local clock crosses one of these and the routine isn't done, we send
// a missed ping. Tuned to "reasonable end of the window" rather than
// hard time-of-day boundaries.
//
//   morning  → end at 12:00 (noon)
//   afternoon → end at 17:00 (5pm)
//   evening  → end at 22:00 (10pm)
//   anytime  → no deadline, no missed ping
const BUCKET_DEADLINE_MIN: Record<string, number | null> = {
  morning: 12 * 60,
  afternoon: 17 * 60,
  evening: 22 * 60,
  anytime: null,
};

// How long after the deadline we still consider firing a missed ping.
// Past this, the cron stays quiet — old missed events are stale (you
// already know you skipped it). A 30-minute trailing window means a
// few skipped cron ticks won't drop the notification.
const MISSED_FIRE_TRAIL_MIN = 30;

// For exact-time routines, the "deadline" is specific_time + this many
// minutes. After that, missed fires (within MISSED_FIRE_TRAIL_MIN).
const EXACT_TIME_GRACE_MIN = 60;

export async function runRoutineReminders(db: Db): Promise<RoutineReminderResult> {
  if (!isPushoverConfigured()) {
    return { considered: 0, dispatched: 0, failed: 0, skipped_done: 0 };
  }

  const tz = await getAppTz();
  const todayIso = todayInTz(tz);
  const nowMinutes = nowMinutesInTz(tz);

  // Pull candidate routines. The partial index defined in 0016 makes
  // this cheap. We filter by date in JS rather than SQL because `neq`
  // with null behaves surprisingly; explicit JS check is clearer.
  const rows = await db.query.routines.findMany({
    columns: {
      id: true, name: true, description: true, time_of_day: true, specific_time: true,
      reminder_enabled: true, last_reminder_sent_date: true, last_missed_sent_date: true, active: true,
    },
    where: and(
      eq(routines.active, true),
      eq(routines.reminder_enabled, true),
      isNotNull(routines.specific_time),
    ),
  });

  const candidates = (rows as RoutineRow[]).filter((r) => {
    if (r.last_reminder_sent_date === todayIso) return false;
    return true;
  });

  let dispatched = 0;
  let failed = 0;
  let skippedDone = 0;

  // Look up today's completions for these routines in one query rather
  // than N. If a routine is already done today, skip the ping.
  let completedSet = new Set<string>();
  if (candidates.length > 0) {
    try {
      const doneRows = await db.query.routine_completions.findMany({
        columns: { routine_id: true },
        where: and(
          inArray(routine_completions.routine_id, candidates.map((r) => r.id)),
          eq(routine_completions.completed_date, todayIso),
        ),
      });
      completedSet = new Set(doneRows.map((r) => r.routine_id));
    } catch {
      /* best-effort — a failed lookup just means we might ping a done routine */
    }
  }

  for (const r of candidates) {
    if (!r.specific_time) continue;
    const minutes = parseTimeToMinutes(r.specific_time);
    if (minutes == null) continue;

    const diff = Math.abs(minutes - nowMinutes);
    if (diff > FIRE_WINDOW_MIN) continue;

    if (completedSet.has(r.id)) {
      skippedDone += 1;
      // Mark sent so we don't ping later in the day if they uncheck
      // accidentally — closer to user-expected behavior than re-firing.
      await db.update(routines).set({ last_reminder_sent_date: todayIso }).where(eq(routines.id, r.id));
      continue;
    }

    const result = await sendPushover({
      title: `Routine · ${r.name}`,
      message: r.description
        ? `${formatTime(r.specific_time)}\n${r.description}`
        : `Time to ${r.name.toLowerCase()} — ${formatTime(r.specific_time)}`,
      url: `${env.WEB_APP_URL.replace(/\/$/, '')}/routines/${r.id}`,
      url_title: 'Open routine',
      priority: 0,
    });

    if (result.ok) {
      try {
        await db.update(routines).set({ last_reminder_sent_date: todayIso }).where(eq(routines.id, r.id));
        dispatched += 1;
      } catch {
        failed += 1;
      }
    } else {
      failed += 1;
    }
  }

  return {
    considered: candidates.length,
    dispatched,
    failed,
    skipped_done: skippedDone,
  };
}

// ─── Missed-routine pings ──────────────────────────────────────────────
//
// Runs alongside runRoutineReminders() on the same per-minute cron.
// For every active routine that has a deadline (either a specific_time
// or a time_of_day bucket that isn't 'anytime'), if NOW is past the
// deadline by less than MISSED_FIRE_TRAIL_MIN, the routine isn't done
// today, and we haven't already fired today's missed ping, send a
// distinct Pushover (priority 1, siren sound).

export async function runRoutineMissed(db: Db): Promise<RoutineMissedResult> {
  if (!isPushoverConfigured()) {
    return { considered: 0, dispatched: 0, failed: 0 };
  }

  const tz = await getAppTz();
  const todayIso = todayInTz(tz);
  const nowMinutes = nowMinutesInTz(tz);

  // Candidates: active routines with either a specific_time set OR a
  // time_of_day bucket that has a deadline. Fetch all active routines,
  // then filter in JS. With <100 routines this is fine.
  const all = (await db.query.routines.findMany({
    columns: {
      id: true, name: true, description: true, time_of_day: true, specific_time: true,
      reminder_enabled: true, last_reminder_sent_date: true, last_missed_sent_date: true, active: true,
    },
    where: eq(routines.active, true),
  })) as RoutineRow[];
  // Pre-filter to rows that haven't fired today AND have a deadline.
  const eligible = all.filter((r) => {
    if (r.last_missed_sent_date === todayIso) return false;
    const deadline = computeDeadlineMinutes(r);
    if (deadline == null) return false;
    // NOW must be past the deadline, but within the trailing window.
    return nowMinutes >= deadline && nowMinutes <= deadline + MISSED_FIRE_TRAIL_MIN;
  });

  if (eligible.length === 0) {
    return { considered: 0, dispatched: 0, failed: 0 };
  }

  // Batch-fetch today's completions for the candidates.
  let completedSet = new Set<string>();
  try {
    const doneRows = await db.query.routine_completions.findMany({
      columns: { routine_id: true },
      where: and(
        inArray(routine_completions.routine_id, eligible.map((r) => r.id)),
        eq(routine_completions.completed_date, todayIso),
      ),
    });
    completedSet = new Set(doneRows.map((r) => r.routine_id));
  } catch {
    /* best-effort */
  }

  let dispatched = 0;
  let failed = 0;

  for (const r of eligible) {
    if (completedSet.has(r.id)) {
      // Already done — no missed ping. Still mark sent so we don't keep
      // rechecking the same row every minute through the trailing window.
      await db.update(routines).set({ last_missed_sent_date: todayIso }).where(eq(routines.id, r.id));
      continue;
    }

    const result = await sendPushover({
      title: `⚠️ Missed · ${r.name}`,
      message: missedMessage(r),
      url: `${env.WEB_APP_URL.replace(/\/$/, '')}/routines/${r.id}`,
      url_title: 'Check it off',
      // priority 1 bypasses Do Not Disturb on iOS; the siren sound makes
      // it audibly distinct from regular reminders.
      priority: 1,
      sound: 'siren',
    });

    if (result.ok) {
      try {
        await db.update(routines).set({ last_missed_sent_date: todayIso }).where(eq(routines.id, r.id));
        dispatched += 1;
      } catch {
        failed += 1;
      }
    } else {
      failed += 1;
    }
  }

  return { considered: eligible.length, dispatched, failed };
}

function computeDeadlineMinutes(r: RoutineRow): number | null {
  // Specific time wins. specific_time + grace = deadline.
  if (r.specific_time) {
    const base = parseTimeToMinutes(r.specific_time);
    if (base == null) return null;
    return base + EXACT_TIME_GRACE_MIN;
  }
  // Bucket-only routines fall back to the bucket's end-of-window.
  if (r.time_of_day && r.time_of_day in BUCKET_DEADLINE_MIN) {
    return BUCKET_DEADLINE_MIN[r.time_of_day] ?? null;
  }
  return null;
}

function missedMessage(r: RoutineRow): string {
  if (r.specific_time) {
    return `Was due at ${formatTime(r.specific_time)} — still open.`;
  }
  const bucket = r.time_of_day ?? 'anytime';
  const labels: Record<string, string> = {
    morning: 'morning window has passed',
    afternoon: 'afternoon window has passed',
    evening: 'evening window has passed',
  };
  return labels[bucket] ?? 'window has passed';
}

// ─── Helpers ───────────────────────────────────────────────────────────

function todayInTz(tz: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${g('year')}-${g('month')}-${g('day')}`;
}

// Returns the current local time-of-day expressed as fractional minutes
// since midnight (0–1439.99) in the given timezone.
function nowMinutesInTz(tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? '0');
  // Intl returns '24' for midnight in some locales; clamp.
  const h = g('hour') === 24 ? 0 : g('hour');
  return h * 60 + g('minute') + g('second') / 60;
}

function parseTimeToMinutes(t: string): number | null {
  const m = t.match(/^(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!m || !m[1] || !m[2]) return null;
  const h = parseInt(m[1], 10);
  const mn = parseInt(m[2], 10);
  if (h < 0 || h > 23 || mn < 0 || mn > 59) return null;
  return h * 60 + mn;
}

// "07:30:00" → "7:30 AM". Just for the Pushover body.
function formatTime(t: string): string {
  const m = t.match(/^(\d{2}):(\d{2})/);
  if (!m || !m[1] || !m[2]) return t;
  const h = parseInt(m[1], 10);
  const mn = m[2];
  const period = h < 12 ? 'AM' : 'PM';
  const display = h === 0 ? 12 : h <= 12 ? h : h - 12;
  return `${display}:${mn} ${period}`;
}
