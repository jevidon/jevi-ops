'use client';

import { useEffect, useState } from 'react';

// Hybrid time picker: native <input type="time"> on top for mobile +
// most desktops, plus a permissive text fallback below for Safari
// desktop (whose time picker is unreliable / rejects anything that
// isn't HH:MM) and anyone who prefers typing. Both inputs sync to the
// same hidden HH:MM value that gets submitted.
//
// The text fallback parses generously:
//
//   5:30 PM / 5:30pm / 5:30 p.m.  → 17:30
//   5:30 AM / 5:30am              → 05:30
//   17:30 / 17:30:00              → 17:30
//   1730                           → 17:30
//   5 pm / 5pm                     → 17:00
//   noon / midnight                → 12:00 / 00:00
//
// The form submits the normalized 24-hour HH:MM via a hidden input,
// so existing server actions keep working unchanged.

interface TimeInputProps {
  name: string;
  defaultValue?: string;   // HH:MM (24-hour) or HH:MM:SS
  required?: boolean;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
  'aria-label'?: string;
  title?: string;
  // Fires on each keystroke with the raw visible text. Useful when a
  // sibling control needs to react to "user typed something" before
  // blur — e.g. enabling a reminder checkbox only after a time is set.
  onTextChange?: (raw: string) => void;
}

export function TimeInput({
  name,
  defaultValue = '',
  required,
  disabled,
  className,
  placeholder = '5:30 PM or 17:30',
  'aria-label': ariaLabel,
  title,
  onTextChange,
}: TimeInputProps) {
  // Trim any :SS the DB might return so the field shows "07:30" not "07:30:00".
  const normalizeIn = (v: string) => (v ? v.slice(0, 5) : '');

  const [text, setText] = useState(normalizeIn(defaultValue));
  const [normalized, setNormalized] = useState(normalizeIn(defaultValue));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setText(normalizeIn(defaultValue));
    setNormalized(normalizeIn(defaultValue));
  }, [defaultValue]);

  function commit(raw: string) {
    const trimmed = raw.trim();
    if (!trimmed) {
      setNormalized('');
      setError(null);
      return;
    }
    const hhmm = parseTime(trimmed);
    if (hhmm) {
      setNormalized(hhmm);
      setText(hhmm);
      setError(null);
    } else {
      setError('Use 5:30 PM, 17:30, or 1730');
      setNormalized('');
    }
  }

  return (
    <div className="flex flex-col gap-1">
      {/* Native picker — primary UX everywhere it works. Value is
          always the normalized HH:MM. */}
      <input
        type="time"
        value={normalized}
        onChange={(e) => {
          const v = e.target.value;
          setNormalized(v);
          setText(v);
          setError(null);
          onTextChange?.(v);
        }}
        required={required}
        disabled={disabled}
        aria-label={ariaLabel}
        title={title}
        className={className}
      />
      {/* Text fallback — for Safari desktop (broken time picker) and
          anyone who prefers typing "5:30 PM" instead of HH:MM. */}
      <input
        type="text"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          onTextChange?.(e.target.value);
        }}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
        disabled={disabled}
        placeholder={placeholder}
        autoComplete="off"
        aria-label={ariaLabel ? `${ariaLabel} (type)` : 'type time'}
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

// ─── Parsing ────────────────────────────────────────────────────────────

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

export function parseTime(raw: string): string | null {
  const s = raw.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!s) return null;

  if (s === 'noon') return '12:00';
  if (s === 'midnight') return '00:00';

  // 24-hour HH:MM[:SS]
  let m = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (m) {
    const h = Number(m[1]);
    const mn = Number(m[2]);
    if (h <= 23 && mn <= 59) return `${pad2(h)}:${pad2(mn)}`;
    return null;
  }

  // 12-hour H[:MM] (a|p)[m] — handles "5pm", "5 pm", "5:30 PM", "5:30 p.m.", etc.
  m = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(a|p)(?:\.?m\.?)?$/);
  if (m) {
    let h = Number(m[1]);
    const mn = m[2] ? Number(m[2]) : 0;
    const period = m[3]!;
    if (h < 1 || h > 12 || mn > 59) return null;
    if (period === 'p' && h !== 12) h += 12;
    if (period === 'a' && h === 12) h = 0;
    return `${pad2(h)}:${pad2(mn)}`;
  }

  // Compact 4-digit ("1730"), 3-digit ("730" → 07:30), or 2-digit
  // ("17" → 17:00) — but only when it can't be misread as a date.
  m = s.match(/^(\d{3,4})$/);
  if (m) {
    const digits = m[1]!;
    const h = digits.length === 4 ? Number(digits.slice(0, 2)) : Number(digits.slice(0, 1));
    const mn = digits.length === 4 ? Number(digits.slice(2)) : Number(digits.slice(1));
    if (h <= 23 && mn <= 59) return `${pad2(h)}:${pad2(mn)}`;
  }

  return null;
}
