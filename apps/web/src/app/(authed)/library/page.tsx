import Link from 'next/link';
import { ScreenHeader } from '@/components/ScreenHeader';
import { libraryApi, ApiError, type FeedItem } from '@/lib/api';
import { LibraryTabBar } from './library-tab-bar';

// /library — "All" sub-tab default. Unified chronological feed across notes,
// quotes, quote annotations, and journal entries. Each sub-tab (Notes,
// Quotes, Journal, Books, Inventory) is its own route under /library/.

const KIND_LABEL: Record<FeedItem['kind'], string> = {
  note: 'Note',
  quote: 'Quote',
  annotation: 'Annotation',
  journal: 'Journal',
};

const KIND_HREF: Record<FeedItem['kind'], (id: string, payload: Record<string, unknown>) => string> = {
  note: (id) => `/library/notes/${id}`,
  quote: (id) => `/library/quotes/${id}`,
  annotation: (_id, payload) => `/library/quotes/${payload.quote_id as string}`,
  journal: () => `/library/journal`,
};

function renderPayload(item: FeedItem): string {
  const p = item.payload;
  if (item.kind === 'note') return String(p.body ?? '');
  if (item.kind === 'quote') return String(p.text ?? '');
  if (item.kind === 'annotation') {
    // Show "[parent quote excerpt] — [annotation body]" so the annotation
    // lands in context.
    type QuoteRel = { text?: string };
    const quote = p.quote as QuoteRel | QuoteRel[] | undefined;
    const qarr = Array.isArray(quote) ? quote : quote ? [quote] : [];
    const quoteText = qarr[0]?.text ?? '';
    const snippet = quoteText.length > 80 ? quoteText.slice(0, 80) + '…' : quoteText;
    return `"${snippet}" — ${String(p.body ?? '')}`;
  }
  if (item.kind === 'journal') return String(p.transcription_text ?? '');
  return '';
}

function renderMeta(item: FeedItem): string | null {
  const p = item.payload;
  if (item.kind === 'note') {
    const source = String(p.source_type ?? '').replace(/_/g, ' ');
    return source || null;
  }
  if (item.kind === 'quote') {
    const author = p.source_author ?? null;
    return author ? String(author) : null;
  }
  if (item.kind === 'annotation') {
    type QuoteRel = { source_author?: string | null };
    const quote = p.quote as QuoteRel | QuoteRel[] | undefined;
    const qarr = Array.isArray(quote) ? quote : quote ? [quote] : [];
    return qarr[0]?.source_author ?? null;
  }
  return null;
}

export default async function LibraryPage() {
  let items: FeedItem[] = [];
  let errorMessage: string | null = null;
  try {
    items = (await libraryApi.feed()).items;
  } catch (err) {
    errorMessage = err instanceof ApiError ? `API ${err.status}` : (err as Error).message;
  }

  return (
    <div>
      <ScreenHeader
        eyebrow="Archive"
        title="Library"
        meta={`${items.length} entries`}
      />
      <div className="hairline" />

      <LibraryTabBar active="all" />

      {errorMessage ? (
        <div className="px-5 lg:px-0 mt-6 font-sans text-[13px] text-ink-3">
          Couldn't load: {errorMessage}
        </div>
      ) : items.length === 0 ? (
        <div className="px-5 lg:px-0 mt-6 font-sans text-[13px] text-ink-3 italic">
          Nothing here yet. Voice captures, quotes, and journal entries land here.
        </div>
      ) : (
        <ul className="px-5 lg:px-0 mt-2">
          {items.map((item) => (
            <li key={`${item.kind}-${item.id}`} className="py-3 border-b border-line/40">
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-mono text-[10px] uppercase tracking-wider text-ink-3">
                  {KIND_LABEL[item.kind]}
                  {renderMeta(item) ? ` · ${renderMeta(item)}` : ''}
                </span>
                <span className="font-mono text-[10px] uppercase tracking-wider text-ink-3">
                  {new Date(item.at).toLocaleDateString('en-US', {
                    timeZone: 'America/Denver',
                    month: 'short',
                    day: 'numeric',
                    year: new Date(item.at).getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined,
                  })}
                </span>
              </div>
              <Link
                href={KIND_HREF[item.kind](item.id, item.payload)}
                className="mt-1 block font-sans text-[14px] text-ink leading-snug hover:text-accent transition-colors"
              >
                {renderPayload(item)}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
