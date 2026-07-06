import { and, asc, count, desc, eq, gte, isNull, lt, sql } from 'drizzle-orm';
import { sendPushover, isPushoverConfigured } from './pushover.js';
import type { Db } from './db.js';
import {
  calendar_events,
  notes,
  observations as observationsTable,
  tasks as tasksTable,
} from '../db/schema.js';
import { env } from './env.js';
import { getAppTz } from './app-settings.js';

// Daily morning summary — one Pushover push that covers everything you'd
// want to know before the day starts: tasks due, calendar events,
// observations, notes flagged for review. Designed to run once daily at
// ~7am Mountain via XCloud cron.
//
// Pushover messages cap at 1024 chars. We trim line-by-line if we overflow.

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

export async function runDailySummary(db: Db): Promise<DailySummaryResult> {
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
  const tz = await getAppTz();
  const todayLocal = formatInTz(new Date(), tz);

  // Fetch everything in parallel.
  const [tasks, events, observations, reviewRows] = await Promise.all([
    db.query.tasks.findMany({
      columns: { id: true, title: true, due_time: true, priority: true },
      where: and(eq(tasksTable.status, 'open'), eq(tasksTable.due_date, todayLocal)),
      orderBy: [asc(tasksTable.priority), sql`${tasksTable.due_time} asc nulls last`],
      limit: 50,
    }),
    db.query.calendar_events.findMany({
      columns: { id: true, title: true, start_at: true, all_day: true },
      where: and(
        gte(calendar_events.start_at, startOfLocalDayIso(todayLocal, tz)),
        lt(calendar_events.start_at, startOfLocalDayIso(addDays(todayLocal, 1, tz), tz)),
      ),
      orderBy: asc(calendar_events.start_at),
      limit: 50,
    }),
    db.query.observations.findMany({
      columns: { id: true, title: true, severity: true },
      where: and(isNull(observationsTable.dismissed_at), eq(observationsTable.acted_on, false)),
      orderBy: [desc(observationsTable.severity), desc(observationsTable.surfaced_at)],
      limit: 20,
    }),
    db.select({ n: count() }).from(notes).where(eq(notes.needs_review, true)),
  ]);

  const needsReviewCount = reviewRows[0]?.n ?? 0;

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

  const { title, message } = composeMessage(todayLocal, tasks, events, observations, needsReviewCount, tz);

  // If anything urgent (P1) is in the summary, bypass Do Not Disturb so
  // the morning push wakes the user. Otherwise normal priority.
  const hasUrgent = tasks.some((t) => t.priority === 1);

  const result = await sendPushover({
    title,
    message,
    url: `${env.WEB_APP_URL.replace(/\/$/, '')}/today`,
    url_title: 'Open today',
    priority: hasUrgent ? 1 : 0,
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
  tz: string,
): { title: string; message: string } {
  const date = new Date(`${todayLocal}T12:00:00Z`).toLocaleDateString('en-US', {
    timeZone: tz,
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
      const when = e.all_day ? 'all day' : formatEventTime(e.start_at, tz);
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

function formatEventTime(iso: string, tz: string): string {
  return new Date(iso).toLocaleTimeString('en-US', {
    timeZone: tz,
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

function startOfLocalDayIso(localDate: string, tz: string): string {
  // localDate is YYYY-MM-DD. Convert to ISO at 00:00 local time, then to UTC.
  const local = new Date(`${localDate}T00:00:00`);
  const tzOffsetMin = getTzOffsetMinutes(local, tz);
  return new Date(local.getTime() - tzOffsetMin * 60_000).toISOString();
}

function addDays(localDate: string, n: number, tz: string): string {
  const [y, m, d] = localDate.split('-').map((s) => parseInt(s, 10));
  const dt = new Date(Date.UTC(y!, m! - 1, d! + n));
  return formatInTz(dt, tz);
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
