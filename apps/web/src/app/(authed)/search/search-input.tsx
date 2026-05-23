'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

// Single text input that drives the global search page. Submits on Enter
// (and on a short debounce after typing) by pushing /search?q=<query>, so
// the server component re-runs the search. We do client-side debounce
// rather than each-keystroke to avoid hammering the API while typing.

export function SearchInput({ initialQuery }: { initialQuery: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [value, setValue] = useState(initialQuery);
  const ref = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Autofocus on mount — the user came here to type.
  useEffect(() => {
    ref.current?.focus();
    // Move cursor to end if there's a prefilled query.
    if (initialQuery && ref.current) {
      ref.current.setSelectionRange(initialQuery.length, initialQuery.length);
    }
  }, [initialQuery]);

  // Debounced URL push. 300ms is the sweet spot — long enough to skip
  // intermediate keystrokes, short enough to feel responsive.
  function pushQuery(next: string) {
    const trimmed = next.trim();
    const sp = new URLSearchParams(searchParams.toString());
    if (trimmed) sp.set('q', trimmed);
    else sp.delete('q');
    const qs = sp.toString();
    router.push(qs ? `/search?${qs}` : '/search');
  }

  function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const next = e.target.value;
    setValue(next);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => pushQuery(next), 300);
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    pushQuery(value);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      setValue('');
      pushQuery('');
    }
  }

  return (
    <form onSubmit={onSubmit} className="px-5 lg:px-0 pt-3">
      <input
        ref={ref}
        type="search"
        value={value}
        onChange={onChange}
        onKeyDown={onKeyDown}
        placeholder="Search notes, quotes, tasks, content, books, projects…"
        className="w-full bg-transparent border-0 border-b border-line focus:border-accent focus:outline-none py-3 font-serif text-[20px] lg:text-[24px] text-ink placeholder:text-ink-3 placeholder:font-sans placeholder:text-[14px]"
        autoComplete="off"
        spellCheck={false}
      />
      <div className="mt-1 font-mono text-[10px] uppercase tracking-wider text-ink-3">
        Type at least 2 characters · Press Esc to clear
      </div>
    </form>
  );
}
