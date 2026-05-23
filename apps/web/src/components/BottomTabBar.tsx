'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

// Spec §4 prescribed six tabs (Today, Domains, Projects, Content, People,
// Library). Tasks replaces Domains-as-primary because tasks are the daily
// driver. People is still a stub so we surface Content (real, with pipeline
// + filter + edit) in its slot; People reclaims the slot once its CRM UI
// ships. Domains is still reachable via direct URL.
const TABS = [
  { href: '/today', label: 'Today' },
  { href: '/tasks', label: 'Tasks' },
  { href: '/projects', label: 'Projects' },
  { href: '/content', label: 'Content' },
  { href: '/domains', label: 'Domains' },
  { href: '/library', label: 'Library' },
] as const;

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
          const active = pathname === tab.href || pathname.startsWith(tab.href + '/');
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
