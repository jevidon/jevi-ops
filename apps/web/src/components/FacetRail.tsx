'use client';

import { useState } from 'react';
import Link from 'next/link';
import { BottomSheet } from './BottomSheet';

// v2 facet rail (design handoff, Jul 2026). The ONE filtering pattern for every
// list screen — a left rail of scoped facet groups (view / domain / status /
// tag) — replacing the per-page chip rows each screen invented differently.
//
// Each row/tag renders a <Link> when given `href` (the repo's server-rendered
// query-param + PrefsPersist filtering) or a <button> when given `onClick`
// (client state).
//
// Responsive (Aug 2026): the same `children` render in BOTH the desktop left
// rail AND a mobile Filters bottom sheet, opened by a floating pill. Every
// list view (Library/Content/Work/People/Tasks) passes its facet groups once
// and gets desktop + mobile filtering with no per-screen drawer to build. The
// facet controls are client buttons wired to the view's state, so both copies
// stay in sync automatically. Views pass `activeCount` (for the pill badge)
// and `onReset`.
//
// Layout contract (do not "fix"): in a facet head the LABEL shrinks and the
// clear action is a fixed sibling; facet groups are scoped to the selected type
// so an inapplicable control never renders and can't empty the page.

export function FacetRail({
  children,
  activeCount = 0,
  onReset,
  title = 'Filters',
}: {
  children: React.ReactNode;
  activeCount?: number;
  onReset?: () => void;
  title?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Desktop rail — sticky under the 60px topbar, self-scrolling. */}
      <aside
        aria-label="Filters"
        className="hidden lg:block w-[228px] shrink-0 self-start sticky top-[60px] max-h-[calc(100dvh-60px)] overflow-y-auto border-r border-line bg-surface py-5"
      >
        {children}
      </aside>

      {/* Mobile: floating trigger just above the mic FAB row, opening a sheet
          with the identical facet groups. Fixed, so it sits outside the flow
          and never pushes the page title down. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`${title}${activeCount > 0 ? ` (${activeCount} active)` : ''}`}
        className="lg:hidden fixed left-4 z-40 inline-flex items-center gap-2 h-11 pl-3.5 pr-4 rounded-full bg-ink text-bg shadow-lg active:scale-95 transition-transform"
        style={{ bottom: 'calc(env(safe-area-inset-bottom) + 72px)' }}
      >
        <FunnelIcon />
        <span className="font-sans text-[13px] font-medium">Filters</span>
        {activeCount > 0 && (
          <span className="ml-0.5 grid place-items-center min-w-[18px] h-[18px] px-1 rounded-full bg-accent text-bg font-mono text-[10px] leading-none">
            {activeCount}
          </span>
        )}
      </button>

      <BottomSheet
        open={open}
        onClose={() => setOpen(false)}
        title={title}
        footer={
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              disabled={activeCount === 0 || !onReset}
              onClick={() => onReset?.()}
              className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3 enabled:hover:text-accent disabled:opacity-40 transition-colors"
            >
              Reset{activeCount > 0 ? ` · ${activeCount}` : ''}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="font-sans text-[13px] font-medium bg-ink text-bg px-5 py-2 rounded-full"
            >
              Show results
            </button>
          </div>
        }
      >
        <div className="pt-2 pb-1">{children}</div>
      </BottomSheet>
    </>
  );
}

function FunnelIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
      strokeLinecap="round" strokeLinejoin="round" className="h-[17px] w-[17px]" aria-hidden>
      <path d="M3 5h18l-7 8v6l-4-2v-4z" />
    </svg>
  );
}

export function FacetGroup({
  label,
  action,
  children,
}: {
  label: string;
  // e.g. a "clear" Link/button; rendered as a fixed-size sibling of the label.
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="px-5 pb-[22px]">
      <div className="flex items-center justify-between gap-2 mb-[9px]">
        <span className="eyebrow min-w-0 truncate">{label}</span>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {children}
    </div>
  );
}

// A full-width facet row: optional colour swatch, name (shrinks/ellipsis), count.
// Used for View / Domain / Status lists.
export function FacetRow({
  on = false,
  href,
  onClick,
  color,
  name,
  count,
}: {
  on?: boolean;
  href?: string;
  onClick?: () => void;
  color?: string;
  name: string;
  count?: number;
}) {
  const cls = `group flex items-center gap-[9px] w-full px-2 -mx-2 mb-[3px] py-1.5 rounded text-[13px] text-left transition-colors ${
    on ? 'bg-ink text-bg' : 'text-ink-2 hover:bg-[color:rgb(var(--ink)_/_0.045)] hover:text-ink'
  }`;
  const body = (
    <>
      {color && (
        <span
          className={`w-[9px] h-[9px] rounded-[2.5px] shrink-0 ${on ? 'ring-[1.5px] ring-bg/50' : ''}`}
          style={{ background: color }}
          aria-hidden
        />
      )}
      <span className="flex-1 min-w-0 truncate">{name}</span>
      {count != null && (
        <span className={`font-mono text-[10.5px] leading-none ${on ? 'text-bg/60' : 'text-ink-4'}`}>
          {count}
        </span>
      )}
    </>
  );
  return href ? (
    <Link href={href} className={cls} aria-current={on ? 'true' : undefined}>
      {body}
    </Link>
  ) : (
    <button type="button" onClick={onClick} className={cls} aria-pressed={on}>
      {body}
    </button>
  );
}

// Wrap FacetTags in a flex-wrap row.
export function FacetTags({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap gap-[5px]">{children}</div>;
}

// A pill-shaped facet chip: name + optional count. Used for Tag / Priority /
// Status multi-selects.
export function FacetTag({
  on = false,
  href,
  onClick,
  name,
  count,
}: {
  on?: boolean;
  href?: string;
  onClick?: () => void;
  name: string;
  count?: number;
}) {
  const cls = `inline-flex items-center gap-[5px] px-2 py-1 rounded-full border font-mono text-[10.5px] font-medium transition-colors ${
    on ? 'bg-ink border-ink text-bg' : 'border-line-strong text-ink-2 hover:border-ink-3 hover:text-ink'
  }`;
  const body = (
    <>
      {name}
      {count != null && (
        <span className={`not-italic ${on ? 'text-bg/60' : 'text-ink-4'}`}>{count}</span>
      )}
    </>
  );
  return href ? (
    <Link href={href} className={cls} aria-current={on ? 'true' : undefined}>
      {body}
    </Link>
  ) : (
    <button type="button" onClick={onClick} className={cls} aria-pressed={on}>
      {body}
    </button>
  );
}

export function FacetSep() {
  return <div className="h-px bg-line mx-5 mb-[22px]" aria-hidden />;
}
