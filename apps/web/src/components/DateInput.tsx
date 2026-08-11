'use client';

import { useEffect, useState } from 'react';
import { useAppTimezone } from './TimezoneProvider';

// Hybrid date picker: native <input type="date"> on top for mobile + most
// desktops (where the OS picker is the best UX), plus a permissive text
// fallback below for Safari desktop (whose picker is unreliable in PWA
// mode) and for anyone who prefers typing. Both inputs sync to the same
// hidden YYYY-MM-DD value that gets submitted.
//
// The text fallback parses generously:
//
//   2026-05-23          → 2026-05-23
//   5/23/2026           → 2026-05-23
//   5/23/26             → 2026-05-23  (2-digit year → current century)
//   5-23-26             → 2026-05-23
//   May 23 2026         → 2026-05-23
//   May 23, 2026        → 2026-05-23
//   23 May 2026         → 2026-05-23
//   today / tomorrow / yesterday → today's / +1 / -1
//
// The form posts the normalized YYYY-MM-DD via a hidden input, so all
// existing server actions keep working unchanged.

interface DateInputProps {
  name: string;
  defaultValue?: string;   // YYYY-MM-DD
  required?: boolean;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
  'aria-label'?: string;
  title?: string;
}

export function DateInput({
  name,
  defaultValue = '',
  required,
  disabled,
  className,
  placeholder = 'YYYY-MM-DD or 5/23/2026',
  'aria-label': ariaLabel,
  title,
}: DateInputProps) {
  const tz = useAppTimezone();
  // What the user sees in the field. Initialized to a friendly format
  // when we have a real value, else blank.
  const [text, setText] = useState(formatForDisplay(defaultValue));
  // What the form actually submits — always normalized YYYY-MM-DD or ''.
  const [normalized, setNormalized] = useState(defaultValue);
  const [error, setError] = useState<string | null>(null);

  // If the parent ever changes defaultValue (re-render with new data),
  // sync state. Rare for form inputs but cheap to handle.
  useEffect(() => {
    setText(formatForDisplay(defaultValue));
    setNormalized(defaultValue);
  }, [defaultValue]);

  function commit(raw: string) {
    const trimmed = raw.trim();
    if (!trimmed) {
      setNormalized('');
      setError(null);
      return;
    }
    const iso = parseDate(trimmed, tz);
    if (iso) {
      setNormalized(iso);
      setText(formatForDisplay(iso));
      setError(null);
    } else {
      setError('Use YYYY-MM-DD, 5/23/2026, or "May 23 2026"');
      // Keep the raw text visible; clear the normalized value so the
      // form won't submit a stale parsed result.
      setNormalized('');
    }
  }

  return (
    <div className="flex flex-col gap-1">
      {/* Native picker — mobile only (the OS wheel/calendar is the best
          UX there). Hidden on desktop: Safari renders an EMPTY date
          input with today's date painted in the field, which reads as a
          phantom due date. Value is always the normalized YYYY-MM-DD. */}
      <input
        type="date"
        value={normalized}
        onChange={(e) => {
          const v = e.target.value;
          setNormalized(v);
          setText(v);
          setError(null);
        }}
        required={required}
        disabled={disabled}
        aria-label={ariaLabel}
        title={title}
        className={`${className ?? ''} lg:hidden`}
      />
      {/* Text input — the only field on desktop, typing fallback on
          mobile. Permissive parser accepts a wide range of formats. */}
      <input
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
        disabled={disabled}
        placeholder={placeholder}
        autoComplete="off"
        aria-label={ariaLabel ? `${ariaLabel} (type)` : 'type date'}
        title={title}
        className={`${className ?? ''} text-[12px] opacity-70 focus:opacity-100 lg:text-[14px] lg:opacity-100`}
      />
      {/* Hidden field actually submitted to the form action — always
          the normalized YYYY-MM-DD (or blank). */}
      <input type="hidden" name={name} value={normalized} />
      {error && (
        <div className="font-mono text-[10px] uppercase tracking-wider text-accent">
          {error}
        </div>
      )}
    </div>
  );
}

// ─── Parsing ────────────────────────────────────────────────────────────

const MONTHS: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

function todayInAppTz(tz: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${g('year')}-${g('month')}-${g('day')}`;
}

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

// Validate that y/m/d is a real calendar date (catches e.g. Feb 30).
function isValidDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12) return false;
  if (d < 1 || d > 31) return false;
  const test = new Date(Date.UTC(y, m - 1, d));
  return (
    test.getUTCFullYear() === y &&
    test.getUTCMonth() === m - 1 &&
    test.getUTCDate() === d
  );
}

// Normalize a 2-digit year to a 4-digit one using a 70/30 split around
// today's century. "26" → 2026, "98" → 1998.
function expandYear(yy: number): number {
  const thisYear = new Date().getUTCFullYear();
  const thisCentury = Math.floor(thisYear / 100) * 100;
  const candidate = thisCentury + yy;
  // If "candidate" is more than 30 years in the future, assume last century.
  return candidate > thisYear + 30 ? candidate - 100 : candidate;
}

export function parseDate(raw: string, tz: string): string | null {
  const s = raw.trim().toLowerCase();
  if (!s) return null;

  // Shortcuts.
  if (s === 'today') return todayInAppTz(tz);
  if (s === 'tomorrow' || s === 'tmrw') {
    const t = todayInAppTz(tz);
    const d = new Date(`${t}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  }
  if (s === 'yesterday') {
    const t = todayInAppTz(tz);
    const d = new Date(`${t}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  }

  // ISO YYYY-MM-DD or YYYY/MM/DD
  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    if (isValidDate(y, mo, d)) return `${y}-${pad2(mo)}-${pad2(d)}`;
    return null;
  }

  // US-style M/D/YYYY or M/D/YY or M-D-YYYY / M-D-YY
  m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2}|\d{4})$/);
  if (m) {
    const mo = Number(m[1]);
    const d = Number(m[2]);
    const yRaw = Number(m[3]);
    const y = m[3]!.length === 2 ? expandYear(yRaw) : yRaw;
    if (isValidDate(y, mo, d)) return `${y}-${pad2(mo)}-${pad2(d)}`;
    return null;
  }

  // "May 23 2026" / "May 23, 2026" / "23 May 2026"
  // Strip commas to simplify.
  const flat = s.replace(/,/g, '');
  // Month-first
  m = flat.match(/^([a-z]+)\s+(\d{1,2})\s+(\d{2}|\d{4})$/);
  if (m && MONTHS[m[1]!]) {
    const mo = MONTHS[m[1]!]!;
    const d = Number(m[2]);
    const yRaw = Number(m[3]);
    const y = m[3]!.length === 2 ? expandYear(yRaw) : yRaw;
    if (isValidDate(y, mo, d)) return `${y}-${pad2(mo)}-${pad2(d)}`;
    return null;
  }
  // Day-first ("23 May 2026")
  m = flat.match(/^(\d{1,2})\s+([a-z]+)\s+(\d{2}|\d{4})$/);
  if (m && MONTHS[m[2]!]) {
    const d = Number(m[1]);
    const mo = MONTHS[m[2]!]!;
    const yRaw = Number(m[3]);
    const y = m[3]!.length === 2 ? expandYear(yRaw) : yRaw;
    if (isValidDate(y, mo, d)) return `${y}-${pad2(mo)}-${pad2(d)}`;
    return null;
  }
  // "May 23" / "23 May" — assume current year
  m = flat.match(/^([a-z]+)\s+(\d{1,2})$/);
  if (m && MONTHS[m[1]!]) {
    const mo = MONTHS[m[1]!]!;
    const d = Number(m[2]);
    const y = new Date().getUTCFullYear();
    if (isValidDate(y, mo, d)) return `${y}-${pad2(mo)}-${pad2(d)}`;
    return null;
  }
  m = flat.match(/^(\d{1,2})\s+([a-z]+)$/);
  if (m && MONTHS[m[2]!]) {
    const d = Number(m[1]);
    const mo = MONTHS[m[2]!]!;
    const y = new Date().getUTCFullYear();
    if (isValidDate(y, mo, d)) return `${y}-${pad2(mo)}-${pad2(d)}`;
    return null;
  }

  return null;
}

// Display "2026-05-23" as itself — ISO is already the most universal
// readable shape. We could make it "May 23, 2026" but keeping ISO is
// simplest and round-trips with what the user typed.
function formatForDisplay(iso: string): string {
  return iso;
}
