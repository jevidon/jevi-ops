import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ScreenHeader } from '@/components/ScreenHeader';
import { libraryApi, ApiError, type Book, type Quote } from '@/lib/api';
import { BookForm } from '../book-form';

// /library/books/[id] — book cover + metadata + every imported highlight,
// ordered by Kindle Location number (page_number column). Each highlight
// is just the quote text + location + tags + annotation count.

export default async function BookDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let book: Book | null = null;
  let quotes: Quote[] = [];
  let errorMessage: string | null = null;

  try {
    const res = await libraryApi.books.get(id);
    book = res.book;
    quotes = res.quotes;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    errorMessage = err instanceof ApiError ? `API ${err.status}` : (err as Error).message;
  }

  if (!book) {
    return (
      <div>
        <ScreenHeader eyebrow="Book" title="—" />
        <div className="hairline" />
        <div className="px-5 lg:px-0 mt-6 font-sans text-[13px] text-ink-3">
          {errorMessage ?? 'Book not found.'}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="px-5 lg:px-0 pt-4 pb-1 font-mono text-[10px] uppercase tracking-wider text-ink-3">
        <Link href="/library/books" className="hover:text-ink-2 transition-colors">
          ← Books
        </Link>
      </div>

      <ScreenHeader
        eyebrow={book.author ? `By ${book.author}` : 'Book'}
        title={book.title}
        meta={`${quotes.length} highlight${quotes.length === 1 ? '' : 's'}`}
      />
      <div className="hairline mb-6" />

      <div className="px-5 lg:px-0 max-w-3xl">
        {/* Cover + edit form. Cover sits to the left on desktop, above on
            mobile. The form holds every editable field (status, format,
            dates, rating, summary). */}
        <div className="flex flex-col md:flex-row gap-6 mb-10">
          {book.cover_image_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={book.cover_image_url}
              alt={book.title}
              className="w-32 h-auto border border-line shrink-0 self-start"
            />
          )}
          <div className="flex-1 min-w-0">
            <BookForm
              initial={{
                id: book.id,
                title: book.title,
                author: book.author ?? '',
                isbn: book.isbn ?? '',
                cover_image_url: book.cover_image_url ?? '',
                status: book.status,
                format: book.format ?? '',
                started_at: book.started_at ?? '',
                finished_at: book.finished_at ?? '',
                rating: book.rating ?? '',
                my_summary: book.my_summary ?? '',
              }}
            />
          </div>
        </div>

        {/* Highlights */}
        {quotes.length === 0 ? (
          <div className="font-sans text-[13px] text-ink-3 italic">
            No highlights for this book yet.
          </div>
        ) : (
          <div>
            <div className="eyebrow mb-4">Highlights</div>
            <ul className="space-y-6">
              {quotes.map((q) => (
                <li key={q.id} className="border-l-2 border-line pl-4">
                  <Link
                    href={`/library/quotes/${q.id}`}
                    className="block hover:opacity-80 transition-opacity"
                  >
                    <p className="font-serif text-[15px] text-ink leading-relaxed italic">
                      &ldquo;{q.text}&rdquo;
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] uppercase tracking-wider text-ink-3">
                      {q.page_number != null && <span>Location {q.page_number}</span>}
                      {q.tags?.length > 0 && (
                        <span>· {q.tags.map((t) => `#${t}`).join(' ')}</span>
                      )}
                      {q.annotation_count !== undefined && q.annotation_count > 0 && (
                        <span>
                          · {q.annotation_count} thought{q.annotation_count === 1 ? '' : 's'}
                        </span>
                      )}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
