'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

// Briefing redesign (Jun 2026): six tabs max, mirroring the design brief:
//   Today · Domains · Projects · Content · People · Library
//
// Tasks no longer has a tab — it's a sub-view of Today reached via the
// Briefing's "Doing today" strip. The full filterable list still exists
// at /tasks, and the Today tab stays highlighted while it's open so the
// user reads it as a doorway, not a destination.
//
// Search dropped off the mobile bar to make room for Domains + Content.
// The keyboard shortcut (cmd-K) still opens search from any screen.

type TabIcon = (props: { className?: string }) => React.ReactElement;

const TABS: Array<{ href: string; label: string; Icon: TabIcon }> = [
  { href: '/today', label: 'Today', Icon: TodayIcon },
  { href: '/domains', label: 'Domains', Icon: DomainsIcon },
  { href: '/projects', label: 'Projects', Icon: ProjectsIcon },
  { href: '/content', label: 'Content', Icon: ContentIcon },
  { href: '/people', label: 'People', Icon: PeopleIcon },
  { href: '/library', label: 'Library', Icon: LibraryIcon },
];

// Routes that count as "Today sub-views" — visiting them keeps the Today
// tab highlighted. Tasks list, Inbox triage, and any deep-linked task
// detail are doorways off the Briefing, not their own destinations.
const TODAY_SUBVIEWS = ['/tasks', '/inbox'];

export function BottomTabBar() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Primary"
      className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[480px] bg-surface/95 backdrop-blur-md border-t border-line lg:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <ul className="flex justify-around items-stretch h-[60px]">
        {TABS.map(({ href, label, Icon }) => {
          const isExactMatch = pathname === href || pathname.startsWith(href + '/');
          const isTodaySubview =
            href === '/today' &&
            TODAY_SUBVIEWS.some((p) => pathname === p || pathname.startsWith(p + '/'));
          const active = isExactMatch || isTodaySubview;
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={`flex h-full flex-col items-center justify-center gap-0.5 transition-colors ${
                  active ? 'text-ink' : 'text-ink-3'
                }`}
              >
                <Icon className="h-[22px] w-[22px]" />
                <span
                  className={`font-sans text-[11px] leading-none ${
                    active ? 'font-semibold' : 'font-medium'
                  }`}
                >
                  {label}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

// ─── Icons ───────────────────────────────────────────────────────────────
// Thin-stroke linear SVGs in the design's editorial style. 22×22, stroke
// 1.5. Active state inherits text color from the parent <Link> via
// currentColor on both stroke and fill — no per-icon active variant.

function TodayIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
      strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

function DomainsIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
      strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <rect x="3.5" y="3.5" width="7" height="7" />
      <rect x="13.5" y="3.5" width="7" height="7" />
      <rect x="3.5" y="13.5" width="7" height="7" />
      <rect x="13.5" y="13.5" width="7" height="7" />
    </svg>
  );
}

function ProjectsIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
      strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      {/* gantt-ish: three horizontal bars, offset like a project plan */}
      <rect x="3" y="5" width="13" height="3" rx="0.5" />
      <rect x="7" y="10.5" width="14" height="3" rx="0.5" />
      <rect x="5" y="16" width="11" height="3" rx="0.5" />
    </svg>
  );
}

function ContentIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
      strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      {/* kanban-style columns — matches the content pipeline mental model */}
      <rect x="3.5" y="4" width="5" height="16" rx="0.5" />
      <rect x="9.5" y="4" width="5" height="11" rx="0.5" />
      <rect x="15.5" y="4" width="5" height="14" rx="0.5" />
    </svg>
  );
}

function PeopleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
      strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20c1.5-4 4.5-6 7-6s5.5 2 7 6" />
    </svg>
  );
}

function LibraryIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
      strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      {/* three book spines on a shelf, leaning slightly so it reads as books
          rather than columns (which would clash with Content). */}
      <path d="M4 4.5v15l3 .5V5.5z" />
      <path d="M10 4.5v15l3 .5V5.5z" />
      <path d="M16.2 5.8l3 14.7 1.5-.4-3-14.7z" />
    </svg>
  );
}
