'use client';

import { useRouter, usePathname } from 'next/navigation';
import { Icon } from './Icon';
import { CrumbTrail, useCrumbTrail } from './crumbs/crumbs';

// v2 topbar (design handoff, Jul 2026). 60px, desktop only. Left: a breadcrumb
// (Tab / subtitle) derived from the route. Right: a search affordance and the
// Capture button.
//
// Search here routes to /search (matching the existing ⌘K behaviour) rather
// than doing per-page scoped filtering — the handoff's "search scoped to the
// current page" is deferred to the per-screen rebuilds, so this stays a
// faithful entry point without faking a filter that doesn't exist yet.

// First path segment → breadcrumb label + subtitle. Unlisted routes fall back
// to a capitalised segment with no subtitle.
const CRUMBS: Record<string, { label: string; sub?: string }> = {
  today: { label: 'Today', sub: 'Briefing' },
  work: { label: 'Work', sub: "Manager's map" },
  tasks: { label: 'Tasks', sub: 'Everything open' },
  content: { label: 'Content', sub: 'Pipeline' },
  people: { label: 'People', sub: 'Relationships' },
  companies: { label: 'Companies', sub: 'CRM' },
  library: { label: 'Library', sub: 'Archive' },
  routines: { label: 'Routines', sub: 'Daily habits' },
  attention: { label: 'Attention' },
  notifications: { label: 'Notifications' },
  settings: { label: 'Settings' },
  search: { label: 'Search' },
  chat: { label: 'Ask' },
  health: { label: 'Health' },
};

function dispatchOpenCapture() {
  const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform);
  window.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'j', code: 'KeyJ', metaKey: isMac, ctrlKey: !isMac, bubbles: true,
    }),
  );
}

export function Topbar() {
  const pathname = usePathname();
  const router = useRouter();
  // Live trail registered by the current page (via <SetCrumbs>), if any.
  // Pages that don't register fall back to the static first-segment map.
  const trail = useCrumbTrail();
  const seg = pathname.split('/').filter(Boolean)[0] ?? 'today';
  const crumb = CRUMBS[seg] ?? { label: seg.charAt(0).toUpperCase() + seg.slice(1) };

  return (
    <header className="hidden lg:flex sticky top-0 z-30 items-center gap-[18px] h-[60px] shrink-0 px-[26px] border-b border-line bg-bg">
      <div className="min-w-0 overflow-hidden">
        {trail ? (
          <CrumbTrail trail={trail} />
        ) : (
          <div className="flex items-baseline gap-[9px] font-mono text-[10px] uppercase tracking-[0.1em]">
            <span className="text-ink">{crumb.label}</span>
            {crumb.sub && (
              <>
                <span className="text-ink-3">/</span>
                <span className="text-ink-3">{crumb.sub}</span>
              </>
            )}
          </div>
        )}
      </div>

      {/* Search entry point — styled as a field, routes to /search. */}
      <button
        type="button"
        onClick={() => router.push('/search')}
        className="ml-auto flex items-center gap-[9px] w-[300px] h-[34px] px-[11px] rounded border border-line-strong bg-surface text-ink-3 hover:border-ink-3 hover:text-ink-2 transition-colors"
      >
        <Icon name="search" size={15} />
        <span className="flex-1 text-left text-[13px] text-ink-3">Search</span>
        <span className="font-mono text-[10px] leading-none text-ink-3 border border-line rounded-[3px] px-1 py-[3px] bg-bg">
          ⌘K
        </span>
      </button>

      <button
        type="button"
        onClick={dispatchOpenCapture}
        className="flex items-center gap-[7px] h-[34px] px-3 rounded border border-line-strong font-mono text-[10px] uppercase tracking-[0.09em] text-ink-2 hover:border-ink-3 hover:text-ink transition-colors"
      >
        <Icon name="capture" size={14} />
        Capture
      </button>
    </header>
  );
}
