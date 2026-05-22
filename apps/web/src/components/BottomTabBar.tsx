'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

// Six tabs per spec §4. Order matters — Today is home.
const TABS = [
  { href: '/today', label: 'Today' },
  { href: '/domains', label: 'Domains' },
  { href: '/projects', label: 'Projects' },
  { href: '/content', label: 'Content' },
  { href: '/people', label: 'People' },
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
