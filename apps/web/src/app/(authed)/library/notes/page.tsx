import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ScreenHeader } from '@/components/ScreenHeader';
import { libraryApi, ApiError, type Note, type NoteSourceType } from '@/lib/api';
import { LibraryTabBar } from '../library-tab-bar';
import { PrefsPersist } from '@/components/PrefsPersist';

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

export default async function NotesPage({
  searchParams,
}: {
  searchParams: Promise<{ source_type?: string; needs_review?: string }>;
}) {
  const params = await searchParams;

  // Restore last-used filter from cookies if the URL has no params. Same
  // pattern as /library/books — written by <PrefsPersist /> below.
  if (params.source_type === undefined && params.needs_review === undefined) {
    const jar = await cookies();
    const savedSourceType = jar.get('notes_source_type')?.value;
    const savedNeedsReview = jar.get('notes_needs_review')?.value;
    const validSavedSourceType = savedSourceType && SOURCE_TYPE_FILTERS.find((f) => f.value === savedSourceType)
      ? savedSourceType
      : undefined;
    const qs = new URLSearchParams();
    if (validSavedSourceType && validSavedSourceType !== 'all') qs.set('source_type', validSavedSourceType);
    if (savedNeedsReview === 'true') qs.set('needs_review', 'true');
    if (qs.toString()) redirect(`/library/notes?${qs.toString()}`);
  }

  const filter = (
    params.source_type && SOURCE_TYPE_FILTERS.find((f) => f.value === params.source_type)
      ? params.source_type
      : 'all'
  ) as NoteSourceType | 'all';
  const needsReviewOnly = params.needs_review === 'true';

  let notes: Note[] = [];
  let errorMessage: string | null = null;
  try {
    const opts: { source_type?: string; needs_review?: boolean } = {};
    if (filter !== 'all') opts.source_type = filter;
    if (needsReviewOnly) opts.needs_review = true;
    notes = (await libraryApi.notes.list(opts)).notes;
  } catch (err) {
    errorMessage = err instanceof ApiError ? `API ${err.status}` : (err as Error).message;
  }

  const buildHref = (overrides: { source_type?: string; needs_review?: boolean }) => {
    const params = new URLSearchParams();
    const st = overrides.source_type ?? (filter === 'all' ? undefined : filter);
    if (st) params.set('source_type', st);
    const nr = overrides.needs_review ?? needsReviewOnly;
    if (nr) params.set('needs_review', 'true');
    const qs = params.toString();
    return qs ? `/library/notes?${qs}` : '/library/notes';
  };

  return (
    <div>
      <PrefsPersist cookiePrefix="notes" paramNames={['source_type', 'needs_review']} />
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
      </div>

      {errorMessage ? (
        <div className="px-5 lg:px-0 mt-6 font-sans text-[13px] text-ink-3">Error: {errorMessage}</div>
      ) : notes.length === 0 ? (
        <div className="px-5 lg:px-0 mt-6 font-sans text-[13px] text-ink-3 italic">
          No notes match these filters.
        </div>
      ) : (
        <ul className="px-5 lg:px-0 mt-4">
          {notes.map((n) => (
            <li key={n.id} className="py-3 border-b border-line/40">
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-mono text-[10px] uppercase tracking-wider text-ink-3">
                  {SOURCE_TYPE_LABELS[n.source_type]}
                  {n.source_reference ? ` · ${n.source_reference}` : ''}
                  {n.needs_review ? ' · needs review' : ''}
                </span>
                <span className="font-mono text-[10px] uppercase tracking-wider text-ink-3">
                  {new Date(n.created_at).toLocaleDateString('en-US', { timeZone: 'America/Denver', month: 'short', day: 'numeric' })}
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
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
