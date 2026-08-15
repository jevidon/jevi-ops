import type { Note, Quote, JournalEntry, Book, Attachment } from '@/lib/api';

// Library data layer (v2 redesign, Jul 2026). Pure, server-safe helpers shared
// by the /library server shell and the client LibraryView. The unified page
// merges the three "entry" kinds (notes, quotes, journal) into one normalized
// LibEntry[] so the masonry grid + facets can treat them uniformly; books keep
// their own typed shape and cover grid. Every field the facet rail filters on
// is carried here (source, tags, needs-review) — the merged feed endpoint drops
// those, which is why the page fetches the typed lists instead.

export type LibKind = 'note' | 'quote' | 'journal';
export type LibType = 'all' | LibKind | 'book' | 'inventory';

export const LIB_TYPES: { value: LibType; label: string }[] = [
  { value: 'all', label: 'Everything' },
  { value: 'note', label: 'Notes' },
  { value: 'quote', label: 'Quotes' },
  { value: 'journal', label: 'Journal' },
  { value: 'book', label: 'Books' },
  { value: 'inventory', label: 'Inventory' },
];

export function normalizeType(v: string | undefined): LibType {
  const hit = LIB_TYPES.find((t) => t.value === v);
  return hit ? hit.value : 'all';
}

// One normalized entry across the three entry kinds. `source` is the kind's own
// vocabulary (note.source_type | quote.source_type | null for journal); dates
// are precomputed server-side so the client stays tz-free.
export interface LibEntry {
  kind: LibKind;
  id: string;
  sortAt: string; // desc sort key (ISO-ish)
  dateLabel: string; // precomputed display date
  title: string | null;
  body: string;
  source: string | null;
  who: string | null; // quote.source_author — the quote card's kicker
  book: string | null; // quote.book?.title
  tags: string[];
  needsReview: boolean; // notes only
  image: string | null; // first image attachment — the card hero
  photoCount: number; // image attachments, for the badge
  href: string;
}

// First image attachment (notes + journal carry attachments; quotes don't).
// The upload flow only ever stores images, but we filter on content_type
// defensively so a stray non-image can't become a broken hero.
function pickImages(atts: Attachment[] | undefined): { image: string | null; count: number } {
  const imgs = (atts ?? []).filter((a) => a.url && (!a.content_type || a.content_type.startsWith('image')));
  return { image: imgs[0]?.url ?? null, count: imgs.length };
}

// ─── Source vocabularies (label + canonical order) ───────────────────────────
// Facet rows are derived from the values actually present in scope, so a chip
// can never return zero. `other` is included here even though the old note
// filter hid it — deriving from data means it only shows when such rows exist.

export const NOTE_SOURCE_ORDER = [
  'own_thought', 'reading_response', 'meeting_note', 'brainstorm', 'observation', 'other',
];
export const NOTE_SOURCE_LABEL: Record<string, string> = {
  own_thought: 'Own',
  reading_response: 'Reading',
  meeting_note: 'Meeting',
  brainstorm: 'Brainstorm',
  observation: 'Observation',
  other: 'Other',
};

export const QUOTE_SOURCE_ORDER = [
  'book', 'article', 'podcast', 'sermon', 'video', 'conversation', 'other',
];
export const QUOTE_SOURCE_LABEL: Record<string, string> = {
  book: 'Book',
  article: 'Article',
  podcast: 'Podcast',
  sermon: 'Sermon',
  video: 'Video',
  conversation: 'Conversation',
  other: 'Other',
};

// ─── Books ───────────────────────────────────────────────────────────────────

export const BOOK_STATUS_ORDER: Book['status'][] = [
  'want_to_read', 'reading', 'finished', 'abandoned',
];
export const BOOK_STATUS_LABEL: Record<Book['status'], string> = {
  want_to_read: 'Want',
  reading: 'Reading',
  finished: 'Finished',
  abandoned: 'Abandoned',
};
// Book status → the four urgency pill states (a finished book "on track", an
// abandoned one "over"). Not literal urgency — just the palette.
export const BOOK_STATUS_PILL: Record<Book['status'], 'over' | 'due' | 'ok' | 'quiet'> = {
  want_to_read: 'quiet',
  reading: 'due',
  finished: 'ok',
  abandoned: 'over',
};

export type BookSortKey = 'title' | 'author' | 'finished_desc' | 'rating_desc' | 'recent';
export const BOOK_SORTS: { value: BookSortKey; label: string }[] = [
  { value: 'title', label: 'Title' },
  { value: 'author', label: 'Author' },
  { value: 'finished_desc', label: 'Finished' },
  { value: 'rating_desc', label: 'Rating' },
  { value: 'recent', label: 'Recent' },
];

function surnameKey(name: string): string {
  const parts = name.trim().split(/\s+/);
  return (parts[parts.length - 1] || name).toLowerCase();
}

// Exact port of books/page.tsx sortBooks: nulls sink to the bottom, title
// breaks every tie.
export function sortBooks(a: Book, b: Book, key: BookSortKey): number {
  switch (key) {
    case 'title':
      return a.title.localeCompare(b.title);
    case 'author': {
      const aa = (a.author ?? '').trim();
      const bb = (b.author ?? '').trim();
      if (!aa && !bb) return a.title.localeCompare(b.title);
      if (!aa) return 1;
      if (!bb) return -1;
      return surnameKey(aa).localeCompare(surnameKey(bb)) || a.title.localeCompare(b.title);
    }
    case 'finished_desc': {
      const aa = a.finished_at ?? '';
      const bb = b.finished_at ?? '';
      if (!aa && !bb) return a.title.localeCompare(b.title);
      if (!aa) return 1;
      if (!bb) return -1;
      return bb.localeCompare(aa);
    }
    case 'rating_desc': {
      const aa = a.rating ?? -1;
      const bb = b.rating ?? -1;
      if (aa === bb) return a.title.localeCompare(b.title);
      return bb - aa;
    }
    case 'recent':
      return b.created_at.localeCompare(a.created_at);
    default:
      return 0;
  }
}

// The sort-dependent badge on a book card: stars when sorting by rating, the
// finished month (YYYY-MM) when sorting by finished, otherwise nothing.
export function bookBadge(b: Book, sort: BookSortKey): string | null {
  if (sort === 'rating_desc' && b.rating) return '★'.repeat(b.rating);
  if (sort === 'finished_desc' && b.finished_at) return b.finished_at.slice(0, 7);
  return null;
}

// A muted, deterministic cover tint for books with no cover image — keeps the
// shelf from being a wall of identical grey tiles. Paper-adjacent hues only.
const COVER_TINTS: { bg: string; fg: string }[] = [
  { bg: '#2F5D8A', fg: '#EAF1F8' },
  { bg: '#6B5B95', fg: '#F0ECF6' },
  { bg: '#3B6A52', fg: '#E9F2ED' },
  { bg: '#A8763E', fg: '#F8EFE3' },
  { bg: '#8A4B3C', fg: '#F7EAE5' },
  { bg: '#4A6B70', fg: '#E9F1F2' },
  { bg: '#8A6A2F', fg: '#F6EEDE' },
];
export function coverTint(title: string): { bg: string; fg: string } {
  let h = 0;
  for (let i = 0; i < title.length; i++) h = (h * 31 + title.charCodeAt(i)) >>> 0;
  return COVER_TINTS[h % COVER_TINTS.length] ?? COVER_TINTS[0]!;
}

// ─── Date labels (tz-correct) ────────────────────────────────────────────────

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// timestamptz → app-tz calendar date, year dropped when it's the current year.
function tsDateLabel(iso: string, tz: string, curYear: number): string {
  const dt = new Date(iso);
  const y = Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric' }).format(dt));
  const md = new Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'short', day: 'numeric' }).format(dt);
  return y === curYear ? md : `${md}, ${y}`;
}

// A bare YYYY-MM-DD (journal entry_date is the user-attributed day) formatted
// WITHOUT tz conversion — parsing it as an instant then shifting timezone is the
// classic off-by-one that put journal entries on the wrong day.
function dateOnlyLabel(ymd: string, curYear: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const md = `${MONTHS[(m || 1) - 1]} ${d}`;
  return y === curYear ? md : `${md}, ${y}`;
}

// Merge the three typed lists into one normalized, newest-first LibEntry[].
export function buildEntries(
  notes: Note[],
  quotes: Quote[],
  journal: JournalEntry[],
  opts: { tz: string; todayIso: string },
): LibEntry[] {
  const { tz, todayIso } = opts;
  const curYear = Number(todayIso.slice(0, 4));
  const out: LibEntry[] = [];

  for (const n of notes) {
    const { image, count } = pickImages(n.attachments);
    out.push({
      kind: 'note',
      id: n.id,
      sortAt: n.created_at,
      dateLabel: tsDateLabel(n.created_at, tz, curYear),
      title: n.title,
      body: n.body,
      source: n.source_type ?? null,
      who: null,
      book: null,
      tags: n.tags ?? [],
      needsReview: !!n.needs_review,
      image,
      photoCount: count,
      href: `/library/notes/${n.id}`,
    });
  }
  for (const q of quotes) {
    out.push({
      kind: 'quote',
      id: q.id,
      sortAt: q.created_at,
      dateLabel: tsDateLabel(q.created_at, tz, curYear),
      title: null,
      body: q.text,
      source: q.source_type ?? null,
      who: q.source_author ?? null,
      book: q.book?.title ?? null,
      tags: q.tags ?? [],
      needsReview: false,
      image: null,
      photoCount: 0,
      href: `/library/quotes/${q.id}`,
    });
  }
  for (const j of journal) {
    const { image, count } = pickImages(j.attachments);
    // Pin journal to noon of its attributed day so it interleaves sensibly with
    // the timestamped kinds without a tz shift moving it off that day.
    out.push({
      kind: 'journal',
      id: j.id,
      sortAt: `${j.entry_date}T12:00:00.000Z`,
      dateLabel: dateOnlyLabel(j.entry_date, curYear),
      title: null,
      body: j.transcription_text ?? '',
      source: null,
      who: null,
      book: null,
      tags: [],
      needsReview: false,
      image,
      photoCount: count,
      href: `/library/journal/${j.id}`,
    });
  }

  out.sort((a, b) => b.sortAt.localeCompare(a.sortAt));
  return out;
}
