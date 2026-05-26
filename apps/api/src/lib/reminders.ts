import type { SupabaseClient } from '@supabase/supabase-js';
import { sendPushover, isPushoverConfigured } from './pushover.js';
import { env } from './env.js';

// Reminder runner — called by /api/cron/reminders every minute. Finds open
// tasks whose due time + a reminder_offset has just passed, sends a
// Pushover, and records the dispatch so we don't fire again.
//
// Implementation notes:
// - Tasks store due_date (date) + due_time (time without TZ) separately;
//   we combine them in the user's home timezone (Mountain Time, matches
//   the rest of the app) to produce an absolute trigger moment.
// - reminders_sent is a jsonb map { "<offset_min>": "<iso_ts>" } on each
//   task row. Presence of an offset key means we've already dispatched.
// - We only consider tasks due in the next 24h (cheap pre-filter on
//   due_date) to keep the per-minute query small.

import { getAppTz } from './app-settings.js';

interface DueTask {
  id: string;
  title: string;
  status: string;
  priority: number;              // 1=urgent ... 4=low
  due_date: string | null;       // YYYY-MM-DD
  due_time: string | null;       // HH:MM[:SS]
  reminder_offsets: number[] | null;
  reminders_sent: Record<string, string> | null;
  project: { name: string | null } | null;
}

export interface ReminderRunResult {
  considered: number;
  dispatched: number;
  failed: number;
}

export async function runReminders(sb: SupabaseClient): Promise<ReminderRunResult> {
  if (!isPushoverConfigured()) {
    return { considered: 0, dispatched: 0, failed: 0 };
  }
  const tz = await getAppTz();

  // Window: tasks due any time today, tomorrow, or yesterday. Yesterday
  // covers late-night reminders for tasks due at, say, 23:30 when "now"
  // has rolled over to the next day's UTC date.
  const now = new Date();
  const dates = [
    isoDate(addDays(now, -1)),
    isoDate(now),
    isoDate(addDays(now, 1)),
  ];

  const { data, error } = await sb
    .from('tasks')
    .select('id, title, status, priority, due_date, due_time, reminder_offsets, reminders_sent, project:projects(name)')
    .eq('status', 'open')
    .not('due_time', 'is', null)
    .in('due_date', dates)
    .limit(500);
  if (error) throw new Error(`tasks query failed: ${error.message}`);

  // Supabase types FK joins as arrays even when single. Normalize to single.
  const tasks = ((data ?? []) as unknown as Array<Omit<DueTask, 'project'> & { project: { name: string | null } | { name: string | null }[] | null }>)
    .map((t) => ({
      ...t,
      project: Array.isArray(t.project) ? (t.project[0] ?? null) : t.project,
    })) as DueTask[];

  let dispatched = 0;
  let failed = 0;

  for (const t of tasks) {
    if (!t.due_date || !t.due_time) continue;
    // Accept 0 (== "at due time") as a valid offset alongside positive
    // values. Negative offsets would mean "after due" — that's overdue
    // territory, handled by the separate overdue cron, so reject those.
    const offsets = (t.reminder_offsets ?? []).filter((n) => Number.isFinite(n) && n >= 0);
    if (offsets.length === 0) continue;

    const dueMoment = composeDueMoment(t.due_date, t.due_time, tz);
    if (!dueMoment) continue;

    const sent = t.reminders_sent ?? {};
    const newSent: Record<string, string> = { ...sent };
    let touched = false;

    for (const offset of offsets) {
      const key = String(offset);
      if (sent[key]) continue;                              // already sent
      const triggerAt = dueMoment.getTime() - offset * 60_000;
      if (now.getTime() < triggerAt) continue;              // not time yet
      if (now.getTime() > dueMoment.getTime() + 5 * 60_000) continue; // due > 5 min ago — skip stale

      const result = await sendPushover({
        // "Task in 0 min" reads badly — for offset=0 the title says
        // "due now" instead. Above-zero offsets keep the lead-time
        // framing ("Task in 15 min").
        title: offset === 0
          ? `Due now · ${t.title}`
          : `Task in ${humanOffset(offset)} · ${t.title}`,
        message: composeMessage(t, offset, dueMoment, tz),
        url: `${env.WEB_APP_URL.replace(/\/$/, '')}/tasks/${t.id}`,
        url_title: 'Open task',
        // P1 tasks bypass Do Not Disturb. Everything else uses default
        // priority. Keeps the high-priority signal meaningful by reserving
        // it for the rare "this is actually urgent" case.
        priority: t.priority === 1 ? 1 : 0,
      });

      if (result.ok) {
        newSent[key] = new Date().toISOString();
        touched = true;
        dispatched += 1;
      } else {
        failed += 1;
      }
    }

    if (touched) {
      const { error: updErr } = await sb
        .from('tasks')
        .update({ reminders_sent: newSent })
        .eq('id', t.id);
      if (updErr) failed += 1;
    }
  }

  return { considered: tasks.length, dispatched, failed };
}

function composeDueMoment(dueDate: string, dueTime: string, tz: string): Date | null {
  // dueTime may be HH:MM or HH:MM:SS. Normalize.
  const time = dueTime.length === 5 ? `${dueTime}:00` : dueTime;
  // Use the user's configured TZ to interpret the local moment. Easiest
  // reliable path: build an ISO with the right offset by asking Intl
  // what the offset is on that day.
  try {
    const local = new Date(`${dueDate}T${time}`);
    if (isNaN(local.getTime())) return null;
    // We need to shift `local` (interpreted as UTC by Date) so it represents
    // the same wall-clock in `tz`. Compute the offset between UTC and
    // `tz` at that date and subtract.
    const tzOffsetMin = getTzOffsetMinutes(local, tz);
    return new Date(local.getTime() - tzOffsetMin * 60_000);
  } catch {
    return null;
  }
}

// Returns the offset of `tz` from UTC at the given moment, in minutes.
// Positive when ahead of UTC, negative when behind (Mountain Time → -360/-420).
function getTzOffsetMinutes(at: Date, tz: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const parts = dtf.formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '0';
  const asUtcMs = Date.UTC(
    Number(get('year')), Number(get('month')) - 1, Number(get('day')),
    Number(get('hour')), Number(get('minute')), Number(get('second')),
  );
  return (asUtcMs - at.getTime()) / 60_000;
}

function composeMessage(t: DueTask, offset: number, dueMoment: Date, tz: string): string {
  const due = dueMoment.toLocaleTimeString('en-US', {
    timeZone: tz,
    hour: 'numeric',
    minute: '2-digit',
  });
  const bits = [`Due ${due}`];
  if (t.project?.name) bits.push(t.project.name);
  const trailer = offset === 0 ? 'At due time' : `${humanOffset(offset)} reminder`;
  return `${bits.join(' · ')}\n${trailer}`;
}

function humanOffset(min: number): string {
  if (min === 0) return 'now';
  if (min < 60) return `${min} min`;
  if (min === 60) return '1 hour';
  if (min % 60 === 0) return `${min / 60} hours`;
  return `${min} min`;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}
