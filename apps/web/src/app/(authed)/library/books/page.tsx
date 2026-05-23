import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ScreenHeader } from '@/components/ScreenHeader';
import { libraryApi, ApiError, type Book } from '@/lib/api';
import { LibraryTabBar } from '../library-tab-bar';
import { PrefsPersist } from '@/components/PrefsPersist';

// /library/books — reading log. Supports filtering by reading status and
// sorting by title / author / finished date / rating / recently added via
// query-string controls. Each card links to the detail/edit page.

type StatusFilter = Book['status'] | 'all';
type SortKey = 'title' | 'author' | 'finished_desc' | 'rating_desc' | 'recent';

const STATUS_FILTERS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'want_to_read', label: 'Want' },
  { value: 'reading', label: 'Reading' },
  { value: 'finished', label: 'Finished' },
  { value: 'abandoned', label: 'Abandoned' },
];

const SORT_OPTIONS: Array<{ value: SortKey; label: string }> = [
  { value: 'title', label: 'Title' },
  { value: 'author', label: 'Author' },
  { value: 'finished_desc', label: 'Finished' },
  { value: 'rating_desc', label: 'Rating' },
  { value: 'recent', label: 'Recent' },
];

export default async function BooksPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; sort?: string }>;
}) {
  const params = await searchParams;

  // If the URL has no filter/sort params, check whether the user has a
  // saved preference in cookies and redirect to that view. Cookies are
  // written client-side by <BookPrefsPersist /> whenever the URL changes.
  // This makes the chip state "sticky" across navigation and reloads
  // without polluting the canonical URL with default values.
  if (params.status === undefined && params.sort === undefined) {
    const jar = await cookies();
    const savedStatus = jar.get('books_status')?.value;
    const savedSort = jar.get('books_sort')?.value;
    const validSavedStatus = savedStatus && STATUS_FILTERS.find((f) => f.value === savedStatus)
      ? savedStatus
      : undefined;
    const validSavedSort = savedSort && SORT_OPTIONS.find((s) => s.value === savedSort)
      ? savedSort
      : undefined;
    const qs = new URLSearchParams();
    if (validSavedStatus && validSavedStatus !== 'all') qs.set('status', validSavedStatus);
    if (validSavedSort && validSavedSort !== 'title') qs.set('sort', validSavedSort);
    if (qs.toString()) redirect(`/library/books?${qs.toString()}`);
  }

  const status = (
    params.status && STATUS_FILTERS.find((f) => f.value === params.status)
      ? params.status
      : 'all'
  ) as StatusFilter;
  const sort = (
    params.sort && SORT_OPTIONS.find((s) => s.value === params.sort)
      ? params.sort
      : 'title'
  ) as SortKey;

  let books: Book[] = [];
  let errorMessage: string | null = null;
  try {
    books = (await libraryApi.books.list()).books;
  } catch (err) {
    errorMessage = err instanceof ApiError ? `API ${err.status}` : (err as Error).message;
  }

  // Filter
  let filtered = status === 'all' ? books : books.filter((b) => b.status === status);

  // Sort. For each non-title sort, books with null values for that field
  // sink to the bottom so they don't bury the answer to the user's
  // implicit question ("what did I finish recently / rate highest").
  filtered = [...filtered].sort((a, b) => sortBooks(a, b, sort));

  const totalHighlights = filtered.reduce((sum, b) => sum + (b.quote_count ?? 0), 0);

  const buildHref = (overrides: { status?: StatusFilter; sort?: SortKey }) => {
    const qs = new URLSearchParams();
    const s = overrides.status ?? status;
    const so = overrides.sort ?? sort;
    if (s !== 'all') qs.set('status', s);
    if (so !== 'title') qs.set('sort', so);
    const str = qs.toString();
    return str ? `/library/books?${str}` : '/library/books';
  };

  return (
    <div>
      <PrefsPersist cookiePrefix="books" paramNames={['status', 'sort']} />
      <ScreenHeader
        eyebrow="Library"
        title="Books"
        meta={`${filtered.length} books · ${totalHighlights} highlights`}
      />
      <div className="hairline" />
      <LibraryTabBar active="books" />

      {/* Filter + sort controls. Two rows on narrow viewports so the chips
          stay readable; flow inline once there's room. */}
      <div className="px-5 lg:px-0 pt-3 flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="eyebrow">Status</span>
          <div className="flex flex-wrap gap-1.5">
            {STATUS_FILTERS.map((f) => (
              <Link
                key={f.value}
                href={buildHref({ status: f.value })}
                className={`px-2.5 py-1 border font-mono text-[10px] uppercase tracking-wider transition-colors ${
                  status === f.value
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
            href="/library/books/new"
            className="ml-auto font-mono text-[11px] uppercase tracking-wider text-ink-3 hover:text-accent transition-colors"
          >
            + Add book
          </Link>
        </div>
      </div>

      {errorMessage ? (
        <div className="px-5 lg:px-0 mt-6 font-sans text-[13px] text-ink-3">Error: {errorMessage}</div>
      ) : filtered.length === 0 ? (
        <div className="px-5 lg:px-0 mt-6 font-sans text-[13px] text-ink-3 italic">
          {books.length === 0
            ? 'No books yet. Readwise imports + voice book captures land here.'
            : 'No books match this filter.'}
        </div>
      ) : (
        <ul className="px-5 lg:px-0 mt-4 grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-x-3 gap-y-5">
          {filtered.map((b) => (
            <BookCard key={b.id} book={b} sort={sort} />
          ))}
        </ul>
      )}
    </div>
  );
}

// In-memory sort comparator. The Books API returns at most 500 rows so we
// pay no real cost sorting client-side. Centralizing the rules here keeps
// the page render tidy.
function sortBooks(a: Book, b: Book, key: SortKey): number {
  switch (key) {
    case 'title':
      return a.title.localeCompare(b.title);
    case 'author': {
      // Null authors sink. Compare on the surname-ish chunk if we can pick one.
      const aa = (a.author ?? '').trim();
      const bb = (b.author ?? '').trim();
      if (!aa && !bb) return a.title.localeCompare(b.title);
      if (!aa) return 1;
      if (!bb) return -1;
      return surnameKey(aa).localeCompare(surnameKey(bb)) || a.title.localeCompare(b.title);
    }
    case 'finished_desc': {
      // Most recently finished first. Null/unset finished dates sink.
      const aa = a.finished_at ?? '';
      const bb = b.finished_at ?? '';
      if (!aa && !bb) return a.title.localeCompare(b.title);
      if (!aa) return 1;
      if (!bb) return -1;
      return bb.localeCompare(aa);
    }
    case 'rating_desc': {
      // Highest rated first. Null ratings sink.
      const aa = a.rating ?? -1;
      const bb = b.rating ?? -1;
      if (aa === bb) return a.title.localeCompare(b.title);
      return bb - aa;
    }
    case 'recent':
      return b.created_at.localeCompare(a.created_at);
    default:
      return 0;
  }
}

// Take the last whitespace-separated token of an author name so "Cal
// Newport" sorts as "Newport, Cal" effectively. Imperfect (multi-author
// strings like "John Lynch, Bruce McNicol, Bill Thrall" sort by "Thrall")
// but it's the right "feels alphabetical by last name" heuristic.
function surnameKey(author: string): string {
  const parts = author.split(/\s+/);
  return (parts[parts.length - 1] ?? author).toLowerCase();
}

function BookCard({ book, sort }: { book: Book; sort: SortKey }) {
  // Show the sort field as a small badge when it adds info beyond
  // title/author (which are always visible).
  let badge: string | null = null;
  if (sort === 'rating_desc' && book.rating) {
    badge = '★'.repeat(book.rating);
  } else if (sort === 'finished_desc' && book.finished_at) {
    badge = book.finished_at.slice(0, 7); // YYYY-MM
  }

  return (
    <li>
      <Link href={`/library/books/${book.id}`} className="group block">
        <div className="aspect-[2/3] bg-surface border border-line overflow-hidden mb-2 group-hover:border-ink-2 transition-colors">
          {book.cover_image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={book.cover_image_url}
              alt={book.title}
              className="w-full h-full object-cover"
              loading="lazy"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center p-3 font-serif text-[14px] text-ink-3 text-center leading-tight">
              {book.title}
            </div>
          )}
        </div>
        <div className="font-serif text-[14px] text-ink leading-tight line-clamp-2">
          {book.title}
        </div>
        {book.author && (
          <div className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-ink-3 line-clamp-1">
            {book.author}
          </div>
        )}
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[10px] uppercase tracking-wider text-ink-3">
          {book.quote_count !== undefined && book.quote_count > 0 && (
            <span>{book.quote_count} hl</span>
          )}
          {badge && <span>· {badge}</span>}
        </div>
      </Link>
    </li>
  );
}
