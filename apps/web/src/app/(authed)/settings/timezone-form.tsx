'use client';

import { useActionState, useMemo, useRef, useState } from 'react';
import { updateTimezoneAction } from './actions';
import type { SyncResult } from './actions';

// Timezone picker — a searchable combobox over EVERY zone the runtime knows
// (Intl.supportedValuesOf, ~420 IANA names), so nothing needs hand-typing.
// Dependency-free: a text input filters a listbox; ↑↓ move, Enter selects,
// Esc closes. Each row shows its current UTC offset. Free text still
// submits as-is (the server action validates against Intl anyway), so a
// zone the browser doesn't list yet isn't a dead end.

// Fallback only for runtimes without Intl.supportedValuesOf (pre-2022).
const FALLBACK_TIMEZONES = [
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Phoenix',
  'America/Los_Angeles', 'America/Anchorage', 'Pacific/Honolulu',
  'Europe/London', 'Europe/Berlin', 'Europe/Paris', 'Asia/Tokyo',
  'Asia/Singapore', 'Asia/Dubai', 'Australia/Sydney', 'UTC',
];

// "GMT-6" / "GMT+5:30" for a zone, cached — computed only for rendered rows,
// client-side, on first open.
const offsetCache = new Map<string, string>();
function zoneOffset(tz: string): string {
  const hit = offsetCache.get(tz);
  if (hit) return hit;
  let label = '';
  try {
    label =
      new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'shortOffset' })
        .formatToParts(new Date())
        .find((p) => p.type === 'timeZoneName')?.value ?? '';
  } catch {
    /* unformattable zone — leave the label empty */
  }
  offsetCache.set(tz, label);
  return label;
}

// Search that forgives separators: "denver", "america denver", and
// "America/Denver" all match.
const canon = (s: string) => s.toLowerCase().replace(/[_/]+/g, ' ').trim();

export function TimezoneForm({ current }: { current: string }) {
  const [state, formAction, pending] = useActionState<SyncResult | null, FormData>(
    async (_prev, formData) => updateTimezoneAction(formData),
    null,
  );

  const zones = useMemo<string[]>(() => {
    const list =
      typeof Intl.supportedValuesOf === 'function'
        ? Intl.supportedValuesOf('timeZone')
        : FALLBACK_TIMEZONES;
    // The saved zone must be findable even if this runtime doesn't list it.
    return list.includes(current) ? list : [current, ...list];
  }, [current]);

  const [query, setQuery] = useState(current);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  // An untouched query (still exactly the saved zone) browses the full list;
  // anything typed filters it.
  const filtered = useMemo(() => {
    if (query.trim() === '' || query === current) return zones;
    const q = canon(query);
    return zones.filter((z) => canon(z).includes(q));
  }, [zones, query, current]);

  const effective = query.trim();
  const dirty = effective !== '' && effective !== current;

  function choose(tz: string) {
    setQuery(tz);
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      setOpen(true);
      e.preventDefault();
      return;
    }
    if (!open) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = e.key === 'ArrowDown'
        ? Math.min(highlight + 1, filtered.length - 1)
        : Math.max(highlight - 1, 0);
      setHighlight(next);
      listRef.current?.children[next]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      if (filtered[highlight]) {
        e.preventDefault();
        choose(filtered[highlight]);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <p className="font-sans text-[13px] text-ink-2 leading-relaxed">
        Used everywhere the app needs to know &ldquo;what day is it&rdquo; — task due
        dates, routine completions, the daily-summary cron, photo
        timestamps, the activity log. Server time doesn&rsquo;t enter into it;
        timestamps are stored in UTC and converted at the edges.
      </p>

      <div className="relative max-w-sm">
        <label className="flex flex-col gap-1">
          <span className="eyebrow">Timezone · search all zones</span>
          <input
            type="text"
            role="combobox"
            aria-expanded={open}
            aria-controls="tz-listbox"
            aria-autocomplete="list"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
              setHighlight(0);
            }}
            onFocus={() => setOpen(true)}
            // Delay lets a click land on a list row before it unmounts.
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            onKeyDown={onKeyDown}
            placeholder="e.g. Denver, Europe/Lisbon, Tokyo…"
            spellCheck={false}
            className="w-full bg-transparent border border-line focus:border-accent focus:outline-none p-2 font-sans text-[14px] text-ink"
          />
        </label>
        {open && filtered.length > 0 && (
          <ul
            id="tz-listbox"
            role="listbox"
            ref={listRef}
            className="absolute z-30 left-0 right-0 top-full mt-1 max-h-72 overflow-y-auto bg-surface border border-line-strong shadow-lg"
          >
            {filtered.map((tz, i) => (
              <li key={tz} role="option" aria-selected={tz === current}>
                <button
                  type="button"
                  // Fires before the input's delayed blur-close.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    choose(tz);
                  }}
                  onMouseEnter={() => setHighlight(i)}
                  className={`w-full flex items-baseline justify-between gap-3 px-2.5 py-1.5 text-left font-sans text-[13px] transition-colors ${
                    i === highlight ? 'bg-surface-2 text-ink' : 'text-ink-2'
                  }`}
                >
                  <span className="truncate">
                    {tz}
                    {tz === current && <span className="text-accent"> · current</span>}
                  </span>
                  <span className="font-mono text-[10px] text-ink-3 tabular-nums shrink-0">{zoneOffset(tz)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {open && filtered.length === 0 && (
          <div className="absolute z-30 left-0 right-0 top-full mt-1 bg-surface border border-line-strong px-2.5 py-2 font-sans text-[12px] text-ink-3">
            No zone matches &ldquo;{query}&rdquo; — Save will still try it as a raw IANA name.
          </div>
        )}
      </div>

      <input type="hidden" name="timezone" value={effective} />

      <div className="flex items-center gap-3 max-w-sm">
        <span className="font-mono text-[10px] uppercase tracking-wider text-ink-3">
          Current: <span className="text-ink-2">{current}</span>
        </span>
        <button
          type="submit"
          disabled={!dirty || pending}
          className="ml-auto bg-ink hover:bg-ink-2 disabled:opacity-40 disabled:cursor-not-allowed text-bg font-sans font-semibold text-[13px] uppercase tracking-wider px-4 py-2 transition-colors"
        >
          {pending ? 'Saving…' : dirty ? 'Save' : 'Saved'}
        </button>
      </div>

      {state && (
        <div
          className={`font-mono text-[11px] uppercase tracking-wider ${
            state.ok ? 'text-ink-2' : 'text-accent'
          }`}
        >
          {state.message}
        </div>
      )}
    </form>
  );
}
