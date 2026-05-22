import Link from 'next/link';

// Sub-tab nav for /library. Server component — re-renders on navigation.
// Mobile-friendly horizontal scroll for narrow viewports.

type Active = 'all' | 'notes' | 'quotes' | 'journal' | 'books' | 'inventory';

const TABS: { value: Active; label: string; href: string }[] = [
  { value: 'all', label: 'All', href: '/library' },
  { value: 'notes', label: 'Notes', href: '/library/notes' },
  { value: 'quotes', label: 'Quotes', href: '/library/quotes' },
  { value: 'journal', label: 'Journal', href: '/library/journal' },
  { value: 'books', label: 'Books', href: '/library/books' },
  { value: 'inventory', label: 'Inventory', href: '/library/inventory' },
];

export function LibraryTabBar({ active }: { active: Active }) {
  return (
    <nav className="px-5 lg:px-0 pt-3 pb-1 flex gap-2 overflow-x-auto border-b border-line">
      {TABS.map((t) => (
        <Link
          key={t.value}
          href={t.href}
          className={`shrink-0 px-2.5 py-1 border font-mono text-[10px] uppercase tracking-wider transition-colors ${
            active === t.value
              ? 'bg-ink text-bg border-ink'
              : 'border-line text-ink-2 hover:border-ink-2 hover:text-ink'
          }`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
