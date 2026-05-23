import type { SupabaseClient } from '@supabase/supabase-js';
import { sendPushover, isPushoverConfigured } from './pushover.js';
import { env } from './env.js';

// Daily morning summary — one Pushover push that covers everything you'd
// want to know before the day starts: tasks due, calendar events,
// observations, notes flagged for review. Designed to run once daily at
// ~7am Mountain via XCloud cron.
//
// Pushover messages cap at 1024 chars. We trim line-by-line if we overflow.

const USER_TZ = 'America/Denver';
const PUSHOVER_MAX_BODY = 1024;

interface TaskRow {
  id: string;
  title: string;
  due_time: string | null;
  priority: number;
}

interface EventRow {
  id: string;
  title: string;
  start_at: string;
  all_day: boolean;
}

interface ObservationRow {
  id: string;
  title: string;
  severity: string;
}

export interface DailySummaryResult {
  sent: boolean;
  reason?: string;
  task_count: number;
  event_count: number;
  observation_count: number;
  needs_review_count: number;
}

export async function runDailySummary(sb: SupabaseClient): Promise<DailySummaryResult> {
  if (!isPushoverConfigured()) {
    return {
      sent: false,
      reason: 'pushover_not_configured',
      task_count: 0,
      event_count: 0,
      observation_count: 0,
      needs_review_count: 0,
    };
  }

  // Today's date in user's local timezone (not UTC). Avoids the edge case
  // where the cron fires at 7am Mountain but UTC has already rolled to
  // tomorrow.
  const todayLocal = formatInTz(new Date(), USER_TZ);

  // Fetch everything in parallel.
  const [tasksRes, eventsRes, obsRes, reviewRes] = await Promise.all([
    sb.from('tasks')
      .select('id, title, due_time, priority')
      .eq('status', 'open')
      .eq('due_date', todayLocal)
      .order('priority', { ascending: true })
      .order('due_time', { ascending: true, nullsFirst: false })
      .limit(50),
    sb.from('calendar_events')
      .select('id, title, start_at, all_day')
      .gte('start_at', startOfLocalDayIso(todayLocal))
      .lt('start_at', startOfLocalDayIso(addDays(todayLocal, 1)))
      .order('start_at', { ascending: true })
      .limit(50),
    sb.from('observations')
      .select('id, title, severity')
      .is('dismissed_at', null)
      .eq('acted_on', false)
      .order('severity', { ascending: false })
      .order('surfaced_at', { ascending: false })
      .limit(20),
    sb.from('notes')
      .select('id', { count: 'exact', head: true })
      .eq('needs_review', true),
  ]);

  const tasks = (tasksRes.data ?? []) as TaskRow[];
  const events = (eventsRes.data ?? []) as EventRow[];
  const observations = (obsRes.data ?? []) as ObservationRow[];
  const needsReviewCount = reviewRes.count ?? 0;

  const totalSignal =
    tasks.length + events.length + observations.length + (needsReviewCount > 0 ? 1 : 0);
  if (totalSignal === 0) {
    return {
      sent: false,
      reason: 'nothing_to_report',
      task_count: 0,
      event_count: 0,
      observation_count: 0,
      needs_review_count: 0,
    };
  }

  const { title, message } = composeMessage(todayLocal, tasks, events, observations, needsReviewCount);

  const result = await sendPushover({
    title,
    message,
    url: `${env.WEB_APP_URL.replace(/\/$/, '')}/today`,
    url_title: 'Open today',
  });

  return {
    sent: result.ok,
    reason: result.ok ? undefined : `pushover_${result.status}`,
    task_count: tasks.length,
    event_count: events.length,
    observation_count: observations.length,
    needs_review_count: needsReviewCount,
  };
}

function composeMessage(
  todayLocal: string,
  tasks: TaskRow[],
  events: EventRow[],
  observations: ObservationRow[],
  needsReviewCount: number,
): { title: string; message: string } {
  const date = new Date(`${todayLocal}T12:00:00Z`).toLocaleDateString('en-US', {
    timeZone: USER_TZ,
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });

  const title = `Daily summary · ${date}`;

  const lines: string[] = [];

  if (tasks.length > 0) {
    lines.push(`Tasks (${tasks.length}):`);
    for (const t of tasks) {
      const time = t.due_time ? formatTime(t.due_time) : '';
      const prio = t.priority <= 2 ? ' ⭐' : '';
      lines.push(`• ${t.title}${time ? ` — ${time}` : ''}${prio}`);
    }
    lines.push('');
  }

  if (events.length > 0) {
    lines.push(`Events (${events.length}):`);
    for (const e of events) {
      const when = e.all_day ? 'all day' : formatEventTime(e.start_at);
      lines.push(`• ${e.title} — ${when}`);
    }
    lines.push('');
  }

  if (observations.length > 0) {
    lines.push(`Observations (${observations.length}):`);
    for (const o of observations) {
      lines.push(`• ${o.title}`);
    }
    lines.push('');
  }

  if (needsReviewCount > 0) {
    lines.push(`${needsReviewCount} note${needsReviewCount === 1 ? '' : 's'} flagged for review`);
  }

  // Pushover body cap: 1024 chars. Drop trailing lines until we fit.
  let body = lines.join('\n').trim();
  while (body.length > PUSHOVER_MAX_BODY - 20 && lines.length > 0) {
    lines.pop();
    body = lines.join('\n').trim() + '\n…';
  }

  return { title, message: body };
}

function formatTime(timeStr: string): string {
  // timeStr looks like "14:30" or "14:30:00". Build a tz-aware time string.
  const time = timeStr.length === 5 ? `${timeStr}:00` : timeStr;
  const fakeDate = `2000-01-01T${time}`;
  const d = new Date(fakeDate);
  if (isNaN(d.getTime())) return timeStr;
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function formatEventTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', {
    timeZone: USER_TZ,
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatInTz(d: Date, tz: string): string {
  // YYYY-MM-DD in the target timezone.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

function startOfLocalDayIso(localDate: string): string {
  // localDate is YYYY-MM-DD. Convert to ISO at 00:00 local time, then to UTC.
  const local = new Date(`${localDate}T00:00:00`);
  const tzOffsetMin = getTzOffsetMinutes(local, USER_TZ);
  return new Date(local.getTime() - tzOffsetMin * 60_000).toISOString();
}

function addDays(localDate: string, n: number): string {
  const [y, m, d] = localDate.split('-').map((s) => parseInt(s, 10));
  const dt = new Date(Date.UTC(y!, m! - 1, d! + n));
  return formatInTz(dt, USER_TZ);
}

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
