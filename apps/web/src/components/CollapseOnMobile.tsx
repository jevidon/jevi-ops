'use client';

import { useEffect, useState } from 'react';

// <details> that starts open on desktop and collapsed on phones. CSS
// alone can't force a closed <details> open at a breakpoint, so the
// initial state syncs to the lg media query once on mount; after that
// the user's own toggles win.
export function CollapseOnMobile({
  summary,
  children,
}: {
  summary: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (window.matchMedia('(min-width: 1024px)').matches) setOpen(true);
  }, []);
  return (
    <details
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
      className="group"
    >
      <summary className="eyebrow pb-2 border-b border-line cursor-pointer list-none flex items-center justify-between hover:text-ink-2 transition-colors">
        <span>{summary}</span>
        <span
          className="font-mono text-[10px] text-ink-3 transition-transform group-open:rotate-90"
          aria-hidden
        >
          ▶
        </span>
      </summary>
      <div className="pt-4">{children}</div>
    </details>
  );
}
