import Link from 'next/link';
import { ScreenHeader } from '@/components/ScreenHeader';
import { libraryApi, ApiError, type Book } from '@/lib/api';
import { LibraryTabBar } from '../library-tab-bar';

// Books — reading log + highlights container. Each book row links to a
// detail page that shows all imported highlights chronologically.

export default async function BooksPage() {
  let books: Book[] = [];
  let errorMessage: string | null = null;
  try {
    books = (await libraryApi.books.list()).books;
  } catch (err) {
    errorMessage = err instanceof ApiError ? `API ${err.status}` : (err as Error).message;
  }

  const totalHighlights = books.reduce((sum, b) => sum + (b.quote_count ?? 0), 0);

  return (
    <div>
      <ScreenHeader
        eyebrow="Library"
        title="Books"
        meta={`${books.length} books · ${totalHighlights} highlights`}
      />
      <div className="hairline" />
      <LibraryTabBar active="books" />

      {errorMessage ? (
        <div className="px-5 lg:px-0 mt-6 font-sans text-[13px] text-ink-3">Error: {errorMessage}</div>
      ) : books.length === 0 ? (
        <div className="px-5 lg:px-0 mt-6 font-sans text-[13px] text-ink-3 italic">
          No books yet. Readwise imports + voice book captures land here.
        </div>
      ) : (
        <ul className="px-5 lg:px-0 mt-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-6">
          {books.map((b) => (
            <BookCard key={b.id} book={b} />
          ))}
        </ul>
      )}
    </div>
  );
}

function BookCard({ book }: { book: Book }) {
  return (
    <li>
      <Link
        href={`/library/books/${book.id}`}
        className="group block"
      >
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
        {book.quote_count !== undefined && book.quote_count > 0 && (
          <div className="mt-1 font-mono text-[10px] uppercase tracking-wider text-ink-3">
            {book.quote_count} highlight{book.quote_count === 1 ? '' : 's'}
          </div>
        )}
      </Link>
    </li>
  );
}
