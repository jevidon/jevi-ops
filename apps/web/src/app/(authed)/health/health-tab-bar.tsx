'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

// Tab bar across the top of every /health/* page. Same shape as
// LibraryTabBar so the UI feels consistent across top-level sections.

const TABS: Array<{ slug: string; label: string }> = [
  { slug: '', label: 'Overview' },
  { slug: 'vitals', label: 'Vitals' },
  { slug: 'labs', label: 'Labs' },
  { slug: 'visits', label: 'Visits' },
  { slug: 'check-ins', label: 'Check-ins' },
  { slug: 'meds', label: 'Meds' },
  { slug: 'history', label: 'History' },
];

export function HealthTabBar() {
  const pathname = usePathname();
  return (
    <nav className="px-5 lg:px-0 flex flex-wrap gap-x-4 gap-y-2 border-b border-line pb-2 mt-3">
      {TABS.map((t) => {
        const href = t.slug ? `/health/${t.slug}` : '/health';
        const active = t.slug
          ? pathname === href || pathname.startsWith(`${href}/`)
          : pathname === '/health';
        return (
          <Link
            key={t.slug || 'overview'}
            href={href}
            className={`font-mono text-[11px] uppercase tracking-wider pb-1 transition-colors ${
              active
                ? 'text-ink border-b border-ink'
                : 'text-ink-3 hover:text-ink-2'
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
