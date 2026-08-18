'use client';

import { useState } from 'react';

// Appearance — theme preference (Light / System / Dark). Cookie-only
// (`jops2.theme`): the root layout reads it server-side to stamp
// <html data-theme> before paint, so there's no FOUC and no API round-trip.
// Per-browser by design — a phone can follow its OS while a desktop pins
// light. "System" clears the attribute and lets prefers-color-scheme decide.

export type ThemePref = 'light' | 'system' | 'dark';

const OPTIONS: { value: ThemePref; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'system', label: 'System' },
  { value: 'dark', label: 'Dark' },
];

export function AppearanceForm({ initial }: { initial: ThemePref }) {
  const [pref, setPref] = useState<ThemePref>(initial);

  function apply(next: ThemePref) {
    setPref(next);
    // 1-year cookie, same shape as PrefsPersist writes.
    document.cookie = `jops2.theme=${next}; path=/; max-age=31536000; samesite=lax`;
    const root = document.documentElement;
    if (next === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', next);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="inline-flex self-start border border-line-strong rounded overflow-hidden" role="radiogroup" aria-label="Theme">
        {OPTIONS.map((o, i) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={pref === o.value}
            onClick={() => apply(o.value)}
            className={`px-4 py-2 font-mono text-[10px] uppercase tracking-wider transition-colors ${
              i > 0 ? 'border-l border-line-strong' : ''
            } ${
              pref === o.value ? 'bg-ink text-bg' : 'text-ink-2 hover:text-ink hover:bg-surface-2'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
      <p className="font-sans text-[12px] text-ink-3 leading-relaxed">
        System follows this device&rsquo;s appearance. The choice is saved per browser.
      </p>
    </div>
  );
}
