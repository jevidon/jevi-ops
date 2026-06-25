import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ScreenHeader } from '@/components/ScreenHeader';
import {
  libraryApi,
  ApiError,
  type Quote,
  type QuoteAnnotation,
  type AnnotationContext,
} from '@/lib/api';
import { AddAnnotationForm } from './add-annotation-form';
import { deleteAnnotationAction, deleteQuoteAction } from './actions';
import { QuoteForm } from '../quote-form';
import { BoostButton } from '@/components/BoostButton';
import { getAppTimezone } from '@/lib/app-settings';

// /library/quotes/[id] — quote at top in serif italic, then annotations
// chronologically with context labels. Bottom: add-annotation form. Header
// has a small delete-quote affordance behind a confirmation step.

const CONTEXT_LABELS: Record<AnnotationContext, string> = {
  on_capture: 'On capture',
  on_revisit: 'On revisit',
  on_surface: 'On surface',
  unspecified: 'Thought',
};

export default async function QuoteDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const tz = await getAppTimezone();

  let quote: Quote | null = null;
  let annotations: QuoteAnnotation[] = [];
  let books: { id: string; title: string; author: string | null }[] = [];
  let errorMessage: string | null = null;

  try {
    // Fetch the quote (with annotations) and the books list in parallel —
    // the books list powers the dropdown inside the edit form.
    const [quoteRes, booksRes] = await Promise.all([
      libraryApi.quotes.get(id),
      libraryApi.books.list(),
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
      <div>
        <ScreenHeader eyebrow="Quote" title="—" />
        <div className="hairline" />
        <div className="px-5 lg:px-0 mt-6 font-sans text-[13px] text-ink-3">
          {errorMessage ?? 'Quote not found.'}
        </div>
      </div>
    );
  }

  const metaBits = [
    quote.source_author,
    quote.book?.title ?? quote.source_reference,
    quote.page_number ? `p. ${quote.page_number}` : null,
    quote.chapter ? `ch. ${quote.chapter}` : null,
  ].filter(Boolean);

  return (
    <div>
      <div className="px-5 lg:px-0 pt-4 pb-1 font-mono text-[10px] uppercase tracking-wider text-ink-3">
        <Link href="/library/quotes" className="hover:text-ink-2 transition-colors">
          ← Quotes
        </Link>
      </div>

      <ScreenHeader
        eyebrow="Quote"
        title={
          <span className="italic">
            &ldquo;{quote.text}&rdquo;
          </span>
        }
        meta={
          metaBits.length
            ? metaBits.join(' · ')
            : `Saved ${new Date(quote.created_at).toLocaleDateString('en-US', { timeZone: tz, month: 'short', day: 'numeric', year: 'numeric' })}`
        }
      />
      <div className="hairline mb-6" />

      {/* External source link — when the user attached a URL (e.g. the
          YouTube video the quote came from). Rendered separately from
          the meta line so it stays a clean affordance. */}
      {quote.source_url && (
        <div className="px-5 lg:px-0 -mt-3 mb-6">
          <a
            href={quote.source_url}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-[10px] uppercase tracking-wider text-accent hover:text-accent-ink transition-colors"
          >
            Open source ↗
          </a>
        </div>
      )}

      <div className="px-5 lg:px-0 max-w-2xl">
        {/* Resurface weight control. Cycles through Normal / Boost 2× /
            Boost 5× / Excluded. Affects how often this quote can show up
            in the Today page's Resurfacing panel. */}
        <div className="mb-6 flex items-center gap-3">
          <span className="eyebrow">Resurfacing</span>
          <BoostButton kind="quote" id={quote.id} weight={quote.resurface_weight} />
        </div>

        {/* Edit panel — collapsed by default to keep the focus on the
            quote text + annotations. Open it to fix transcription
            errors, change page number, add tags, rebind to a book, etc. */}
        <details className="mb-8 border border-line">
          <summary className="cursor-pointer px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-ink-3 hover:text-ink-2 transition-colors list-none">
            Edit highlight ▾
          </summary>
          <div className="px-4 pb-4 pt-3 border-t border-line">
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
          </div>
        </details>

        {/* Thoughts / annotations */}
        <section>
          <div className="eyebrow mb-3">
            Thoughts {annotations.length > 0 ? `· ${annotations.length}` : ''}
          </div>

          {annotations.length === 0 ? (
            <div className="font-sans text-[13px] text-ink-3 italic mb-6">
              No thoughts yet. Add the first one below.
            </div>
          ) : (
            <ul className="mb-8 space-y-5">
              {annotations.map((a) => (
                <li key={a.id} className="border-l-2 border-line pl-4">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-mono text-[10px] uppercase tracking-wider text-ink-3">
                      {CONTEXT_LABELS[a.context]} ·{' '}
                      {new Date(a.annotated_at).toLocaleDateString('en-US', {
                        timeZone: tz,
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                    </span>
                    <form action={deleteAnnotationAction}>
                      <input type="hidden" name="id" value={a.id} />
                      <input type="hidden" name="quoteId" value={quote!.id} />
                      <button
                        type="submit"
                        title="Delete thought"
                        className="font-mono text-[10px] uppercase tracking-wider text-ink-3 hover:text-accent transition-colors"
                      >
                        Delete
                      </button>
                    </form>
                  </div>
                  <p className="mt-1.5 font-sans text-[14px] text-ink leading-relaxed whitespace-pre-wrap">
                    {a.body}
                  </p>
                </li>
              ))}
            </ul>
          )}

          {/* Add annotation */}
          <div className="border-t border-line pt-5">
            <div className="eyebrow mb-2">Add a thought</div>
            <AddAnnotationForm quoteId={quote.id} />
          </div>
        </section>

        {/* Tags */}
        {quote.tags.length > 0 && (
          <div className="mt-10 pt-5 border-t border-line">
            <div className="eyebrow mb-2">Tags</div>
            <div className="flex flex-wrap gap-1.5">
              {quote.tags.map((t) => (
                <span
                  key={t}
                  className="px-2 py-0.5 border border-line font-mono text-[10px] uppercase tracking-wider text-ink-2"
                >
                  {t}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Danger zone */}
        <div className="mt-12 pt-6 border-t border-line">
          <div className="eyebrow mb-3">Danger zone</div>
          <DeleteQuote quoteId={quote.id} text={quote.text} />
        </div>
      </div>
    </div>
  );
}

// Inline confirmation. Two-step on purpose — quotes have prose attached and
// the delete cascades to all annotations, so a stray click should be hard.
function DeleteQuote({ quoteId, text }: { quoteId: string; text: string }) {
  const preview = text.length > 60 ? text.slice(0, 60) + '…' : text;
  return (
    <details className="font-sans text-[13px] text-ink-2">
      <summary className="cursor-pointer font-mono text-[11px] uppercase tracking-wider text-ink-3 hover:text-accent transition-colors list-none">
        Delete quote…
      </summary>
      <form action={deleteQuoteAction} className="mt-3 flex flex-wrap items-center gap-3">
        <input type="hidden" name="quoteId" value={quoteId} />
        <span>
          Delete &ldquo;{preview}&rdquo; and all thoughts on it?
        </span>
        <button
          type="submit"
          className="bg-accent text-bg font-sans font-semibold text-[12px] uppercase tracking-wider px-3 py-1.5 transition-colors"
        >
          Confirm delete
        </button>
      </form>
    </details>
  );
}
