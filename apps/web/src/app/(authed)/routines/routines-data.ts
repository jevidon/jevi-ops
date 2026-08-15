import type { RoutineListItem, TimeOfDayBucket } from '@/lib/api';

// Routines data layer (v2 redesign, Jul 2026). Pure helpers shared by the
// /routines client view: the part-of-day vocabulary, the summary-band math
// (ported verbatim from the old routines-analytics.tsx so the numbers don't
// move), and small formatters. Per-routine streaks come straight off
// stats.current_streak — no client recompute.

export const PART_ORDER: TimeOfDayBucket[] = ['morning', 'afternoon', 'evening', 'anytime'];
export const PART_LABEL: Record<TimeOfDayBucket, string> = {
  morning: 'Morning',
  afternoon: 'Afternoon',
  evening: 'Evening',
  anytime: 'Anytime',
};

// Within a part: specific_time ascending (6am before 9am), then position.
export function sortRoutines(a: RoutineListItem, b: RoutineListItem): number {
  if (a.specific_time && b.specific_time) return a.specific_time.localeCompare(b.specific_time);
  if (a.specific_time) return -1;
  if (b.specific_time) return 1;
  return (a.position ?? 0) - (b.position ?? 0);
}

export function formatTime(t: string | null | undefined): string | null {
  if (!t) return null;
  const m = t.match(/^(\d{2}):(\d{2})/);
  if (!m || !m[1] || !m[2]) return null;
  const h = parseInt(m[1], 10);
  const mn = m[2];
  const period = h < 12 ? 'AM' : 'PM';
  const display = h === 0 ? 12 : h <= 12 ? h : h - 12;
  return `${display}:${mn} ${period}`;
}

// A routine is "currently missed" only if today's cron flagged it AND it still
// isn't done. (Same rule the /today widget uses.)
export function isMissed(r: RoutineListItem, today: string): boolean {
  return !r.stats.done_today && r.last_missed_sent_date === today;
}

// ─── Summary-band analytics (ported from routines-analytics.tsx) ─────────────

export interface DailyRate {
  date: string; // YYYY-MM-DD, app-tz calendar day
  done: number;
  eligible: number;
  rate: number; // 0..1
}

// Last N day-isos (oldest first) anchored at todayIso. Date-part arithmetic in
// UTC so no instant/tz conversion can shift a day.
function lastNDays(todayIso: string, n: number): string[] {
  const y = parseInt(todayIso.slice(0, 4), 10);
  const m = parseInt(todayIso.slice(5, 7), 10) - 1;
  const d = parseInt(todayIso.slice(8, 10), 10);
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    out.push(new Date(Date.UTC(y, m, d - i)).toISOString().slice(0, 10));
  }
  return out;
}

// Per-day done/eligible across all active routines. Eligibility = the routine
// existed by that day (created_at <= day), so newly-added routines don't
// retroactively inflate "missed".
export function computeDailyRates(routines: RoutineListItem[], todayIso: string, days: number): DailyRate[] {
  const dates = lastNDays(todayIso, days);
  const completionSets = routines.map((r) => new Set(r.recent_completions));
  const createdOn = routines.map((r) => r.created_at.slice(0, 10));
  return dates.map((date) => {
    let done = 0;
    let eligible = 0;
    for (let i = 0; i < routines.length; i++) {
      if (createdOn[i]! > date) continue;
      eligible += 1;
      if (completionSets[i]!.has(date)) done += 1;
    }
    return { date, done, eligible, rate: eligible === 0 ? 0 : done / eligible };
  });
}

export interface Summary {
  daily: DailyRate[]; // 30 days
  rate30: number; // 0..1
  rate7: number; // 0..1
  bestStreak: { streak: number; name: string };
}

export function buildSummary(routines: RoutineListItem[], todayIso: string): Summary {
  const daily = computeDailyRates(routines, todayIso, 30);
  const t30 = daily.reduce((a, d) => ({ done: a.done + d.done, eligible: a.eligible + d.eligible }), { done: 0, eligible: 0 });
  const rate30 = t30.eligible === 0 ? 0 : t30.done / t30.eligible;
  const last7 = daily.slice(-7);
  const t7 = last7.reduce((a, d) => ({ done: a.done + d.done, eligible: a.eligible + d.eligible }), { done: 0, eligible: 0 });
  const rate7 = t7.eligible === 0 ? 0 : t7.done / t7.eligible;
  const bestStreak = routines.reduce(
    (best, r) => (r.stats.current_streak > best.streak ? { streak: r.stats.current_streak, name: r.name } : best),
    { streak: 0, name: '' },
  );
  return { daily, rate30, rate7, bestStreak };
}

// Month-block cell fill: recessed grey for a 0% day, else an ink wash that
// darkens with the day's completion rate (matches the prototype MonthBlock).
export function monthCellBg(rate: number): string {
  if (rate === 0) return 'var(--paper-3, #F2F0EA)';
  return `rgba(18,16,14,${(0.08 + rate * 0.44).toFixed(2)})`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// "Jun 28 — Jul 27" from the first/last day of a daily series. The dates are
// already app-tz calendar strings — no tz conversion.
export function rangeLabel(daily: DailyRate[]): string {
  if (daily.length === 0) return '';
  const fmt = (ymd: string) => {
    const [, m, d] = ymd.split('-').map(Number);
    return `${MONTHS[(m || 1) - 1]} ${d}`;
  };
  return `${fmt(daily[0]!.date)} — ${fmt(daily[daily.length - 1]!.date)}`;
}

// 0 = Sunday … 6 = Saturday, for the first day of the series — used to pad the
// month block so each day lands under its weekday column. Noon UTC avoids DST.
export function firstWeekday(daily: DailyRate[]): number {
  if (daily.length === 0) return 0;
  return new Date(`${daily[0]!.date}T12:00:00Z`).getUTCDay();
}
