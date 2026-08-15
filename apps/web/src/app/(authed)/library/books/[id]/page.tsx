import Link from 'next/link';
import { notFound } from 'next/navigation';
import { libraryApi, ApiError, type Book, type Quote } from '@/lib/api';
import { getAppTimezone } from '@/lib/app-settings';
import { EditDrawer } from '@/components/detail/EditDrawer';
import { BookForm } from '../book-form';

// /library/books/[id] — a book shrine (Detail Pages v2, Addendum 10 §10). Cover
// art leads, the read-only metadata + my-summary sit beside it, and every
// harvested highlight links out to its own quote page. Config lives behind Edit.

const STATUS_LABELS: Record<string, string> = {
  reading: 'Reading', finished: 'Finished', abandoned: 'Abandoned', want_to_read: 'Want to read',
};
const FORMAT_LABELS: Record<string, string> = { physical: 'Physical', kindle: 'Kindle', audiobook: 'Audiobook' };

function fmtDate(ymd: string, tz: string): string {
  return new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: tz, month: 'short', day: 'numeric', year: 'numeric' });
}

export default async function BookDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tz = await getAppTimezone();

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
      <div className="mx-auto max-w-3xl px-5 lg:px-8 pt-10">
        <h1 className="font-serif text-[32px] font-medium tracking-[-0.02em] text-ink">—</h1>
        <p className="mt-4 font-sans text-[13px] text-ink-3">{errorMessage ?? 'Book not found.'}</p>
      </div>
    );
  }

  const dateRange = [
    book.started_at ? `Started ${fmtDate(book.started_at, tz)}` : null,
    book.finished_at ? `Finished ${fmtDate(book.finished_at, tz)}` : null,
  ].filter(Boolean).join(' · ');

  return (
    <div className="mx-auto max-w-3xl px-5 lg:px-8 pt-4 pb-24">
      <div className="pb-1 font-mono text-[10px] uppercase tracking-wider text-ink-3">
        <Link href="/library/books" className="hover:text-ink-2 transition-colors">← Books</Link>
      </div>

      <div className="mt-3 flex flex-col sm:flex-row gap-6 sm:gap-8">
        {book.cover_image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={book.cover_image_url} alt={book.title} className="w-36 sm:w-44 h-auto border border-line shrink-0 self-start shadow-[0_10px_30px_-16px_rgba(18,16,14,0.5)]" />
        ) : (
          <div className="w-36 sm:w-44 aspect-[2/3] border border-line bg-surface-2 flex items-center justify-center p-4 shrink-0 self-start">
            <span className="font-serif text-[15px] text-ink-3 text-center leading-tight">{book.title}</span>
          </div>
        )}

        <div className="flex-1 min-w-0">
          <div className="font-mono text-[10px] uppercase tracking-[0.11em] text-ink-3">Book</div>
          <h1 className="mt-2 font-serif text-[30px] leading-[1.08] tracking-[-0.02em] font-medium text-ink text-balance">{book.title}</h1>
          {book.author && <div className="mt-1.5 font-serif text-[16px] italic text-ink-2">{book.author}</div>}

          <div className="mt-4 flex flex-col gap-1.5 font-mono text-[10px] uppercase tracking-wider text-ink-3">
            <div>{STATUS_LABELS[book.status] ?? book.status}{book.format ? ` · ${FORMAT_LABELS[book.format] ?? book.format}` : ''}</div>
            {dateRange && <div>{dateRange}</div>}
            {book.rating != null && (
              <div className="text-ink-2 tracking-[0.15em]">
                <span className="text-accent">{'★'.repeat(book.rating)}</span>{'☆'.repeat(Math.max(0, 5 - book.rating))}
              </div>
            )}
          </div>

          {book.my_summary && (
            <div className="mt-6">
              <div className="eyebrow mb-2">My summary</div>
              <p className="font-serif text-[16px] leading-[1.6] text-ink-2 whitespace-pre-wrap">{book.my_summary}</p>
            </div>
          )}

          <div className="mt-6">
            <EditDrawer title="Edit book" triggerVariant="quiet">
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
            </EditDrawer>
          </div>
        </div>
      </div>

      <section className="mt-12 pt-6 border-t border-line">
        <div className="flex items-baseline justify-between gap-3 mb-5">
          <div className="eyebrow">Highlights {quotes.length > 0 ? `· ${quotes.length}` : ''}</div>
          <Link href={`/library/quotes/new?book_id=${book.id}`} className="font-mono text-[10px] uppercase tracking-wider text-ink-3 hover:text-accent transition-colors">
            + Add highlight
          </Link>
        </div>
        {quotes.length === 0 ? (
          <p className="font-sans text-[13px] text-ink-3 italic">No highlights harvested from this book yet.</p>
        ) : (
          <ul className="space-y-6">
            {quotes.map((q) => {
              const parts: string[] = [];
              if (q.page_number != null && String(q.page_number).trim() !== '') parts.push(`Location ${q.page_number}`);
              if (q.tags?.length > 0) parts.push(q.tags.map((t) => `#${t}`).join(' '));
              if (q.annotation_count && q.annotation_count > 0) parts.push(`${q.annotation_count} thought${q.annotation_count === 1 ? '' : 's'}`);
              return (
                <li key={q.id} className="border-l-2 border-line pl-4">
                  <Link href={`/library/quotes/${q.id}`} className="block hover:opacity-80 transition-opacity">
                    <p className="font-serif text-[16px] text-ink leading-relaxed italic">&ldquo;{q.text}&rdquo;</p>
                    {parts.length > 0 && (
                      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[10px] uppercase tracking-wider text-ink-3">
                        {parts.map((p, i) => <span key={i}>{i > 0 ? '· ' : ''}{p}</span>)}
                      </div>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
