'use client';

import { useRef } from 'react';

// Live filter (Wave 2 #3) — the one inline type-to-narrow control for
// list-heavy screens (Work, Tasks; adopt elsewhere as needed). Pure client
// state: the views already hold their full datasets, so this is a substring
// narrow over what's loaded, complementing the FacetRail's click facets.
// Escape (or ✕) clears; parents own the query state and matching.

// Case-insensitive substring match over any of the given fields.
export function textMatches(query: string, ...fields: (string | null | undefined)[]): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return fields.some((f) => f != null && f.toLowerCase().includes(q));
}

export function FilterInput({
  value,
  onChange,
  placeholder = 'Filter…',
  className = '',
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className={`relative flex items-center ${className}`}>
      <svg
        viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
        strokeLinecap="round" className="absolute left-0 h-[14px] w-[14px] text-ink-4 pointer-events-none"
        aria-hidden
      >
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.8-3.8" />
      </svg>
      <input
        ref={inputRef}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            onChange('');
            inputRef.current?.blur();
          }
        }}
        placeholder={placeholder}
        aria-label="Filter list"
        className="w-full bg-transparent border-b border-line focus:border-ink-2 focus:outline-none pl-6 pr-6 py-1.5 font-sans text-[13.5px] text-ink placeholder:text-ink-4 [&::-webkit-search-cancel-button]:hidden"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Clear filter"
          className="absolute right-0 font-mono text-[11px] text-ink-3 hover:text-ink transition-colors"
        >
          ✕
        </button>
      )}
    </div>
  );
}
