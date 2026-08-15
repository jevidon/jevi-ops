import Link from 'next/link';
import { notFound } from 'next/navigation';
import { libraryApi, ApiError, type Quote, type QuoteAnnotation, type AnnotationContext } from '@/lib/api';
import { getAppTimezone } from '@/lib/app-settings';
import { AddAnnotationForm } from './add-annotation-form';
import { deleteAnnotationAction, deleteQuoteAction } from './actions';
import { QuoteForm } from '../quote-form';
import { BoostButton } from '@/components/BoostButton';
import { EditDrawer } from '@/components/detail/EditDrawer';

// /library/quotes/[id] — an epigraph page (Detail Pages v2, Addendum 10 §10).
// The quote is set large in the serif; attribution (author · book · page) sits
// beneath with the book cover when linked; the annotation thread follows, the
// on-capture thought in accent. A daily destination (Reflection taps through),
// so resurfacing keeps a home in the footer and config lives behind Edit.

const CONTEXT_LABELS: Record<AnnotationContext, string> = {
  on_capture: 'On capture', on_revisit: 'On revisit', on_surface: 'On surface', unspecified: 'Thought',
};

export default async function QuoteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tz = await getAppTimezone();

  let quote: Quote | null = null;
  let annotations: QuoteAnnotation[] = [];
  let books: { id: string; title: string; author: string | null }[] = [];
  let errorMessage: string | null = null;
  try {
    const [quoteRes, booksRes] = await Promise.all([
      libraryApi.quotes.get(id),
      // Ancillary — only feeds the Edit drawer's book picker. A books-list
      // hiccup must never blank an otherwise-readable quote.
      libraryApi.books.list().catch(() => ({ books: [] as { id: string; title: string; author: string | null }[] })),
    ]);
    quote = quoteRes.quote;
    annotations = quoteRes.annotations;
    books = booksRes.books.map((b) => ({ id: b.id, title: b.title, author: b.author }));
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    errorMessage = err instanceof ApiError ? `API ${err.status}` : (err as Error).message;
  }

  if (!quote) {
    return (
      <div className="mx-auto max-w-2xl px-5 lg:px-8 pt-10">
        <h1 className="font-serif text-[32px] font-medium tracking-[-0.02em] text-ink">—</h1>
        <p className="mt-4 font-sans text-[13px] text-ink-3">{errorMessage ?? 'Quote not found.'}</p>
      </div>
    );
  }

  const book = quote.book ?? null;
  const author = quote.source_author?.trim() || null;
  const sourceRef = quote.source_reference?.trim() || null;
  const pageStr = quote.page_number != null && String(quote.page_number).trim() !== '' ? String(quote.page_number) : null;
  const chapter = quote.chapter?.trim() || null;
  const hasAttribution = Boolean(author || book || sourceRef || pageStr || chapter);
  const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { timeZone: tz, month: 'short', day: 'numeric', year: 'numeric' });

  return (
    <div className="mx-auto max-w-2xl px-5 lg:px-8 pt-4 pb-24">
      <div className="pb-1 font-mono text-[10px] uppercase tracking-wider text-ink-3">
        <Link href="/library/quotes" className="hover:text-ink-2 transition-colors">← Quotes</Link>
      </div>

      <blockquote className="mt-8 font-serif text-[27px] leading-[1.42] tracking-[-0.005em] text-ink italic text-balance">
        &ldquo;{quote.text}&rdquo;
      </blockquote>

      {hasAttribution && (
        <div className="mt-6">
          {author && <div className="font-serif text-[15px] italic text-ink-2">— {author}</div>}
          {(book || sourceRef || pageStr || chapter) && (
            <div className="mt-3 flex items-center gap-3">
              {book?.cover_image_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={book.cover_image_url} alt={book.title} className="w-10 h-auto border border-line shrink-0 self-start" />
              )}
              <div className="font-mono text-[10px] uppercase tracking-wider text-ink-3 leading-relaxed">
                {book ? (
                  <Link href={`/library/books/${book.id}`} className="hover:text-accent transition-colors">{book.title}</Link>
                ) : sourceRef ? <span>{sourceRef}</span> : null}
                {(pageStr || chapter) && (
                  <div className="text-ink-4 mt-0.5">
                    {[pageStr ? `p. ${pageStr}` : null, chapter ? `ch. ${chapter}` : null].filter(Boolean).join(' · ')}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Standalone — a highlight from a video/podcast/article may carry ONLY a
          source URL and no other attribution, so this must not depend on it. */}
      {quote.source_url && (
        <a href={quote.source_url} target="_blank" rel="noopener noreferrer"
          className="mt-4 inline-block font-mono text-[10px] uppercase tracking-wider text-accent hover:text-accent-ink transition-colors">
          Open source ↗
        </a>
      )}

      <section className="mt-10 pt-6 border-t border-line">
        <div className="eyebrow mb-4">Thoughts {annotations.length > 0 ? `· ${annotations.length}` : ''}</div>
        {annotations.length === 0 ? (
          <p className="font-sans text-[13px] text-ink-3 italic mb-6">No thoughts yet. Add the first one below.</p>
        ) : (
          <ul className="mb-8 space-y-5">
            {annotations.map((a) => {
              const onCapture = a.context === 'on_capture';
              return (
                <li key={a.id} className={`pl-4 border-l-2 ${onCapture ? 'border-l-accent' : 'border-line'}`}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className={`font-mono text-[10px] uppercase tracking-wider ${onCapture ? 'text-accent' : 'text-ink-3'}`}>
                      {CONTEXT_LABELS[a.context]} · {fmtDate(a.annotated_at)}
                    </span>
                    <form action={deleteAnnotationAction}>
                      <input type="hidden" name="id" value={a.id} />
                      <input type="hidden" name="quoteId" value={quote!.id} />
                      <button type="submit" title="Delete thought" className="font-mono text-[10px] uppercase tracking-wider text-ink-3 hover:text-accent transition-colors">Delete</button>
                    </form>
                  </div>
                  <p className="mt-1.5 font-sans text-[14px] text-ink leading-relaxed whitespace-pre-wrap">{a.body}</p>
                </li>
              );
            })}
          </ul>
        )}
        <div className="border-t border-line pt-5">
          <div className="eyebrow mb-2">Add a thought</div>
          <AddAnnotationForm quoteId={quote.id} />
        </div>
      </section>

      <footer className="mt-12 pt-5 border-t border-line flex flex-col gap-4">
        {quote.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {quote.tags.map((t) => (
              <span key={t} className="px-2 py-0.5 border border-line font-mono text-[10px] uppercase tracking-wider text-ink-3">{t}</span>
            ))}
          </div>
        )}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <span className="eyebrow">Resurfacing</span>
            <BoostButton kind="quote" id={quote.id} weight={quote.resurface_weight} />
          </div>
          <EditDrawer title="Edit highlight" triggerVariant="quiet">
            <QuoteForm
              books={books}
              initial={{
                id: quote.id,
                text: quote.text,
                book_id: quote.book?.id ?? '',
                source_type: quote.source_type ?? '',
                source_author: quote.source_author ?? '',
                source_reference: quote.source_reference ?? '',
                source_url: quote.source_url ?? '',
                page_number: quote.page_number != null ? String(quote.page_number) : '',
                chapter: quote.chapter ?? '',
                tags: (quote.tags ?? []).join(', '),
              }}
            />
            <div className="mt-8 pt-4 border-t border-line">
              <div className="eyebrow mb-2 text-accent">Danger zone</div>
              {/* Two-step: delete cascades to every thought on the quote, so a
                  stray click stays hard. */}
              <details className="font-sans text-[13px] text-ink-2">
                <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-wider text-ink-3 hover:text-accent transition-colors list-none">
                  Delete quote…
                </summary>
                <form action={deleteQuoteAction} className="mt-3 flex flex-wrap items-center gap-3">
                  <input type="hidden" name="quoteId" value={quote.id} />
                  <span>Delete this quote and all thoughts on it?</span>
                  <button type="submit" className="px-3 py-1.5 bg-accent text-bg font-mono text-[10px] uppercase tracking-wider hover:bg-accent-ink transition-colors">
                    Confirm delete
                  </button>
                </form>
              </details>
            </div>
          </EditDrawer>
        </div>
      </footer>
    </div>
  );
}
