import Link from 'next/link';
import { ScreenHeader } from '@/components/ScreenHeader';
import { libraryApi, ApiError } from '@/lib/api';
import { QuoteForm } from '../quote-form';

// /library/quotes/new — manual highlight entry. Reached either from the
// quotes list ("+ Add highlight") or from a specific book detail page
// ("+ Add highlight"), which prefills ?book_id=... to skip the dropdown.

export default async function NewQuotePage({
  searchParams,
}: {
  searchParams: Promise<{ book_id?: string }>;
}) {
  const { book_id: bookIdFromQuery } = await searchParams;

  // Fetch the books list for the dropdown. If we have a prefilled book_id,
  // pull that book's details too so we can use them as defaults on the
  // form (source_type=book, source_author=book.author).
  let books: { id: string; title: string; author: string | null }[] = [];
  let prefillSourceType = '';
  let prefillSourceAuthor = '';
  try {
    const { books: list } = await libraryApi.books.list();
    books = list.map((b) => ({ id: b.id, title: b.title, author: b.author }));
    if (bookIdFromQuery) {
      const book = list.find((b) => b.id === bookIdFromQuery);
      if (book) {
        prefillSourceType = 'book';
        prefillSourceAuthor = book.author ?? '';
      }
    }
  } catch (err) {
    if (!(err instanceof ApiError)) {
      // Let unknown errors surface; if it's an ApiError we just continue
      // with empty books list (form still works).
      throw err;
    }
  }

  const backHref = bookIdFromQuery ? `/library/books/${bookIdFromQuery}` : '/library/quotes';
  const backLabel = bookIdFromQuery ? '← Book' : '← Quotes';

  return (
    <div>
      <div className="px-5 lg:px-0 pt-4 pb-1 font-mono text-[10px] uppercase tracking-wider text-ink-3">
        <Link href={backHref} className="hover:text-ink-2 transition-colors">
          {backLabel}
        </Link>
      </div>

      <ScreenHeader eyebrow="Library" title="Add highlight" meta="New entry" />
      <div className="hairline mb-6" />

      <div className="px-5 lg:px-0 max-w-2xl">
        <QuoteForm
          books={books}
          initial={{
            text: '',
            book_id: bookIdFromQuery ?? '',
            source_type: prefillSourceType,
            source_author: prefillSourceAuthor,
            source_ref: '',
            page_number: '',
            chapter: '',
            tags: '',
          }}
        />
      </div>
    </div>
  );
}
