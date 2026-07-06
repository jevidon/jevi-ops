import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { sendPushover, isPushoverConfigured } from './pushover.js';
import type { Db } from './db.js';
import { tasks as tasksTable } from '../db/schema.js';
import { env } from './env.js';
import { getAppTz } from './app-settings.js';

// Overdue alerts — finds open tasks whose due_date+due_time elapsed between
// 5 minutes and 24 hours ago and the user never marked them done. Sends one
// Pushover per task per overdue event (dedup via reminders_sent.overdue).
//
// Intended to run hourly during waking hours (e.g., 8am-9pm Mountain). The
// 5-minute floor avoids racing the per-minute reminders cron; the 24-hour
// ceiling stops us from alerting on tasks that have been stale for days.

const MIN_OVERDUE_MS = 5 * 60_000;
const MAX_OVERDUE_MS = 24 * 60 * 60_000;

interface OverdueTask {
  id: string;
  title: string;
  status: string;
  priority: number;
  due_date: string | null;
  due_time: string | null;
  reminders_sent: Record<string, string> | null;
  project: { name: string | null } | null;
}

export interface OverdueRunResult {
  considered: number;
  dispatched: number;
  failed: number;
}

export async function runOverdue(db: Db): Promise<OverdueRunResult> {
  if (!isPushoverConfigured()) {
    return { considered: 0, dispatched: 0, failed: 0 };
  }
  const tz = await getAppTz();

  const now = new Date();
  const dates = [
    isoDate(addDays(now, -1)),
    isoDate(now),
  ];

  const tasks: OverdueTask[] = await db.query.tasks.findMany({
    columns: {
      id: true, title: true, status: true, priority: true,
      due_date: true, due_time: true, reminders_sent: true,
    },
    with: { project: { columns: { name: true } } },
    where: and(
      eq(tasksTable.status, 'open'),
      isNotNull(tasksTable.due_time),
      inArray(tasksTable.due_date, dates),
    ),
    limit: 500,
  });

  let dispatched = 0;
  let failed = 0;

  for (const t of tasks) {
    if (!t.due_date || !t.due_time) continue;
    const sent = t.reminders_sent ?? {};
    if (sent.overdue) continue; // already alerted

    const dueMoment = composeDueMoment(t.due_date, t.due_time, tz);
    if (!dueMoment) continue;
    const elapsed = now.getTime() - dueMoment.getTime();
    if (elapsed < MIN_OVERDUE_MS) continue; // not overdue yet
    if (elapsed > MAX_OVERDUE_MS) continue; // too stale

    const lateMinutes = Math.floor(elapsed / 60_000);
    const result = await sendPushover({
      title: `Overdue · ${t.title}`,
      message: composeMessage(t, lateMinutes, dueMoment, tz),
      url: `${env.WEB_APP_URL.replace(/\/$/, '')}/tasks/${t.id}`,
      url_title: 'Open task',
      priority: t.priority === 1 ? 1 : 0,
    });

    if (result.ok) {
      const newSent = { ...sent, overdue: new Date().toISOString() };
      try {
        await db.update(tasksTable).set({ reminders_sent: newSent }).where(eq(tasksTable.id, t.id));
        dispatched += 1;
      } catch {
        failed += 1;
      }
    } else {
      failed += 1;
    }
  }

  return { considered: tasks.length, dispatched, failed };
}

function composeDueMoment(dueDate: string, dueTime: string, tz: string): Date | null {
  const time = dueTime.length === 5 ? `${dueTime}:00` : dueTime;
  try {
    const local = new Date(`${dueDate}T${time}`);
    if (isNaN(local.getTime())) return null;
    const tzOffsetMin = getTzOffsetMinutes(local, tz);
    return new Date(local.getTime() - tzOffsetMin * 60_000);
  } catch {
    return null;
  }
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

function composeMessage(t: OverdueTask, lateMinutes: number, dueMoment: Date, tz: string): string {
  const due = dueMoment.toLocaleTimeString('en-US', {
    timeZone: tz,
    hour: 'numeric',
    minute: '2-digit',
  });
  const bits = [`Was due ${due}`];
  if (t.project?.name) bits.push(t.project.name);
  return `${bits.join(' · ')}\n${humanLate(lateMinutes)} overdue`;
}

function humanLate(min: number): string {
  if (min < 60) return `${min} min`;
  if (min < 60 * 24) {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  return `${Math.floor(min / 60 / 24)}d`;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}
