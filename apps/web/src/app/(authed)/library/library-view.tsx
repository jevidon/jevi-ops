'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { Book } from '@/lib/api';
import { Pill } from '@/components/Pill';
import { Icon } from '@/components/Icon';
import { FacetRail, FacetGroup, FacetRow, FacetTags, FacetTag, FacetSep } from '@/components/FacetRail';
import {
  type LibEntry, type LibType, type BookSortKey,
  LIB_TYPES,
  NOTE_SOURCE_ORDER, NOTE_SOURCE_LABEL, QUOTE_SOURCE_ORDER, QUOTE_SOURCE_LABEL,
  BOOK_STATUS_ORDER, BOOK_STATUS_LABEL, BOOK_STATUS_PILL, BOOK_SORTS,
  sortBooks, bookBadge, coverTint,
} from './lib-data';

// Library — the unified archive (v2 redesign, Jul 2026). One page, one facet
// rail scoped to the selected type: Books get Status + Sort, entries get Source
// + Tag + Needs-review. An inapplicable control never renders, so it can't empty
// the page. Body is a masonry card grid (CSS columns) for entries plus a cover
// grid for books. Replaces the old tab-bar + five divergent sub-index screens.

const TOP_TAGS = 12;

// Noun for the "No ___ yet" empty state when a specific (non-'all') type is
// selected but has no rows — distinct from a facet filtering everything out.
const EMPTY_NOUN: Record<string, string> = {
  note: 'notes',
  quote: 'quotes',
  journal: 'journal entries',
  book: 'books',
};

// Responsive column count for the entry masonry. We distribute entries into
// explicit columns ourselves (round-robin) rather than using CSS `columns`,
// which — with a preceding flex sibling — can leave a later column's first card
// pushed down in WebKit. Explicit block-flow columns always top-align.
function useColumnCount(): number {
  const [cols, setCols] = useState(3);
  useEffect(() => {
    const calc = () => {
      const w = window.innerWidth;
      setCols(w >= 1280 ? 3 : w >= 768 ? 2 : 1);
    };
    calc();
    window.addEventListener('resize', calc);
    return () => window.removeEventListener('resize', calc);
  }, []);
  return cols;
}

// Round-robin so the newest entries spread across the top row (reading order is
// row-wise, left→right) and column card-counts stay balanced.
function toColumns<T>(items: T[], cols: number): T[][] {
  const out: T[][] = Array.from({ length: cols }, () => []);
  items.forEach((it, i) => out[i % cols]!.push(it));
  return out;
}

export function LibraryView({
  entries,
  books,
  initialType,
}: {
  entries: LibEntry[];
  books: Book[];
  initialType: LibType;
}) {
  const [type, setType] = useState<LibType>(initialType);
  const [src, setSrc] = useState<Set<string>>(new Set());
  const [tags, setTags] = useState<Set<string>>(new Set());
  const [needsReview, setNeedsReview] = useState(false);
  const [showAllTags, setShowAllTags] = useState(false);
  const [bookStatus, setBookStatus] = useState<Set<Book['status']>>(new Set());
  const [sort, setSort] = useState<BookSortKey>('title');
  const cols = useColumnCount();

  const togSet = <T,>(setter: React.Dispatch<React.SetStateAction<Set<T>>>) => (v: T) =>
    setter((s) => {
      const n = new Set(s);
      n.has(v) ? n.delete(v) : n.add(v);
      return n;
    });
  const togSrc = togSet(setSrc);
  const togTag = togSet(setTags);
  const togStatus = togSet(setBookStatus);

  const isBooks = type === 'book';
  const isQuotes = type === 'quote';
  const isInventory = type === 'inventory';

  // Type-tab counts. Inventory has no data source yet (stub), hence 0.
  const count = (k: LibType): number => {
    if (k === 'all') return entries.length + books.length;
    if (k === 'book') return books.length;
    if (k === 'inventory') return 0;
    return entries.filter((e) => e.kind === k).length;
  };

  // Entries in scope for the tag cloud + source counts (books excluded — they
  // aren't tagged by source). Derives every facet count so no chip is empty.
  const tagPool = useMemo(
    () => entries.filter((e) => type === 'all' || e.kind === (type as LibEntry['kind'])),
    [entries, type],
  );

  const visibleEntries = isBooks || isInventory ? [] : entries.filter((e) => {
    if (type !== 'all' && e.kind !== (type as LibEntry['kind'])) return false;
    if (src.size && (!e.source || !src.has(e.source))) return false;
    if (needsReview && !e.needsReview) return false;
    if (tags.size && !e.tags.some((t) => tags.has(t))) return false;
    return true;
  });

  // Books step aside when an entry-side filter narrows the Everything view, and
  // only appear on their own type or on unfiltered Everything.
  const entryFilterOn = src.size > 0 || tags.size > 0 || needsReview;
  const showBooks = isBooks || (type === 'all' && !entryFilterOn);
  const visibleBooks = !showBooks ? [] : books
    .filter((b) => !bookStatus.size || bookStatus.has(b.status))
    .slice()
    .sort((a, b) => sortBooks(a, b, sort));

  // Source facet: the selected type's own vocabulary, only values present.
  const sourceOrder = isQuotes ? QUOTE_SOURCE_ORDER : NOTE_SOURCE_ORDER;
  const sourceLabel = isQuotes ? QUOTE_SOURCE_LABEL : NOTE_SOURCE_LABEL;
  const sources = sourceOrder
    .map((v) => ({ value: v, count: tagPool.filter((e) => e.source === v).length }))
    .filter((s) => s.count > 0);

  // Tag counts from the corpus in scope.
  const tagCloud = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of tagPool) for (const t of e.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [tagPool]);
  const visibleTags = showAllTags ? tagCloud : tagCloud.slice(0, TOP_TAGS);
  const moreTags = tagCloud.length - visibleTags.length;

  // A facet filter is one of the scoped controls — NOT the Type selection.
  // Reset visibility counts the type; the "N shown" pill + empty-state copy key
  // off facetActive so an empty type doesn't read as a filtered-out result.
  const facetActive = src.size > 0 || tags.size > 0 || needsReview || bookStatus.size > 0;
  const activeFilters = src.size + tags.size + bookStatus.size + (needsReview ? 1 : 0) + (type !== 'all' ? 1 : 0);

  const pickType = (k: LibType) => {
    setType(k);
    setSrc(new Set());
    setTags(new Set());
    setNeedsReview(false);
    setBookStatus(new Set());
    setShowAllTags(false);
  };
  const reset = () => { pickType('all'); setSort('title'); };

  const shownCount = visibleEntries.length + visibleBooks.length;
  const needsReviewCount = tagPool.filter((e) => e.needsReview).length;

  // Keep the DOM bounded — the unfiltered Everything view spans the whole corpus
  // (thousands of cards). Facets still see every entry; only the render is
  // capped, with a note when it bites. Narrowing a facet drops below the cap.
  const RENDER_CAP = 180;
  const cappedEntries = visibleEntries.slice(0, RENDER_CAP);
  const entriesHidden = visibleEntries.length - cappedEntries.length;
  const entryColumns = toColumns(cappedEntries, cols);

  return (
    <div className="lg:flex">
      <FacetRail activeCount={activeFilters} onReset={reset}>
        <FacetGroup label="Type" action={activeFilters > 0 ? <ClearBtn onClick={reset} label="Reset" /> : undefined}>
          {LIB_TYPES.map((t) => (
            <FacetRow key={t.value} on={type === t.value} onClick={() => pickType(t.value)} name={t.label} count={count(t.value)} />
          ))}
        </FacetGroup>
        <FacetSep />

        {isBooks ? (
          <>
            <FacetGroup label="Status" action={bookStatus.size ? <ClearBtn onClick={() => setBookStatus(new Set())} /> : undefined}>
              {BOOK_STATUS_ORDER.map((s) => {
                const n = books.filter((b) => b.status === s).length;
                return n ? (
                  <FacetRow key={s} on={bookStatus.has(s)} onClick={() => togStatus(s)} name={BOOK_STATUS_LABEL[s]} count={n} />
                ) : null;
              })}
            </FacetGroup>
            <FacetSep />
            <FacetGroup label="Sort">
              <FacetTags>
                {BOOK_SORTS.map((s) => (
                  <FacetTag key={s.value} on={sort === s.value} onClick={() => setSort(s.value)} name={s.label} />
                ))}
              </FacetTags>
            </FacetGroup>
          </>
        ) : isInventory ? null : (
          <>
            {(sources.length > 0 || (!isQuotes && needsReviewCount > 0)) && (
              <>
                <FacetGroup label="Source" action={src.size || needsReview ? <ClearBtn onClick={() => { setSrc(new Set()); setNeedsReview(false); }} /> : undefined}>
                  {sources.map((s) => (
                    <FacetRow key={s.value} on={src.has(s.value)} onClick={() => togSrc(s.value)} name={sourceLabel[s.value] ?? s.value} count={s.count} />
                  ))}
                  {!isQuotes && needsReviewCount > 0 && (
                    <FacetRow on={needsReview} onClick={() => setNeedsReview((v) => !v)} name="Needs review" count={needsReviewCount} />
                  )}
                </FacetGroup>
                <FacetSep />
              </>
            )}
            {tagCloud.length > 0 && (
              <FacetGroup label="Tag" action={tags.size ? <ClearBtn onClick={() => setTags(new Set())} /> : undefined}>
                <FacetTags>
                  {visibleTags.map(([t, n]) => (
                    <FacetTag key={t} on={tags.has(t)} onClick={() => togTag(t)} name={`#${t}`} count={n} />
                  ))}
                  {moreTags > 0 && (
                    <button
                      type="button"
                      onClick={() => setShowAllTags(true)}
                      className="inline-flex items-center px-2 py-1 rounded-full border border-line-strong font-mono text-[10.5px] font-medium text-ink-3 hover:border-ink-3 hover:text-ink transition-colors"
                    >
                      +{moreTags} more
                    </button>
                  )}
                </FacetTags>
              </FacetGroup>
            )}
          </>
        )}
      </FacetRail>

      <div className="flex-1 min-w-0 px-5 lg:px-0 lg:pl-8 pt-6 pb-24">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4 mb-6">
          <div>
            <div className="eyebrow mb-2">
              Archive · {entries.length} entries · {books.length} books
            </div>
            <h1 className="font-serif text-[40px] font-medium leading-[1.02] tracking-[-0.022em] text-ink">Library</h1>
          </div>
          <div className="flex items-center gap-2 pb-1">
            {facetActive && <Pill state="plain" dot={false}>{shownCount} shown</Pill>}
            {addActions(type).map((a) => (
              <Link
                key={a.href}
                href={a.href}
                className={
                  a.solid
                    ? 'inline-flex items-center gap-1.5 h-[34px] px-3 rounded bg-ink border border-ink font-mono text-[10px] uppercase tracking-[0.09em] text-bg hover:bg-ink-2 transition-colors shrink-0'
                    : 'inline-flex items-center gap-1.5 h-[34px] px-3 rounded border border-line-strong font-mono text-[10px] uppercase tracking-[0.09em] text-ink-2 hover:border-ink-3 hover:text-ink transition-colors shrink-0'
                }
              >
                <Icon name="capture" size={13} /> {a.label}
              </Link>
            ))}
          </div>
        </div>

        {isInventory ? (
          <div className="pt-16 text-center">
            <div className="font-serif text-[25px] font-medium tracking-[-0.015em] text-ink">Inventory isn&rsquo;t wired up yet.</div>
            <p className="mt-1.5 font-sans text-[14px] text-ink-3">Gear, values, and receipts land here in a later phase.</p>
          </div>
        ) : (
          <>
            {visibleEntries.length > 0 && (
              <>
                <div className="flex items-start gap-3.5">
                  {entryColumns.map((col, ci) => (
                    <div key={ci} className="flex-1 min-w-0 flex flex-col gap-3.5">
                      {col.map((e) => (
                        <LibCard key={`${e.kind}-${e.id}`} e={e} onTag={togTag} selected={tags} />
                      ))}
                    </div>
                  ))}
                </div>
                {entriesHidden > 0 && (
                  <p className="mt-4 font-mono text-[11px] text-ink-3">
                    Showing {cappedEntries.length.toLocaleString()} of {visibleEntries.length.toLocaleString()} — narrow with a facet on the left.
                  </p>
                )}
              </>
            )}

            {showBooks && visibleBooks.length > 0 && (
              <>
                <div
                  className="flex items-baseline justify-between gap-3.5 pb-2 mb-3.5 border-b border-line-strong"
                  style={{ marginTop: isBooks ? 0 : 26 }}
                >
                  <span className="eyebrow">Books · {visibleBooks.length}</span>
                  <span className="font-mono text-[10.5px] text-ink-3">
                    {visibleBooks.reduce((s, b) => s + (b.quote_count ?? 0), 0)} highlights · by {(BOOK_SORTS.find((s) => s.value === sort)?.label ?? '').toLowerCase()}
                  </span>
                </div>
                <div className="grid gap-x-[18px] gap-y-6" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(148px, 1fr))' }}>
                  {visibleBooks.map((b) => (
                    <BookCard key={b.id} b={b} sort={sort} />
                  ))}
                </div>
              </>
            )}

            {visibleEntries.length === 0 && visibleBooks.length === 0 && (
              <div className="pt-16 text-center">
                <div className="font-serif text-[25px] font-medium tracking-[-0.015em] text-ink">
                  {facetActive ? 'Nothing matches.' : type === 'all' ? 'Nothing here yet.' : `No ${EMPTY_NOUN[type] ?? 'items'} yet.`}
                </div>
                <p className="mt-1.5 font-sans text-[14px] text-ink-3">
                  {facetActive ? 'Clear a filter on the left.' : 'Voice captures, quotes, and journal entries land here.'}
                </p>
              </div>
            )}

            {type === 'all' && entryFilterOn && visibleEntries.length > 0 && (
              <p className="mt-6 font-serif text-[12.5px] italic text-ink-3">
                Books aren&rsquo;t tagged by source — open the Books type to filter the shelf.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// Context-aware "add" buttons for the masthead.
function addActions(type: LibType): { href: string; label: string; solid: boolean }[] {
  if (type === 'book') return [{ href: '/library/books/new', label: 'Add book', solid: true }];
  if (type === 'journal') return [{ href: '/library/journal/new', label: 'New entry', solid: true }];
  if (type === 'quote') return [{ href: '/library/quotes/new', label: 'Add quote', solid: true }];
  return [
    { href: '/library/quotes/new', label: 'Add quote', solid: false },
    { href: '/library/notes/new', label: 'New note', solid: true },
  ];
}

function CameraIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-[11px] w-[11px]" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
      <path d="M2 5.5h2.2l1-1.6h5.6l1 1.6H14v7.3H2z" strokeLinejoin="round" />
      <circle cx="8" cy="9" r="2.3" />
    </svg>
  );
}

function LibCard({ e, onTag, selected }: { e: LibEntry; onTag: (t: string) => void; selected: Set<string> }) {
  const kicker = e.kind === 'quote' ? (e.who || 'Quote') : e.kind === 'journal' ? 'Journal' : (e.source ? NOTE_SOURCE_LABEL[e.source] ?? 'Note' : 'Note');
  return (
    <article className="rounded border border-line bg-bg overflow-hidden hover:border-line-strong transition-colors">
      {e.image && (
        <Link href={e.href} className="block">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={e.image} alt="" loading="lazy" className="block w-full h-40 object-cover border-b border-line" />
        </Link>
      )}
      <div className="px-4 pt-[15px] pb-[13px]">
        <div className="flex items-center justify-between gap-2.5 mb-2.5">
          <span className="eyebrow flex items-center gap-1.5 min-w-0">
            <span className="truncate">{kicker}</span>
            {e.photoCount > 0 && (
              <span className="shrink-0 inline-flex items-center gap-0.5 text-ink-4" title={`${e.photoCount} photo${e.photoCount === 1 ? '' : 's'}`}>
                <CameraIcon />
                {e.photoCount}
              </span>
            )}
          </span>
          <span className="font-mono text-[10px] text-ink-4 shrink-0">{e.dateLabel}</span>
        </div>

        <Link href={e.href} className="block group">
          {e.kind === 'quote' ? (
            <>
              <p className="font-serif text-[17px] italic leading-[1.45] tracking-[-0.005em] text-ink group-hover:text-accent transition-colors line-clamp-6">
                &ldquo;{e.body}&rdquo;
              </p>
              {e.book && (
                <div className="mt-2.5 font-mono text-[10px] uppercase tracking-[0.07em] text-ink-3 truncate">{e.book}</div>
              )}
            </>
          ) : (
            <>
              {e.title && (
                <h4 className="mb-1.5 font-serif text-[16px] font-medium leading-[1.25] tracking-[-0.01em] text-ink group-hover:text-accent transition-colors">{e.title}</h4>
              )}
              <p className="font-sans text-[13px] leading-[1.5] text-ink-2 line-clamp-6 whitespace-pre-wrap">{e.body}</p>
            </>
          )}
        </Link>

        {(e.tags.length > 0 || e.needsReview) && (
          <div className="flex flex-wrap gap-[5px] mt-3">
            {e.needsReview && (
              <span className="inline-flex items-center px-2 py-1 rounded-full border font-mono text-[10.5px] font-medium text-warn border-warn-line">Needs review</span>
            )}
            {e.tags.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => onTag(t)}
                className={`inline-flex items-center px-2 py-1 rounded-full border font-mono text-[10.5px] font-medium transition-colors ${
                  selected.has(t) ? 'bg-ink border-ink text-bg' : 'border-line-strong text-ink-2 hover:border-ink-3 hover:text-ink'
                }`}
              >
                #{t}
              </button>
            ))}
          </div>
        )}
      </div>
    </article>
  );
}

function BookCard({ b, sort }: { b: Book; sort: BookSortKey }) {
  const badge = bookBadge(b, sort);
  const tint = coverTint(b.title);
  return (
    <Link href={`/library/books/${b.id}`} className="block group">
      {b.cover_image_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={b.cover_image_url}
          alt={b.title}
          className="w-full aspect-[2/3] object-cover rounded-[3px] mb-2.5 border border-[rgba(18,16,14,0.12)]"
        />
      ) : (
        <div
          className="w-full aspect-[2/3] rounded-[3px] mb-2.5 border border-[rgba(18,16,14,0.12)] flex items-start p-3.5"
          style={{ background: tint.bg, color: tint.fg }}
        >
          <span className="font-serif text-[15px] font-medium leading-[1.22] tracking-[-0.01em] line-clamp-5">{b.title}</span>
        </div>
      )}
      <div className="font-sans text-[13.5px] font-medium leading-[1.3] text-ink group-hover:text-accent transition-colors line-clamp-2">{b.title}</div>
      {b.author && <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.07em] text-ink-3 truncate">{b.author}</div>}
      <div className="flex items-center gap-2 mt-[7px] flex-wrap">
        <Pill state={BOOK_STATUS_PILL[b.status]}>{BOOK_STATUS_LABEL[b.status]}</Pill>
        <span className="font-mono text-[10px] text-ink-4">
          {b.quote_count ?? 0} hl{badge ? ` · ${badge}` : ''}
        </span>
      </div>
    </Link>
  );
}

function ClearBtn({ onClick, label = 'Clear' }: { onClick: () => void; label?: string }) {
  return (
    <button type="button" onClick={onClick} className="font-mono text-[9px] uppercase tracking-[0.09em] text-ink-3 hover:text-accent transition-colors">
      {label}
    </button>
  );
}
