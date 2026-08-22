'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon, type IconName } from '../Icon';

// The "create anything" grid — one tile per entity type, each a plain link
// to the existing /new route. Only Task supports a ?from= return param
// today; everything else lands on its form and navigates onward normally.

const CAPTURE_TYPES: Array<{ label: string; href: string; icon: IconName }> = [
  { label: 'Task', href: '/tasks/new', icon: 'tasks' },
  { label: 'Project', href: '/projects/new', icon: 'work' },
  { label: 'Area', href: '/projects/new?kind=area', icon: 'area' },
  { label: 'Domain', href: '/domains/new', icon: 'domains' },
  { label: 'Person', href: '/people/new', icon: 'people' },
  { label: 'Company', href: '/companies/new', icon: 'companies' },
  { label: 'Content', href: '/content/new', icon: 'content' },
  { label: 'Routine', href: '/routines/new', icon: 'routines' },
  { label: 'Book', href: '/library/books/new', icon: 'library' },
  { label: 'Note', href: '/library/notes/new', icon: 'note' },
  { label: 'Quote', href: '/library/quotes/new', icon: 'quote' },
  { label: 'Journal', href: '/library/journal/new', icon: 'journal' },
];

export function CaptureTypeGrid({ onNavigate }: { onNavigate: () => void }) {
  const pathname = usePathname();
  return (
    <div className="grid grid-cols-3 lg:grid-cols-4 gap-2">
      {CAPTURE_TYPES.map((t) => {
        const href =
          t.href === '/tasks/new'
            ? `/tasks/new?from=${encodeURIComponent(pathname)}`
            : t.href;
        return (
          <Link
            key={t.label}
            href={href}
            onClick={onNavigate}
            className="flex flex-col items-center gap-1.5 py-3 border border-line rounded text-ink-2 hover:border-ink-3 hover:text-ink transition-colors"
          >
            <Icon name={t.icon} size={20} />
            <span className="font-sans text-[12px] font-medium">{t.label}</span>
          </Link>
        );
      })}
    </div>
  );
}
