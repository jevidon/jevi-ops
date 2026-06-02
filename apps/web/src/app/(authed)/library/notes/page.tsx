import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ScreenHeader } from '@/components/ScreenHeader';
import { libraryApi, ApiError, type Note, type NoteSourceType, type TagAggregate } from '@/lib/api';
import { getAppTimezone } from '@/lib/app-settings';
import { LibraryTabBar } from '../library-tab-bar';
import { PrefsPersist } from '@/components/PrefsPersist';
import { TagCloud } from '../tag-cloud';

const SOURCE_TYPE_LABELS: Record<NoteSourceType, string> = {
  own_thought: 'Own thought',
  reading_response: 'Reading response',
  meeting_note: 'Meeting note',
  brainstorm: 'Brainstorm',
  observation: 'Observation',
  other: 'Other',
};

const SOURCE_TYPE_FILTERS: Array<{ value: NoteSourceType | 'all'; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'own_thought', label: 'Own' },
  { value: 'reading_response', label: 'Reading' },
  { value: 'meeting_note', label: 'Meeting' },
  { value: 'brainstorm', label: 'Brainstorm' },
  { value: 'observation', label: 'Observation' },
];

type ResurfaceFilter = 'boosted' | 'excluded' | null;

export default async function NotesPage({
  searchParams,
}: {
  searchParams: Promise<{ source_type?: string; needs_review?: string; tag?: string; resurface?: string }>;
}) {
  const params = await searchParams;
  const tz = await getAppTimezone();

  // Restore last-used filter from cookies if the URL has no params. Same
  // pattern as /library/books — written by <PrefsPersist /> below.
  if (
    params.source_type === undefined &&
    params.needs_review === undefined &&
    params.tag === undefined &&
    params.resurface === undefined
  ) {
    const jar = await cookies();
    const savedSourceType = jar.get('notes_source_type')?.value;
    const savedNeedsReview = jar.get('notes_needs_review')?.value;
    const savedTag = jar.get('notes_tag')?.value;
    const savedResurface = jar.get('notes_resurface')?.value;
    const validSavedSourceType = savedSourceType && SOURCE_TYPE_FILTERS.find((f) => f.value === savedSourceType)
      ? savedSourceType
      : undefined;
    const qs = new URLSearchParams();
    if (validSavedSourceType && validSavedSourceType !== 'all') qs.set('source_type', validSavedSourceType);
    if (savedNeedsReview === 'true') qs.set('needs_review', 'true');
    if (savedTag) qs.set('tag', savedTag);
    if (savedResurface === 'boosted' || savedResurface === 'excluded') {
      qs.set('resurface', savedResurface);
    }
    if (qs.toString()) redirect(`/library/notes?${qs.toString()}`);
  }

  const filter = (
    params.source_type && SOURCE_TYPE_FILTERS.find((f) => f.value === params.source_type)
      ? params.source_type
      : 'all'
  ) as NoteSourceType | 'all';
  const needsReviewOnly = params.needs_review === 'true';
  const tagFilter = params.tag?.trim() || null;
  const resurfaceFilter: ResurfaceFilter =
    params.resurface === 'boosted' || params.resurface === 'excluded' ? params.resurface : null;

  // Fetch notes + tag aggregates in parallel. The tag cloud doesn't change
  // when the source_type filter changes — we want to surface all tags
  // regardless of the active source filter so the user can broaden their
  // selection in one click rather than having to clear filters first.
  let notes: Note[] = [];
  let tagAggregates: TagAggregate[] = [];
  let errorMessage: string | null = null;
  try {
    const opts: { source_type?: string; needs_review?: boolean; tag?: string; resurface?: 'boosted' | 'excluded' } = {};
    if (filter !== 'all') opts.source_type = filter;
    if (needsReviewOnly) opts.needs_review = true;
    if (tagFilter) opts.tag = tagFilter;
    if (resurfaceFilter) opts.resurface = resurfaceFilter;
    const [notesRes, tagsRes] = await Promise.all([
      libraryApi.notes.list(opts),
      libraryApi.tags(),
    ]);
    notes = notesRes.notes;
    tagAggregates = tagsRes.tags;
  } catch (err) {
    errorMessage = err instanceof ApiError ? `API ${err.status}` : (err as Error).message;
  }

  const buildHref = (overrides: {
    source_type?: string;
    needs_review?: boolean;
    tag?: string | null;
    resurface?: ResurfaceFilter;
  }) => {
    const params = new URLSearchParams();
    const st = overrides.source_type ?? (filter === 'all' ? undefined : filter);
    if (st) params.set('source_type', st);
    const nr = overrides.needs_review ?? needsReviewOnly;
    if (nr) params.set('needs_review', 'true');
    // null = explicit clear; undefined = inherit current.
    const tg = overrides.tag === undefined ? tagFilter : overrides.tag;
    if (tg) params.set('tag', tg);
    const rs = overrides.resurface === undefined ? resurfaceFilter : overrides.resurface;
    if (rs) params.set('resurface', rs);
    const qs = params.toString();
    return qs ? `/library/notes?${qs}` : '/library/notes';
  };

  return (
    <div>
      <PrefsPersist cookiePrefix="notes" paramNames={['source_type', 'needs_review', 'tag', 'resurface']} />
      <ScreenHeader eyebrow="Library" title="Notes" meta={`${notes.length} entries`} />
      <div className="hairline" />

      <LibraryTabBar active="notes" />

      {/* Filter chips */}
      <div className="px-5 lg:px-0 pt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="eyebrow">Source</span>
        <div className="flex flex-wrap gap-1.5">
          {SOURCE_TYPE_FILTERS.map((f) => (
            <Link
              key={f.value}
              href={buildHref({ source_type: f.value === 'all' ? undefined : f.value })}
              className={`px-2.5 py-1 border font-mono text-[10px] uppercase tracking-wider transition-colors ${
                filter === f.value
                  ? 'bg-ink text-bg border-ink'
                  : 'border-line text-ink-2 hover:border-ink-2 hover:text-ink'
              }`}
            >
              {f.label}
            </Link>
          ))}
        </div>
        <Link
          href={buildHref({ needs_review: !needsReviewOnly })}
          className={`px-2.5 py-1 border font-mono text-[10px] uppercase tracking-wider transition-colors ${
            needsReviewOnly
              ? 'bg-accent text-bg border-accent'
              : 'border-line text-ink-2 hover:border-ink-2 hover:text-ink'
          }`}
        >
          {needsReviewOnly ? '✓ Needs review' : 'Needs review'}
        </Link>
        {/* Resurface filter — toggles between off / boosted / excluded.
            Three states so a single chip can both filter to weight > 1
            ("show me everything I've starred") and weight = 0 ("show me
            what I've hidden from rotation") without needing two chips. */}
        <Link
          href={buildHref({
            resurface:
              resurfaceFilter === null ? 'boosted' : resurfaceFilter === 'boosted' ? 'excluded' : null,
          })}
          className={`px-2.5 py-1 border font-mono text-[10px] uppercase tracking-wider transition-colors ${
            resurfaceFilter === 'boosted'
              ? 'bg-accent text-bg border-accent'
              : resurfaceFilter === 'excluded'
                ? 'bg-ink text-bg border-ink'
                : 'border-line text-ink-2 hover:border-ink-2 hover:text-ink'
          }`}
          title="Click to cycle: off → boosted → excluded → off"
        >
          {resurfaceFilter === 'boosted'
            ? '★ Boosted'
            : resurfaceFilter === 'excluded'
              ? '✕ Excluded'
              : 'Resurface'}
        </Link>
      </div>

      {tagAggregates.length > 0 && (
        <div className="px-5 lg:px-0 pt-2">
          <TagCloud
            tags={tagAggregates}
            selectedTag={tagFilter}
            source="notes"
            buildHref={(tag) => buildHref({ tag: tag ?? null })}
          />
        </div>
      )}

      {errorMessage ? (
        <div className="px-5 lg:px-0 mt-6 font-sans text-[13px] text-ink-3">Error: {errorMessage}</div>
      ) : notes.length === 0 ? (
        <div className="px-5 lg:px-0 mt-6 font-sans text-[13px] text-ink-3 italic">
          No notes match these filters.
        </div>
      ) : (
        <ul className="px-5 lg:px-0 mt-4">
          {notes.map((n) => {
            const attachmentCount = (n.attachments ?? []).length;
            return (
            <li key={n.id} className="py-3 border-b border-line/40">
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-mono text-[10px] uppercase tracking-wider text-ink-3">
                  {SOURCE_TYPE_LABELS[n.source_type]}
                  {n.source_reference ? ` · ${n.source_reference}` : ''}
                  {n.needs_review ? ' · needs review' : ''}
                  {/* Photo-attached indicator. Glyph only — no <img>
                      so the list view never triggers a CDN fetch. */}
                  {attachmentCount > 0 && (
                    <span
                      title={`${attachmentCount} image${attachmentCount === 1 ? '' : 's'} attached`}
                      aria-label={`${attachmentCount} image${attachmentCount === 1 ? '' : 's'} attached`}
                    >
                      {' · 📷'}{attachmentCount > 1 ? ` ${attachmentCount}` : ''}
                    </span>
                  )}
                </span>
                <span className="font-mono text-[10px] uppercase tracking-wider text-ink-3">
                  {new Date(n.created_at).toLocaleDateString('en-US', { timeZone: tz, month: 'short', day: 'numeric' })}
                </span>
              </div>
              <Link
                href={`/library/notes/${n.id}`}
                className="mt-1 block hover:text-accent transition-colors"
              >
                {n.title?.trim() && (
                  <div className="font-serif text-[15px] text-ink leading-tight">
                    {n.title}
                  </div>
                )}
                <div className="font-sans text-[14px] text-ink leading-snug line-clamp-3">
                  {n.body}
                </div>
              </Link>
              {n.tags && n.tags.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {n.tags.slice(0, 5).map((t) => (
                    <Link
                      key={t}
                      // Clicking a row tag swaps the active tag filter to that
                      // tag — a one-click "show me everything else with this".
                      href={buildHref({ tag: t })}
                      className={`px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider border transition-colors ${
                        tagFilter === t
                          ? 'bg-ink text-bg border-ink'
                          : 'border-line text-ink-3 hover:text-ink hover:border-ink-2'
                      }`}
                    >
                      #{t}
                    </Link>
                  ))}
                  {n.tags.length > 5 && (
                    <span className="px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-ink-3">
                      +{n.tags.length - 5}
                    </span>
                  )}
                </div>
              )}
            </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
