'use client';

import { useState, useTransition } from 'react';
import { setFocusAction, clearFocusAction } from './actions';
import type { FocusTargetType } from '@/lib/api';

// Tomorrow's Focus control (Addendum 09) — the "five seconds, from anywhere"
// affordance on the Work page.
//
// Collapsed it is one quiet line: "Set tomorrow's focus" or the current pick.
// Expanded it is a flat list of candidates — one tap sets it and closes. There
// is no multi-step flow, no confirmation, and deliberately no indication
// anywhere of whether a focus was set on any previous day.

export interface FocusOption {
  type: FocusTargetType;
  id: string;
  label: string;
  context: string | null; // domain / client / status, for disambiguation
}

export function FocusControl({
  current,
  options,
  date,
}: {
  current: { title: string; href: string } | null;
  options: FocusOption[];
  // The exact day this control is editing, resolved server-side at render.
  // Passed to the actions so a click after midnight can't retarget a
  // different day than the one shown.
  date: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState('');

  const filtered = query.trim()
    ? options.filter((o) =>
        `${o.label} ${o.context ?? ''}`.toLowerCase().includes(query.trim().toLowerCase()),
      )
    : options;

  function pick(o: FocusOption) {
    setOpen(false);
    setQuery('');
    startTransition(() => setFocusAction(o.type, o.id, date));
  }

  function clear() {
    setOpen(false);
    startTransition(() => clearFocusAction(date));
  }

  return (
    <div className={`px-5 lg:px-0 mt-3 ${pending ? 'opacity-50' : ''}`}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3">
          Tomorrow
        </span>
        {current ? (
          <>
            <span className="font-sans text-[14px] text-ink">{current.title}</span>
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="font-mono text-[10px] uppercase tracking-wider text-ink-3 hover:text-accent transition-colors"
            >
              change
            </button>
            <button
              type="button"
              onClick={clear}
              className="font-mono text-[10px] uppercase tracking-wider text-ink-3 hover:text-accent transition-colors"
            >
              clear
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="font-sans text-[13px] text-ink-3 hover:text-accent transition-colors"
          >
            Set tomorrow&rsquo;s focus →
          </button>
        )}
      </div>

      {open && (
        <div className="mt-2 border border-line max-w-md">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter…"
            className="w-full bg-transparent border-b border-line px-3 py-2 font-sans text-[13px] text-ink placeholder:text-ink-3/60 focus:outline-none focus:border-accent"
          />
          <div className="max-h-72 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="px-3 py-3 font-sans text-[13px] text-ink-3 italic">
                Nothing matches.
              </p>
            ) : (
              filtered.map((o) => (
                <button
                  key={`${o.type}:${o.id}`}
                  type="button"
                  onClick={() => pick(o)}
                  className="w-full text-left px-3 py-2 border-b border-line/50 last:border-b-0 hover:bg-ink/[0.03] transition-colors"
                >
                  <span className="font-sans text-[13px] text-ink">{o.label}</span>
                  {o.context && (
                    <span className="ml-2 font-mono text-[10px] uppercase tracking-wider text-ink-3">
                      {o.context}
                    </span>
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
