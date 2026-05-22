// Today's date in Mountain Time, formatted as ISO yyyy-mm-dd. Used for
// top3_for_date matching and "due today" filtering. Centralized here so the
// timezone choice is one edit when we eventually let the user configure it.

const ZONE = 'America/Denver';

export function todayIsoDate(d: Date = new Date()): string {
  // Intl gives us the calendar parts in the target zone. en-CA happens to
  // render yyyy-mm-dd which is exactly what we want.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

// True if the given ISO timestamp falls on today's date in Mountain Time.
// Null/undefined returns false. Used to filter "Completed today".
export function isToday(isoTimestamp: string | null | undefined): boolean {
  if (!isoTimestamp) return false;
  try {
    return todayIsoDate(new Date(isoTimestamp)) === todayIsoDate();
  } catch {
    return false;
  }
}
