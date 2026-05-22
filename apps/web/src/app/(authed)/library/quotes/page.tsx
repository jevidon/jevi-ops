import Link from 'next/link';
import { ScreenHeader } from '@/components/ScreenHeader';
import { libraryApi, ApiError, type Quote } from '@/lib/api';
import { LibraryTabBar } from '../library-tab-bar';

export default async function QuotesListPage() {
  let quotes: Quote[] = [];
  let errorMessage: string | null = null;
  try {
    quotes = (await libraryApi.quotes.list()).quotes;
  } catch (err) {
    errorMessage = err instanceof ApiError ? `API ${err.status}` : (err as Error).message;
  }

  return (
    <div>
      <ScreenHeader eyebrow="Library" title="Quotes" meta={`${quotes.length} saved`} />
      <div className="hairline" />
      <LibraryTabBar active="quotes" />

      {errorMessage ? (
        <div className="px-5 lg:px-0 mt-6 font-sans text-[13px] text-ink-3">Error: {errorMessage}</div>
      ) : quotes.length === 0 ? (
        <div className="px-5 lg:px-0 mt-6 font-sans text-[13px] text-ink-3 italic">
          No quotes saved yet. Voice command: &ldquo;Save a quote from {'<book>'} by {'<author>'}: {'<text>'}&rdquo;
        </div>
      ) : (
        <ul className="px-5 lg:px-0 mt-4">
          {quotes.map((q) => (
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
