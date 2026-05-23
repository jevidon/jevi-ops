// Recurrence patterns + helpers for repeating tasks.
//
// The DB stores recurrence as a plain text column (tasks.recurrence_rule).
// We keep the vocabulary small + flat for v1 — every supported pattern
// is a single literal string. If/when we need "every 3 weeks" or RRULE-
// style flexibility, we can extend the parser without a migration.

export const RECURRENCE_PATTERNS = [
  'daily',
  'weekdays',
  'weekly',
  'biweekly',
  'monthly',
  'yearly',
] as const;
export type RecurrencePattern = (typeof RECURRENCE_PATTERNS)[number];

export const RECURRENCE_LABELS: Record<RecurrencePattern, string> = {
  daily: 'Daily',
  weekdays: 'Weekdays',
  weekly: 'Weekly',
  biweekly: 'Every 2 weeks',
  monthly: 'Monthly',
  yearly: 'Yearly',
};

// Glyph shown on task rows to indicate recurrence at a glance.
export const RECURRENCE_GLYPH = '↻';

export function isRecurrencePattern(s: unknown): s is RecurrencePattern {
  return typeof s === 'string' && (RECURRENCE_PATTERNS as readonly string[]).includes(s);
}

// ─── Date math ────────────────────────────────────────────────────────
//
// All dates round-trip as YYYY-MM-DD strings — that's the wire format
// PostgreSQL `date` columns and HTML <input type="date"> agree on. We
// do the math in UTC to dodge DST shifts; a "due date" is a calendar
// day, not an instant.

function parseIsoDate(iso: string): Date {
  // Anchor at noon UTC so DST never shifts the day.
  return new Date(iso + 'T12:00:00Z');
}

function formatIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, n: number): Date {
  const next = new Date(d);
  next.setUTCDate(next.getUTCDate() + n);
  return next;
}

// Adds N months while clamping to the last valid day. E.g.
// Jan 31 + 1mo = Feb 28 (or 29 in a leap year), not Mar 3 like
// JS's native overflow.
function addMonthsClamped(d: Date, n: number): Date {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const day = d.getUTCDate();
  const targetMonthDate = new Date(Date.UTC(y, m + n, 1, 12, 0, 0));
  // Last day of the target month: day 0 of the month *after* it.
  const lastDay = new Date(Date.UTC(targetMonthDate.getUTCFullYear(), targetMonthDate.getUTCMonth() + 1, 0))
    .getUTCDate();
  const clamped = Math.min(day, lastDay);
  return new Date(Date.UTC(targetMonthDate.getUTCFullYear(), targetMonthDate.getUTCMonth(), clamped, 12, 0, 0));
}

// Compute the next due date after completing a recurring task.
//
// Behavior decisions worth flagging:
//
//   1. We advance from max(currentDue, today). If you complete a weekly
//      task that was overdue by a month, we don't re-spawn it 7 days in
//      the past — we move 7 days from today. Otherwise you'd immediately
//      have to mark it done again, which defeats the purpose.
//
//   2. We never return a date in the past. If somehow the math lands on
//      <= today we add another increment until we clear today.
//
//   3. For 'weekdays', we always land on Mon-Fri. Stepping to Sat/Sun
//      pushes through to Monday.
export function nextDueDate(params: {
  currentDue: string | null | undefined;
  rule: RecurrencePattern;
  todayIso: string;
}): string {
  const today = parseIsoDate(params.todayIso);
  const baseFromCurrent = params.currentDue ? parseIsoDate(params.currentDue) : null;
  // Start from whichever is later — current due, or today.
  const start = baseFromCurrent && baseFromCurrent > today ? baseFromCurrent : today;

  const step = (from: Date): Date => {
    switch (params.rule) {
      case 'daily':
        return addDays(from, 1);
      case 'weekdays': {
        let d = addDays(from, 1);
        while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d = addDays(d, 1);
        return d;
      }
      case 'weekly':
        return addDays(from, 7);
      case 'biweekly':
        return addDays(from, 14);
      case 'monthly':
        return addMonthsClamped(from, 1);
      case 'yearly':
        return addMonthsClamped(from, 12);
    }
  };

  let next = step(start);
  // Safety belt: if (somehow) we landed on or before today, step again.
  // Capped at a few iterations so a buggy rule can't infinite-loop.
  let safety = 8;
  while (next <= today && safety-- > 0) {
    next = step(next);
  }
  return formatIsoDate(next);
}

// ─── Period-window helpers for recurring checklist items ──────────────
//
// A recurring checklist item is "currently done" if it was marked done
// within the current period. The period start is rule-dependent:
//   daily       → today at 00:00
//   weekdays    → today at 00:00 if today is a weekday; else previous Monday
//   weekly      → most recent Monday at 00:00
//   biweekly    → same as weekly but the period is 14 days
//   monthly     → 1st of this month at 00:00
//   yearly      → Jan 1 of this year at 00:00
//
// "now" is passed in so the caller controls the timezone interpretation;
// the helpers do plain UTC math on the timestamp the caller gives them.

export function periodStart(
  rule: RecurrencePattern,
  nowMs: number,
): number {
  const d = new Date(nowMs);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const day = d.getUTCDate();

  switch (rule) {
    case 'daily':
      return Date.UTC(y, m, day);
    case 'weekdays': {
      const dow = d.getUTCDay(); // 0=Sun..6=Sat
      // Saturday → most recent Friday. Sunday → previous Friday.
      // Otherwise → today.
      if (dow === 6) return Date.UTC(y, m, day - 1);
      if (dow === 0) return Date.UTC(y, m, day - 2);
      return Date.UTC(y, m, day);
    }
    case 'weekly': {
      // Monday-anchored week.
      const dow = d.getUTCDay();
      const daysBack = dow === 0 ? 6 : dow - 1;
      return Date.UTC(y, m, day - daysBack);
    }
    case 'biweekly': {
      // Same anchor as weekly; the "period" is the latest 14-day window.
      // We approximate by going back to the most recent Monday and then
      // back another 7 days only if the most-recent-Monday is < 14 days
      // ago. Simpler: just use a 14-day rolling window ending at "now".
      return nowMs - 14 * 86_400_000;
    }
    case 'monthly':
      return Date.UTC(y, m, 1);
    case 'yearly':
      return Date.UTC(y, 0, 1);
  }
}

// Whether a recurring checklist item should render as "currently done":
// true if it has a done_at within the current period AND done is true.
// For non-recurring items the caller can just check `done`; this helper
// is only meaningful when a recurrence rule is set.
export function isCurrentlyDoneRecurring(
  done: boolean,
  doneAtIso: string | null | undefined,
  rule: RecurrencePattern,
  nowMs: number = Date.now(),
): boolean {
  if (!done || !doneAtIso) return false;
  const doneMs = Date.parse(doneAtIso);
  if (Number.isNaN(doneMs)) return false;
  return doneMs >= periodStart(rule, nowMs);
}
