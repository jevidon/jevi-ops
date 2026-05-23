// Streak + completion-rate math for routines.
//
// Pure function over a set of YYYY-MM-DD completion dates. No DB access,
// no timezone fuss — the caller is responsible for choosing what "today"
// means in the user's locale and passing it in.
//
// Why pure: the API computes these on read so the daily UI shows current
// numbers, and the heatmap view re-derives them from the same data so we
// can't drift between two surfaces.

export interface RoutineStats {
  // Days completed in a consecutive run ending today (or yesterday if
  // today isn't done yet but yesterday was). 0 if no current run.
  current_streak: number;
  // Longest consecutive run anywhere in history. >= current_streak.
  longest_streak: number;
  // Completions in the last 7 / 30 days (counting today).
  completions_7d: number;
  completions_30d: number;
  // Total completions across all time.
  total: number;
  // Whether today specifically has a completion. Used by the daily widget.
  done_today: boolean;
}

function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.UTC(
    parseInt(fromIso.slice(0, 4), 10),
    parseInt(fromIso.slice(5, 7), 10) - 1,
    parseInt(fromIso.slice(8, 10), 10),
  );
  const to = Date.UTC(
    parseInt(toIso.slice(0, 4), 10),
    parseInt(toIso.slice(5, 7), 10) - 1,
    parseInt(toIso.slice(8, 10), 10),
  );
  return Math.round((to - from) / 86_400_000);
}

function isoOf(year: number, month0: number, day: number): string {
  const d = new Date(Date.UTC(year, month0, day));
  return d.toISOString().slice(0, 10);
}

function yesterday(iso: string): string {
  const y = parseInt(iso.slice(0, 4), 10);
  const m = parseInt(iso.slice(5, 7), 10) - 1;
  const d = parseInt(iso.slice(8, 10), 10);
  const date = new Date(Date.UTC(y, m, d - 1));
  return date.toISOString().slice(0, 10);
}

// Given a set of completion dates and "today", compute the stats above.
// completionDates can be any order; we materialize a Set for O(1) hits.
export function computeRoutineStats(
  completionDates: readonly string[],
  todayIso: string,
): RoutineStats {
  const set = new Set(completionDates);

  // ── Current streak ─────────────────────────────────────────────────
  // Walk backwards from today. If today isn't done, start from yesterday
  // — a streak isn't broken until you miss a full day. If yesterday also
  // isn't done, the current streak is 0.
  let current = 0;
  let cursor = todayIso;
  if (!set.has(cursor)) {
    const prev = yesterday(cursor);
    if (!set.has(prev)) {
      current = 0;
    } else {
      cursor = prev;
    }
  }
  while (set.has(cursor)) {
    current += 1;
    cursor = yesterday(cursor);
  }

  // ── Longest streak ─────────────────────────────────────────────────
  // Sort completions, walk forward, count consecutive runs. Lifted into
  // its own loop so we touch the data exactly once for the full pass.
  const sorted = [...completionDates].sort();
  let longest = 0;
  let run = 0;
  let prev: string | null = null;
  for (const d of sorted) {
    if (prev !== null && daysBetween(prev, d) === 1) {
      run += 1;
    } else {
      run = 1;
    }
    if (run > longest) longest = run;
    prev = d;
  }

  // ── 7-day / 30-day windows ────────────────────────────────────────
  // Inclusive of today, going backwards.
  let completions_7d = 0;
  let completions_30d = 0;
  for (const d of completionDates) {
    const gap = daysBetween(d, todayIso);
    if (gap >= 0 && gap < 7) completions_7d += 1;
    if (gap >= 0 && gap < 30) completions_30d += 1;
  }

  return {
    current_streak: current,
    longest_streak: longest,
    completions_7d,
    completions_30d,
    total: completionDates.length,
    done_today: set.has(todayIso),
  };
}

// 30-cell calendar grid for the detail-page heatmap. Returns the last
// 30 days oldest-first so the UI can render left-to-right.
export function recentDaysGrid(
  completionDates: readonly string[],
  todayIso: string,
  days: number = 30,
): Array<{ date: string; done: boolean; isToday: boolean }> {
  const set = new Set(completionDates);
  const y = parseInt(todayIso.slice(0, 4), 10);
  const m = parseInt(todayIso.slice(5, 7), 10) - 1;
  const d = parseInt(todayIso.slice(8, 10), 10);
  const out: Array<{ date: string; done: boolean; isToday: boolean }> = [];
  for (let i = days - 1; i >= 0; i--) {
    const cell = new Date(Date.UTC(y, m, d - i));
    const iso = isoOf(cell.getUTCFullYear(), cell.getUTCMonth(), cell.getUTCDate());
    out.push({ date: iso, done: set.has(iso), isToday: iso === todayIso });
  }
  return out;
}
