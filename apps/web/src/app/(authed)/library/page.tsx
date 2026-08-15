import { libraryApi, ApiError, type Book } from '@/lib/api';
import { getAppTimezone } from '@/lib/app-settings';
import { todayIsoDate } from '@/lib/today';
import { LibraryView } from './library-view';
import { buildEntries, normalizeType, type LibEntry } from './lib-data';

// /library — the unified archive (v2 redesign). Thin server shell: fetch the
// three entry lists (notes/quotes/journal) + books in parallel, normalize the
// entries app-tz, hand off to the client LibraryView which owns the type-scoped
// facet rail + card grid. `?type=` deep-links a starting type (the retired
// sub-index routes redirect here). Inventory has no endpoint yet — its facet is
// a stub in the view.

export const dynamic = 'force-dynamic';

export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>;
}) {
  const { type } = await searchParams;
  const initialType = normalizeType(type);

  const tz = await getAppTimezone();
  const today = todayIsoDate(tz);

  // Fetch each list to the API's hard ceiling (2000) so the client-side facet
  // rail sees the whole real corpus, not just the newest 500 — the old per-type
  // pages pushed the tag/needs-review filter to the server before the cap, so a
  // low limit here would silently hide older matches. allSettled degrades per
  // section: a books outage leaves the notes/quotes/journal grid intact.
  const LIMIT = 2000;
  const [notesR, quotesR, journalR, booksR] = await Promise.allSettled([
    libraryApi.notes.list({ limit: LIMIT }),
    libraryApi.quotes.list({ limit: LIMIT }),
    libraryApi.journal.list({ limit: LIMIT }),
    libraryApi.books.list({ limit: LIMIT }),
  ]);

  const notes = notesR.status === 'fulfilled' ? notesR.value.notes : [];
  const quotes = quotesR.status === 'fulfilled' ? quotesR.value.quotes : [];
  const journal = journalR.status === 'fulfilled' ? journalR.value.entries : [];
  const books: Book[] = booksR.status === 'fulfilled' ? booksR.value.books : [];

  const entries: LibEntry[] = buildEntries(notes, quotes, journal, { tz, todayIso: today });

  // Only a total wipeout is a hard error; any one section succeeding still renders.
  const allFailed = [notesR, quotesR, journalR, booksR].every((r) => r.status === 'rejected');
  if (allFailed) {
    const first = [notesR, quotesR, journalR, booksR].find((r) => r.status === 'rejected') as
      | PromiseRejectedResult
      | undefined;
    const reason = first?.reason;
    const errorMessage = reason instanceof ApiError ? `API ${reason.status}` : (reason as Error)?.message ?? 'unknown error';
    return (
      <div className="px-5 lg:px-10 pt-8">
        <h1 className="font-serif text-[40px] font-medium tracking-[-0.022em] text-ink">Library</h1>
        <p className="mt-4 font-sans text-[13px] text-ink-3">Couldn&rsquo;t load the library: {errorMessage}</p>
      </div>
    );
  }

  return <LibraryView entries={entries} books={books} initialType={initialType} />;
}
