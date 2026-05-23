import type { SupabaseClient } from '@supabase/supabase-js';
import { sendPushover, isPushoverConfigured } from './pushover.js';
import { env } from './env.js';

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

const USER_TZ = 'America/Denver';

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
  specific_time: string | null;       // HH:MM[:SS]
  reminder_enabled: boolean;
  last_reminder_sent_date: string | null;
  active: boolean;
}

export interface RoutineReminderResult {
  considered: number;
  dispatched: number;
  failed: number;
  skipped_done: number;
}

export async function runRoutineReminders(sb: SupabaseClient): Promise<RoutineReminderResult> {
  if (!isPushoverConfigured()) {
    return { considered: 0, dispatched: 0, failed: 0, skipped_done: 0 };
  }

  const todayIso = todayInTz(USER_TZ);
  const nowMinutes = nowMinutesInTz(USER_TZ);

  // Pull candidate routines. The partial index defined in 0016 makes
  // this cheap. We filter by date in JS rather than in PostgREST because
  // `neq` with null behaves surprisingly; explicit JS check is clearer.
  const { data, error } = await sb
    .from('routines')
    .select('id, name, description, specific_time, reminder_enabled, last_reminder_sent_date, active')
    .eq('active', true)
    .eq('reminder_enabled', true)
    .not('specific_time', 'is', null);
  if (error) throw new Error(`routines query failed: ${error.message}`);

  const candidates = ((data ?? []) as RoutineRow[]).filter((r) => {
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
    const { data: doneRows, error: doneErr } = await sb
      .from('routine_completions')
      .select('routine_id')
      .in('routine_id', candidates.map((r) => r.id))
      .eq('completed_date', todayIso);
    if (!doneErr && doneRows) {
      completedSet = new Set(doneRows.map((r: { routine_id: string }) => r.routine_id));
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
      await sb
        .from('routines')
        .update({ last_reminder_sent_date: todayIso })
        .eq('id', r.id);
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
      const { error: updErr } = await sb
        .from('routines')
        .update({ last_reminder_sent_date: todayIso })
        .eq('id', r.id);
      if (updErr) failed += 1;
      else dispatched += 1;
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
