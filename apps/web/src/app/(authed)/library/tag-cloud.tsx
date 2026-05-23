import Link from 'next/link';
import type { TagAggregate } from '@/lib/api';

// Tag chip cloud for /library/notes and /library/quotes. Renders the top
// N tags by frequency with the selected one highlighted. Each chip is a
// Link that toggles the `tag` query param. We collapse the long tail
// behind a <details> so the cloud doesn't dominate the page; the user
// can expand it to find rarer tags.

const TOP_N = 24;

export function TagCloud({
  tags,
  selectedTag,
  source,
  buildHref,
}: {
  tags: TagAggregate[];
  selectedTag: string | null;
  // Which count to show on each chip — notes-page wants the notes count,
  // quotes-page wants the quotes count.
  source: 'notes' | 'quotes';
  buildHref: (tag: string | null) => string;
}) {
  // Filter to tags that have at least one row for the active source. A
  // quote-only tag would clutter the notes page (and clicking would yield
  // zero results).
  const relevant = tags.filter((t) => (source === 'notes' ? t.notes : t.quotes) > 0);
  if (relevant.length === 0) return null;

  // Always include the selected tag in the visible head — otherwise you
  // could click a long-tail tag, then it disappears from the cloud after
  // navigation, which is disorienting.
  const head: TagAggregate[] = [];
  const tail: TagAggregate[] = [];
  for (const t of relevant) {
    if (head.length < TOP_N || t.tag === selectedTag) head.push(t);
    else tail.push(t);
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <span className="eyebrow shrink-0">Tag</span>
      <div className="flex flex-wrap gap-1.5 items-center">
        {selectedTag && (
          <Link
            href={buildHref(null)}
            className="px-2.5 py-1 border border-line text-ink-3 hover:text-ink hover:border-ink-2 font-mono text-[10px] uppercase tracking-wider transition-colors"
          >
            Clear
          </Link>
        )}
        {head.map((t) => (
          <TagChip key={t.tag} tag={t} source={source} active={t.tag === selectedTag} href={buildHref(t.tag === selectedTag ? null : t.tag)} />
        ))}
        {tail.length > 0 && (
          <details className="relative">
            <summary className="cursor-pointer list-none px-2.5 py-1 border border-line text-ink-3 hover:text-ink hover:border-ink-2 font-mono text-[10px] uppercase tracking-wider transition-colors">
              + {tail.length} more
            </summary>
            <ul className="absolute z-10 mt-1 left-0 max-h-80 overflow-auto bg-bg border border-line shadow-lg min-w-[220px]">
              {tail.map((t) => (
                <li key={t.tag}>
                  <Link
                    href={buildHref(t.tag === selectedTag ? null : t.tag)}
                    className={`flex items-baseline justify-between gap-2 px-3 py-1.5 font-sans text-[12px] hover:bg-surface transition-colors ${
                      t.tag === selectedTag ? 'text-accent' : 'text-ink-2'
                    }`}
                  >
                    <span className="truncate">{t.tag}</span>
                    <span className="font-mono text-[9px] uppercase text-ink-3 shrink-0">
                      {source === 'notes' ? t.notes : t.quotes}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </div>
  );
}

function TagChip({
  tag,
  source,
  active,
  href,
}: {
  tag: TagAggregate;
  source: 'notes' | 'quotes';
  active: boolean;
  href: string;
}) {
  const count = source === 'notes' ? tag.notes : tag.quotes;
  return (
    <Link
      href={href}
      className={`inline-flex items-baseline gap-1.5 px-2.5 py-1 border font-mono text-[10px] uppercase tracking-wider transition-colors ${
        active
          ? 'bg-ink text-bg border-ink'
          : 'border-line text-ink-2 hover:border-ink-2 hover:text-ink'
      }`}
    >
      <span>{tag.tag}</span>
      <span className={active ? 'text-bg/70' : 'text-ink-3'}>{count}</span>
    </Link>
  );
}
