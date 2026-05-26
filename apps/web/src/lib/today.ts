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
