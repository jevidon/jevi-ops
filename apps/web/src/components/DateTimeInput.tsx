'use client';

import { useEffect, useState } from 'react';
import { parseDate } from './DateInput';
import { parseTime } from './TimeInput';

// Hybrid datetime picker: native <input type="datetime-local"> on top
// for mobile + most desktops, plus a permissive text fallback below
// for Safari desktop (whose pickers are uneven) and anyone who prefers
// typing. Both sync to the same hidden "YYYY-MM-DDTHH:MM" value that
// gets submitted.
//
// The text fallback accepts a wide range:
//
//   2026-05-23 17:30          → 2026-05-23T17:30
//   5/23/2026 5:30 PM         → 2026-05-23T17:30
//   May 23, 2026 5:30 pm      → 2026-05-23T17:30
//   today 5:30 PM             → today's date at 17:30
//   yesterday noon            → yesterday at 12:00
//
// If only a date is provided, the time defaults to 12:00; only a time
// → today's date. Bare date or bare time still produce a valid
// combined value; this is what the existing form callers expect.

interface DateTimeInputProps {
  name: string;
  defaultValue?: string;   // YYYY-MM-DDTHH:MM
  disabled?: boolean;
  className?: string;
  placeholder?: string;
  'aria-label'?: string;
  title?: string;
}

export function DateTimeInput({
  name,
  defaultValue = '',
  disabled,
  className,
  placeholder = '5/23/2026 5:30 PM',
  'aria-label': ariaLabel,
  title,
}: DateTimeInputProps) {
  // The input field expects "YYYY-MM-DDTHH:MM"; we show a friendlier
  // text format but the hidden field always carries the native shape.
  const [text, setText] = useState(formatDisplay(defaultValue));
  const [normalized, setNormalized] = useState(defaultValue);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setText(formatDisplay(defaultValue));
    setNormalized(defaultValue);
  }, [defaultValue]);

  function commit(raw: string) {
    const trimmed = raw.trim();
    if (!trimmed) {
      setNormalized('');
      setError(null);
      return;
    }
    const result = parseDateTime(trimmed);
    if (result) {
      setNormalized(result);
      setText(formatDisplay(result));
      setError(null);
    } else {
      setError('Use e.g. 5/23/2026 5:30 PM or YYYY-MM-DD HH:MM');
      setNormalized('');
    }
  }

  return (
    <div className="flex flex-col gap-1">
      {/* Native picker — primary UX. Value matches the
          datetime-local format "YYYY-MM-DDTHH:MM". */}
      <input
        type="datetime-local"
        value={normalized}
        onChange={(e) => {
          const v = e.target.value;
          setNormalized(v);
          setText(formatDisplay(v));
          setError(null);
        }}
        disabled={disabled}
        aria-label={ariaLabel}
        title={title}
        className={className}
      />
      {/* Text fallback — for Safari desktop and anyone who'd rather
          type "5/23/2026 5:30 PM" than fiddle with two spinners. */}
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
        aria-label={ariaLabel ? `${ariaLabel} (type)` : 'type date and time'}
        title={title}
        className={`${className ?? ''} text-[12px] opacity-70 focus:opacity-100`}
      />
      <input type="hidden" name={name} value={normalized} />
      {error && (
        <div className="font-mono text-[10px] uppercase tracking-wider text-accent">
          {error}
        </div>
      )}
    </div>
  );
}

// Show the stored "YYYY-MM-DDTHH:MM" as "YYYY-MM-DD HH:MM" (space
// instead of T) for friendlier display + round-trippable input.
function formatDisplay(value: string): string {
  return value ? value.replace('T', ' ') : '';
}

function todayInAppTz(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Denver',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${g('year')}-${g('month')}-${g('day')}`;
}

// Split the raw string into a date part + time part. The strategy:
// try parsing the whole thing as a time (e.g. "5:30 PM") — if it
// works, default the date to today. Otherwise split on the FIRST
// occurrence of " " between a digit and either a digit-or-letter
// that starts the time portion, and try parsing the halves.
function parseDateTime(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;

  // Pure time? Default to today.
  const asTime = parseTime(s);
  if (asTime) return `${todayInAppTz()}T${asTime}`;

  // Pure date? Default to noon.
  const asDate = parseDate(s);
  if (asDate) return `${asDate}T12:00`;

  // Otherwise look for a split point. We try multiple split positions
  // because date formats vary in length and the time may start
  // anywhere from char 5 to char 18ish.
  // Strategy: walk the string, find each space, try parsing left as
  // date + right as time. First success wins.
  const positions: number[] = [];
  for (let i = 1; i < s.length; i++) {
    if (s[i] === ' ' || s[i] === 'T' || s[i] === ',') positions.push(i);
  }
  for (const i of positions) {
    const left = s.slice(0, i).trim().replace(/,$/, '');
    const right = s.slice(i + 1).trim();
    if (!left || !right) continue;
    const date = parseDate(left);
    if (!date) continue;
    const time = parseTime(right);
    if (!time) continue;
    return `${date}T${time}`;
  }
  return null;
}
