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
const TABS = [
  { href: '/today', label: 'Today' },
  { href: '/domains', label: 'Domains' },
  { href: '/projects', label: 'Projects' },
  { href: '/content', label: 'Content' },
  { href: '/people', label: 'People' },
  { href: '/library', label: 'Library' },
] as const;

// Routes that count as "Today sub-views" — visiting them keeps the Today
// tab highlighted. Tasks list, Inbox triage, and any deep-linked task
// detail are doorways off the Briefing, not their own destinations.
const TODAY_SUBVIEWS = ['/tasks', '/inbox'];

export function BottomTabBar() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Primary"
      className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[480px] bg-bg/95 backdrop-blur-md border-t border-line lg:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <ul className="flex justify-around items-stretch h-14">
        {TABS.map((tab) => {
          const isExactMatch = pathname === tab.href || pathname.startsWith(tab.href + '/');
          const isTodaySubview =
            tab.href === '/today' &&
            TODAY_SUBVIEWS.some((p) => pathname === p || pathname.startsWith(p + '/'));
          const active = isExactMatch || isTodaySubview;
          return (
            <li key={tab.href} className="flex-1">
              <Link
                href={tab.href}
                className={`flex h-full items-center justify-center font-mono text-[10px] font-semibold uppercase tracking-wider transition-colors ${
                  active ? 'text-accent' : 'text-ink-3 hover:text-ink-2'
                }`}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
