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
  'quarterly',
  'semiannually',
  'yearly',
] as const;
export type RecurrencePattern = (typeof RECURRENCE_PATTERNS)[number];

export const RECURRENCE_LABELS: Record<RecurrencePattern, string> = {
  daily: 'Daily',
  weekdays: 'Weekdays',
  weekly: 'Weekly',
  biweekly: 'Every 2 weeks',
  monthly: 'Monthly',
  quarterly: 'Every 3 months',
  semiannually: 'Every 6 months',
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
//   1. The cadence is anchored to the ORIGINAL due date, not the completion
//      date. A weekly task due Sunday that you check off on Monday still
//      recurs on Sunday — we step from the original due date by whole
//      recurrence increments. Completing late never shifts the schedule.
//
//   2. We never return a date in the past. If the task was overdue, we keep
//      stepping (preserving the day-of-week / day-of-month) until the next
//      occurrence lands strictly after today — so you don't immediately have
//      to check it off again, but it stays on its original day.
//
//   3. For 'weekdays', we always land on Mon-Fri. Stepping to Sat/Sun
//      pushes through to Monday.
//
//   4. With no currentDue (a recurring task that had no date), we anchor to
//      today since there's no original day to preserve.
export function nextDueDate(params: {
  currentDue: string | null | undefined;
  rule: RecurrencePattern;
  todayIso: string;
}): string {
  const today = parseIsoDate(params.todayIso);
  // Anchor to the original due date so the cadence / day-of-week is preserved
  // even when completed late. No due date → anchor to today.
  const base = params.currentDue ? parseIsoDate(params.currentDue) : today;

  // N whole increments from the anchor. Month-based rules recompute from
  // the anchor each time (never from the previous step) so day-clamping
  // can't erode an anchored month-end day: quarterly on Jan 31, overdue
  // past April's clamp to the 30th, still lands on Jul 31 — not Jul 30.
  // Day-based rules are exact either way; 'weekdays' walks day by day.
  const stepN = (n: number): Date => {
    switch (params.rule) {
      case 'daily':
        return addDays(base, n);
      case 'weekdays': {
        let d = base;
        for (let i = 0; i < n; i++) {
          d = addDays(d, 1);
          while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d = addDays(d, 1);
        }
        return d;
      }
      case 'weekly':
        return addDays(base, 7 * n);
      case 'biweekly':
        return addDays(base, 14 * n);
      case 'monthly':
        return addMonthsClamped(base, n);
      case 'quarterly':
        return addMonthsClamped(base, 3 * n);
      case 'semiannually':
        return addMonthsClamped(base, 6 * n);
      case 'yearly':
        return addMonthsClamped(base, 12 * n);
    }
  };

  // Advance whole increments until strictly after today. Every increment
  // moves at least one day, so this terminates; the cap is a generous
  // backstop (covers a daily task overdue by years).
  let n = 1;
  let next = stepN(1);
  let safety = 4000;
  while (next <= today && safety-- > 0) {
    next = stepN(++n);
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
//   quarterly   → 1st of this calendar quarter at 00:00
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
    case 'quarterly':
      // Calendar-quarter anchor: Jan/Apr/Jul/Oct 1st.
      return Date.UTC(y, Math.floor(m / 3) * 3, 1);
    case 'semiannually':
      // Calendar half-year anchor: Jan 1 if we're in H1, Jul 1 if H2.
      // Keeps "done this half" feeling stable until the half flips.
      return Date.UTC(y, m < 6 ? 0 : 6, 1);
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
