import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ScreenHeader } from '@/components/ScreenHeader';
import { libraryApi, ApiError, type Quote, type Book } from '@/lib/api';
import { LibraryTabBar } from '../library-tab-bar';
import { PrefsPersist } from '@/components/PrefsPersist';

// /library/quotes — flat list of every saved quote (Readwise highlights +
// voice-captured + manual). Supports filtering by source_type and by book,
// sorting by recent / book / annotation count. Persists chip state via
// the shared PrefsPersist component.

type SourceTypeFilter = 'all' | 'book' | 'article' | 'podcast' | 'conversation' | 'other';
type SortKey = 'recent' | 'book' | 'annotations';

const SOURCE_TYPE_FILTERS: Array<{ value: SourceTypeFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'book', label: 'Books' },
  { value: 'article', label: 'Articles' },
  { value: 'podcast', label: 'Podcasts' },
  { value: 'conversation', label: 'Conversation' },
  { value: 'other', label: 'Other' },
];

const SORT_OPTIONS: Array<{ value: SortKey; label: string }> = [
  { value: 'recent', label: 'Recent' },
  { value: 'book', label: 'Book' },
  { value: 'annotations', label: 'Thoughts' },
];

export default async function QuotesListPage({
  searchParams,
}: {
  searchParams: Promise<{ source_type?: string; book_id?: string; sort?: string }>;
}) {
  const params = await searchParams;

  // Cookie restore — same pattern as /library/books and /library/notes.
  if (params.source_type === undefined && params.book_id === undefined && params.sort === undefined) {
    const jar = await cookies();
    const savedSourceType = jar.get('quotes_source_type')?.value;
    const savedBookId = jar.get('quotes_book_id')?.value;
    const savedSort = jar.get('quotes_sort')?.value;
    const validSavedSourceType = savedSourceType && SOURCE_TYPE_FILTERS.find((f) => f.value === savedSourceType)
      ? savedSourceType
      : undefined;
    const validSavedSort = savedSort && SORT_OPTIONS.find((s) => s.value === savedSort)
      ? savedSort
      : undefined;
    const qs = new URLSearchParams();
    if (validSavedSourceType && validSavedSourceType !== 'all') qs.set('source_type', validSavedSourceType);
    if (savedBookId) qs.set('book_id', savedBookId);
    if (validSavedSort && validSavedSort !== 'recent') qs.set('sort', validSavedSort);
    if (qs.toString()) redirect(`/library/quotes?${qs.toString()}`);
  }

  const sourceTypeFilter = (
    params.source_type && SOURCE_TYPE_FILTERS.find((f) => f.value === params.source_type)
      ? params.source_type
      : 'all'
  ) as SourceTypeFilter;
  const bookFilter = params.book_id ?? '';
  const sort = (
    params.sort && SORT_OPTIONS.find((s) => s.value === params.sort)
      ? params.sort
      : 'recent'
  ) as SortKey;

  // Fetch quotes + books in parallel. Books list powers the dropdown filter.
  let quotes: Quote[] = [];
  let books: Book[] = [];
  let errorMessage: string | null = null;
  try {
    const [quotesRes, booksRes] = await Promise.all([
      libraryApi.quotes.list(),
      libraryApi.books.list(),
    ]);
    quotes = quotesRes.quotes;
    books = booksRes.books;
  } catch (err) {
    errorMessage = err instanceof ApiError ? `API ${err.status}` : (err as Error).message;
  }

  // Filter quotes in memory.
  let filtered = quotes;
  if (sourceTypeFilter !== 'all') {
    filtered = filtered.filter((q) => q.source_type === sourceTypeFilter);
  }
  if (bookFilter) {
    filtered = filtered.filter((q) => q.book?.id === bookFilter);
  }

  // Sort.
  filtered = [...filtered].sort((a, b) => sortQuotes(a, b, sort));

  // Only show books that actually have at least one quote linked — keeps
  // the dropdown short and useful.
  const booksWithQuotes = books.filter((b) => (b.quote_count ?? 0) > 0);

  const buildHref = (overrides: { source_type?: SourceTypeFilter; book_id?: string; sort?: SortKey }) => {
    const qs = new URLSearchParams();
    const st = overrides.source_type ?? sourceTypeFilter;
    const bk = overrides.book_id ?? bookFilter;
    const so = overrides.sort ?? sort;
    if (st !== 'all') qs.set('source_type', st);
    if (bk) qs.set('book_id', bk);
    if (so !== 'recent') qs.set('sort', so);
    const str = qs.toString();
    return str ? `/library/quotes?${str}` : '/library/quotes';
  };

  return (
    <div>
      <PrefsPersist
        cookiePrefix="quotes"
        paramNames={['source_type', 'book_id', 'sort']}
      />
      <ScreenHeader
        eyebrow="Library"
        title="Quotes"
        meta={`${filtered.length} of ${quotes.length} saved`}
      />
      <div className="hairline" />
      <LibraryTabBar active="quotes" />

      {/* Filter + sort controls */}
      <div className="px-5 lg:px-0 pt-3 flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="eyebrow">Type</span>
          <div className="flex flex-wrap gap-1.5">
            {SOURCE_TYPE_FILTERS.map((f) => (
              <Link
                key={f.value}
                href={buildHref({ source_type: f.value })}
                className={`px-2.5 py-1 border font-mono text-[10px] uppercase tracking-wider transition-colors ${
                  sourceTypeFilter === f.value
                    ? 'bg-ink text-bg border-ink'
                    : 'border-line text-ink-2 hover:border-ink-2 hover:text-ink'
                }`}
              >
                {f.label}
              </Link>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="eyebrow">Sort</span>
          <div className="flex flex-wrap gap-1.5">
            {SORT_OPTIONS.map((s) => (
              <Link
                key={s.value}
                href={buildHref({ sort: s.value })}
                className={`px-2.5 py-1 border font-mono text-[10px] uppercase tracking-wider transition-colors ${
                  sort === s.value
                    ? 'bg-ink text-bg border-ink'
                    : 'border-line text-ink-2 hover:border-ink-2 hover:text-ink'
                }`}
              >
                {s.label}
              </Link>
            ))}
          </div>
          <Link
            href="/library/quotes/new"
            className="ml-auto font-mono text-[11px] uppercase tracking-wider text-ink-3 hover:text-accent transition-colors"
          >
            + Add highlight
          </Link>
        </div>

        {booksWithQuotes.length > 0 && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="eyebrow">Book</span>
            <BookFilterDropdown
              books={booksWithQuotes}
              selected={bookFilter}
              buildHref={(bookId) => buildHref({ book_id: bookId })}
            />
            {bookFilter && (
              <Link
                href={buildHref({ book_id: '' })}
                className="font-mono text-[10px] uppercase tracking-wider text-ink-3 hover:text-accent transition-colors"
              >
                Clear
              </Link>
            )}
          </div>
        )}
      </div>

      {errorMessage ? (
        <div className="px-5 lg:px-0 mt-6 font-sans text-[13px] text-ink-3">Error: {errorMessage}</div>
      ) : filtered.length === 0 ? (
        <div className="px-5 lg:px-0 mt-6 font-sans text-[13px] text-ink-3 italic">
          {quotes.length === 0
            ? 'No quotes saved yet. Voice command: "Save a quote from book by author: text"'
            : 'No quotes match these filters.'}
        </div>
      ) : (
        <ul className="px-5 lg:px-0 mt-4">
          {filtered.map((q) => (
            <li key={q.id} className="py-4 border-b border-line/40">
              <Link href={`/library/quotes/${q.id}`} className="block hover:opacity-80 transition-opacity">
                <div className="font-serif text-[16px] text-ink leading-snug italic">
                  &ldquo;{q.text}&rdquo;
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] uppercase tracking-wider text-ink-3">
                  {q.source_author && <span>{q.source_author}</span>}
                  {q.book?.title && <span>· {q.book.title}</span>}
                  {q.source_reference && !q.book?.title && <span>· {q.source_reference}</span>}
                  {q.page_number && <span>· p. {q.page_number}</span>}
                  {q.annotation_count !== undefined && q.annotation_count > 0 && (
                    <span>· {q.annotation_count} thought{q.annotation_count === 1 ? '' : 's'}</span>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Server-rendered native <select>. On change, we don't have a client
// component, so we rely on a tiny inline form pattern — but since this
// is a server comp page, the simplest UX is a native select that the user
// changes + a "Go" affordance via Link clicks. Easier: use a list of
// Link buttons, but at 97 books that's too much. Compromise: render as
// a real <select> wrapped in a form that GETs the same URL.
//
// We can't bind onChange in a server component, so we'd need a client
// component for live navigation. Adding one client component for this
// only is overkill — instead we use a form with method=GET and the chip
// styling treats the select as a control.
function BookFilterDropdown({
  books,
  selected,
  buildHref,
}: {
  books: Book[];
  selected: string;
  buildHref: (bookId: string) => string;
}) {
  const sorted = [...books].sort((a, b) => a.title.localeCompare(b.title));
  const selectedBook = sorted.find((b) => b.id === selected);
  return (
    <details className="relative">
      <summary className="cursor-pointer px-2.5 py-1 border font-mono text-[10px] uppercase tracking-wider transition-colors list-none border-line text-ink-2 hover:border-ink-2 hover:text-ink data-[active=true]:bg-ink data-[active=true]:text-bg data-[active=true]:border-ink"
        data-active={Boolean(selected)}
      >
        {selectedBook ? truncate(selectedBook.title, 40) : 'Pick a book…'}  ▾
      </summary>
      <ul className="absolute z-10 mt-1 left-0 max-h-80 overflow-auto bg-bg border border-line shadow-lg min-w-[220px]">
        {sorted.map((b) => (
          <li key={b.id}>
            <Link
              href={buildHref(b.id)}
              className={`block px-3 py-1.5 font-sans text-[12px] hover:bg-surface transition-colors ${
                b.id === selected ? 'text-accent' : 'text-ink-2'
              }`}
            >
              {b.title}
              {b.quote_count != null && (
                <span className="ml-2 font-mono text-[9px] uppercase text-ink-3">
                  {b.quote_count}
                </span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </details>
  );
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1).trimEnd() + '…';
}

function sortQuotes(a: Quote, b: Quote, key: SortKey): number {
  switch (key) {
    case 'recent':
      return b.created_at.localeCompare(a.created_at);
    case 'book': {
      const aa = a.book?.title ?? '';
      const bb = b.book?.title ?? '';
      if (!aa && !bb) return b.created_at.localeCompare(a.created_at);
      if (!aa) return 1;
      if (!bb) return -1;
      // Within a book, order by page_number (Kindle Location) ascending.
      const titleCmp = aa.localeCompare(bb);
      if (titleCmp !== 0) return titleCmp;
      const ap = Number(a.page_number) || 0;
      const bp = Number(b.page_number) || 0;
      return ap - bp;
    }
    case 'annotations': {
      const aa = a.annotation_count ?? 0;
      const bb = b.annotation_count ?? 0;
      if (aa === bb) return b.created_at.localeCompare(a.created_at);
      return bb - aa;
    }
    default:
      return 0;
  }
}
