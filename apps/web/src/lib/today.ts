// Today's date in the configured app timezone, formatted as ISO yyyy-mm-dd.
// Used for top3_for_date matching, "due today" filtering, and any other
// "what day is it" decision. The timezone is now configurable via the
// /settings page; callers pass it in so this stays a pure function.

export function todayIsoDate(timezone: string, d: Date = new Date()): string {
  // Intl gives us the calendar parts in the target zone. en-CA happens to
  // render yyyy-mm-dd which is exactly what we want.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

// Tomorrow's date in the configured app timezone, yyyy-mm-dd. Mirrors the
// API's addDays(todayInTz(tz), 1): the local date is anchored at UTC midnight
// and formatted back in UTC, so a west-of-UTC zone can't roll the date back.
export function tomorrowIsoDate(timezone: string, d: Date = new Date()): string {
  const today = todayIsoDate(timezone, d);
  const next = new Date(new Date(`${today}T00:00:00Z`).getTime() + 86_400_000);
  return next.toISOString().slice(0, 10);
}

// True if the given ISO timestamp falls on today's date in the
// configured timezone. Null/undefined returns false.
export function isToday(timezone: string, isoTimestamp: string | null | undefined): boolean {
  if (!isoTimestamp) return false;
  try {
    return todayIsoDate(timezone, new Date(isoTimestamp)) === todayIsoDate(timezone);
  } catch {
    return false;
  }
}
