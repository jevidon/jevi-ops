import Link from 'next/link';
import { ScreenHeader } from '@/components/ScreenHeader';
import { libraryApi, ApiError, type FeedItem } from '@/lib/api';
import { getAppTimezone } from '@/lib/app-settings';
import { LibraryTabBar } from './library-tab-bar';

// /library — "All" sub-tab default. Unified chronological feed across notes,
// quotes, quote annotations, and journal entries. Each sub-tab (Notes,
// Quotes, Journal, Books, Inventory) is its own route under /library/.
//
// Rendering parity with the per-kind sub-pages: notes get title + body
// + tags, quotes render in serif italic with book/author meta, journal
// entries truncate to 3 lines. Long bodies always clamp — the All view
// is meant for scanning, the detail page is meant for reading.

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
  journal: (id) => `/library/journal/${id}`,
};

interface BookRel { id?: string; title?: string; author?: string }
interface QuoteRel { id?: string; text?: string; source_author?: string | null }

function pickFirst<T>(v: T | T[] | undefined | null): T | undefined {
  if (Array.isArray(v)) return v[0];
  return v ?? undefined;
}

// Meta line for the row header — kind label + author/book/source.
function renderMeta(item: FeedItem): string | null {
  const p = item.payload;
  if (item.kind === 'note') {
    const source = String(p.source_type ?? '').replace(/_/g, ' ');
    return source || null;
  }
  if (item.kind === 'quote') {
    const author = p.source_author ? String(p.source_author) : null;
    const book = pickFirst(p.book as BookRel | BookRel[] | undefined);
    const bookTitle = book?.title ?? null;
    return [author, bookTitle].filter(Boolean).join(' · ') || null;
  }
  if (item.kind === 'annotation') {
    const quote = pickFirst(p.quote as QuoteRel | QuoteRel[] | undefined);
    return quote?.source_author ?? null;
  }
  return null;
}

export default async function LibraryPage() {
  const tz = await getAppTimezone();
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
          Couldn&rsquo;t load: {errorMessage}
        </div>
      ) : items.length === 0 ? (
        <div className="px-5 lg:px-0 mt-6 font-sans text-[13px] text-ink-3 italic">
          Nothing here yet. Voice captures, quotes, and journal entries land here.
        </div>
      ) : (
        <ul className="px-5 lg:px-0 mt-2">
          {items.map((item) => (
            <FeedRow key={`${item.kind}-${item.id}`} item={item} tz={tz} />
          ))}
        </ul>
      )}
    </div>
  );
}

function FeedRow({ item, tz }: { item: FeedItem; tz: string }) {
  const p = item.payload;
  const meta = renderMeta(item);
  const href = KIND_HREF[item.kind](item.id, p);
  const dateLabel = new Date(item.at).toLocaleDateString('en-US', {
    timeZone: tz,
    month: 'short',
    day: 'numeric',
    year: new Date(item.at).getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined,
  });
  const tags = Array.isArray(p.tags) ? (p.tags as string[]) : [];

  return (
    <li className="py-3 border-b border-line/40">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-mono text-[10px] uppercase tracking-wider text-ink-3">
          {KIND_LABEL[item.kind]}
          {meta ? ` · ${meta}` : ''}
        </span>
        <span className="font-mono text-[10px] uppercase tracking-wider text-ink-3">
          {dateLabel}
        </span>
      </div>

      <Link href={href} className="mt-1 block hover:text-accent transition-colors">
        <FeedBody item={item} />
      </Link>

      {tags.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {tags.slice(0, 5).map((t) => (
            <span
              key={t}
              className="px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider border border-line text-ink-3"
            >
              #{t}
            </span>
          ))}
          {tags.length > 5 && (
            <span className="px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-ink-3">
              +{tags.length - 5}
            </span>
          )}
        </div>
      )}
    </li>
  );
}

// Per-kind body rendering. All clamp to 3 lines — the detail page is
// for full reading, this list is for scanning.
function FeedBody({ item }: { item: FeedItem }) {
  const p = item.payload;

  if (item.kind === 'note') {
    const title = typeof p.title === 'string' ? p.title.trim() : '';
    const body = String(p.body ?? '');
    return (
      <>
        {title && (
          <div className="font-serif text-[15px] text-ink leading-tight">{title}</div>
        )}
        <div className="font-sans text-[14px] text-ink leading-snug line-clamp-3">
          {body}
        </div>
      </>
    );
  }

  if (item.kind === 'quote') {
    return (
      <div className="font-serif text-[15px] italic text-ink leading-snug line-clamp-3">
        &ldquo;{String(p.text ?? '')}&rdquo;
      </div>
    );
  }

  if (item.kind === 'annotation') {
    const quote = pickFirst(p.quote as QuoteRel | QuoteRel[] | undefined);
    const quoteText = quote?.text ?? '';
    const snippet = quoteText.length > 80 ? quoteText.slice(0, 80) + '…' : quoteText;
    return (
      <>
        <div className="font-serif text-[13px] italic text-ink-3 leading-snug">
          &ldquo;{snippet}&rdquo;
        </div>
        <div className="mt-1 font-sans text-[14px] text-ink leading-snug line-clamp-3">
          {String(p.body ?? '')}
        </div>
      </>
    );
  }

  // journal
  return (
    <div className="font-sans text-[14px] text-ink leading-snug whitespace-pre-wrap line-clamp-3">
      {String(p.transcription_text ?? '')}
    </div>
  );
}
