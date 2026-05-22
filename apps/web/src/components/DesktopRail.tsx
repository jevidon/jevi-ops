'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOutAction } from '@/app/sign-in/actions';

// Left-rail nav for desktop viewports (lg:+). Mirrors the bottom tab bar's
// tabs list but presented vertically with active-tab indication on the left
// edge. Hidden on mobile (BottomTabBar takes over).

const TABS = [
  { href: '/today', label: 'Today' },
  { href: '/domains', label: 'Domains' },
  { href: '/projects', label: 'Projects' },
  { href: '/content', label: 'Content' },
  { href: '/people', label: 'People' },
  { href: '/library', label: 'Library' },
] as const;

export function DesktopRail({ email }: { email?: string }) {
  const pathname = usePathname();
  return (
    <aside
      aria-label="Primary"
      className="hidden lg:flex w-[220px] shrink-0 flex-col border-r border-line bg-surface"
    >
      {/* Brand */}
      <div className="px-6 pt-7 pb-7">
        <div className="font-serif text-[20px] font-medium leading-none text-ink tracking-[-0.01em]">
          Operations
        </div>
        <div className="mt-1 font-mono text-[10px] uppercase tracking-wider text-ink-3">
          jeradhill.com
        </div>
      </div>

      <div className="hairline mx-6" />

      {/* Tabs */}
      <nav className="flex-1 py-2">
        <ul>
          {TABS.map((tab) => {
            const active = pathname === tab.href || pathname.startsWith(tab.href + '/');
            return (
              <li key={tab.href}>
                <Link
                  href={tab.href}
                  className={`group flex items-center gap-3 px-6 py-3 font-sans text-[14px] transition-colors border-l-2 ${
                    active
                      ? 'border-ink text-ink font-semibold bg-surface-2/50'
                      : 'border-transparent text-ink-2 hover:text-ink hover:bg-surface-2/30'
                  }`}
                >
                  {tab.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Account footer */}
      {email && (
        <div className="border-t border-line px-6 py-4 flex items-center justify-between gap-2">
          <span className="font-mono text-[10px] uppercase tracking-wider text-ink-3 truncate">
            {email}
          </span>
          <form action={signOutAction}>
            <button
              type="submit"
              className="font-mono text-[10px] uppercase tracking-wider text-ink-3 hover:text-accent transition-colors"
            >
              Sign out
            </button>
          </form>
        </div>
      )}
    </aside>
  );
}
