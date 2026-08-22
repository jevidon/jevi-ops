// Timezone-aware date helpers. Day boundaries must be computed in the app's
// local timezone (app_settings.timezone, default America/Denver), never UTC —
// otherwise a cron firing near midnight, or a "today" lookup, rolls to the
// wrong calendar day. Extracted from daily-summary.ts so every module that
// reasons about local days (daily summary, the Daily Rule / shutdown flow)
// shares one implementation.

// YYYY-MM-DD for the given instant, in the target timezone.
export function formatInTz(d: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

// Today's local calendar date (YYYY-MM-DD) in the target timezone.
export function todayInTz(tz: string): string {
  return formatInTz(new Date(), tz);
}

// Minutes east of UTC for `tz` at instant `at` (DST-correct).
export function getTzOffsetMinutes(at: Date, tz: string): number {
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

// The UTC ISO instant of a given wall-clock time (hours:minutes) on a local
// date, in `tz`. Server-tz-independent: we never parse a bare date string in
// the process's local zone. We take the wall-clock as if it were UTC, measure
// the tz offset at that instant, and correct — so 00:00 America/Denver on a
// summer day resolves to 06:00Z, DST-aware.
export function localWallTimeIso(
  localDate: string,
  hours: number,
  minutes: number,
  tz: string,
): string {
  const [y, m, d] = localDate.split('-').map((s) => parseInt(s, 10));
  const asIfUtc = Date.UTC(y!, m! - 1, d!, hours, minutes, 0);
  const offsetMin = getTzOffsetMinutes(new Date(asIfUtc), tz);
  return new Date(asIfUtc - offsetMin * 60_000).toISOString();
}

// The UTC ISO instant of 00:00 local time on the given local date.
export function startOfLocalDayIso(localDate: string, tz: string): string {
  return localWallTimeIso(localDate, 0, 0, tz);
}

// The UTC instants bounding the app-tz calendar day [start, end): local
// midnight of `localDate` through local midnight of the next day. Use this
// for any "events today" query — a raw `${date}T00:00:00Z` window is the
// UTC day, which drops evening events in west-of-UTC zones.
export function dayWindowUtc(localDate: string, tz: string): { start: string; end: string } {
  return {
    start: startOfLocalDayIso(localDate, tz),
    end: startOfLocalDayIso(addDays(localDate, 1), tz),
  };
}

// Local date `n` days after `localDate` (n may be negative). Pure calendar
// arithmetic: build the UTC-midnight instant of localDate+n and read its date
// back in UTC (a calendar date is timezone-independent). Formatting the result
// in a west-of-UTC zone would roll it back a day, so we format in UTC.
export function addDays(localDate: string, n: number): string {
  const [y, m, d] = localDate.split('-').map((s) => parseInt(s, 10));
  const dt = new Date(Date.UTC(y!, m! - 1, d! + n));
  return formatInTz(dt, 'UTC');
}

// Day of week for a local calendar date: 0 = Sunday .. 6 = Saturday. A
// calendar date has a fixed weekday regardless of timezone, so this reads
// the YYYY-MM-DD directly.
export function localWeekday(localDate: string): number {
  const [y, m, d] = localDate.split('-').map((s) => parseInt(s, 10));
  return new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay();
}

// Current wall-clock time in `tz` as minutes since local midnight (with
// fractional seconds). Used by time-of-day cron gating.
export function nowMinutesInTz(tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? '0');
  // Intl returns '24' for midnight in some locales; clamp.
  const h = g('hour') === 24 ? 0 : g('hour');
  return h * 60 + g('minute') + g('second') / 60;
}
