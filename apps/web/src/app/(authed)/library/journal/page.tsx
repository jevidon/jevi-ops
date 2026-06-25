import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ScreenHeader } from '@/components/ScreenHeader';
import { libraryApi, ApiError, type JournalEntry } from '@/lib/api';
import { getAppTimezone } from '@/lib/app-settings';
import { LibraryTabBar } from '../library-tab-bar';
import { PrefsPersist } from '@/components/PrefsPersist';

type ResurfaceFilter = 'boosted' | 'excluded' | null;

export default async function JournalListPage({
  searchParams,
}: {
  searchParams: Promise<{ resurface?: string }>;
}) {
  const tz = await getAppTimezone();
  const params = await searchParams;

  // Cookie restore — matches /library/notes and /library/quotes.
  if (params.resurface === undefined) {
    const jar = await cookies();
    const savedResurface = jar.get('journal_resurface')?.value;
    if (savedResurface === 'boosted' || savedResurface === 'excluded') {
      redirect(`/library/journal?resurface=${savedResurface}`);
    }
  }

  const resurfaceFilter: ResurfaceFilter =
    params.resurface === 'boosted' || params.resurface === 'excluded' ? params.resurface : null;

  let entries: JournalEntry[] = [];
  let errorMessage: string | null = null;
  try {
    const opts: { resurface?: 'boosted' | 'excluded' } = {};
    if (resurfaceFilter) opts.resurface = resurfaceFilter;
    entries = (await libraryApi.journal.list(opts)).entries;
  } catch (err) {
    errorMessage = err instanceof ApiError ? `API ${err.status}` : (err as Error).message;
  }

  const buildHref = (overrides: { resurface?: ResurfaceFilter }) => {
    const qs = new URLSearchParams();
    const rs = overrides.resurface === undefined ? resurfaceFilter : overrides.resurface;
    if (rs) qs.set('resurface', rs);
    const str = qs.toString();
    return str ? `/library/journal?${str}` : '/library/journal';
  };

  return (
    <div>
      <PrefsPersist cookiePrefix="journal" paramNames={['resurface']} />
      <ScreenHeader eyebrow="Library" title="Journal" meta={`${entries.length} entries`} />
      <div className="hairline" />
      <LibraryTabBar active="journal" />

      <div className="px-5 lg:px-0 pt-3 flex justify-end">
        <Link
          href="/library/journal/new"
          className="font-mono text-[11px] uppercase tracking-wider text-ink-3 hover:text-accent transition-colors"
        >
          + New entry
        </Link>
      </div>

      <div className="px-5 lg:px-0 pt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
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

      {errorMessage ? (
        <div className="px-5 lg:px-0 mt-6 font-sans text-[13px] text-ink-3">Error: {errorMessage}</div>
      ) : entries.length === 0 ? (
        <div className="px-5 lg:px-0 mt-6 font-sans text-[13px] text-ink-3 italic">
          {resurfaceFilter
            ? `No journal entries match the ${resurfaceFilter} filter.`
            : 'No journal entries yet. Voice command: “Journal entry for today: ...”'}
        </div>
      ) : (
        <ul className="px-5 lg:px-0 mt-4">
          {entries.map((e) => {
            const attachmentCount = (e.attachments ?? []).length;
            return (
              <li key={e.id} className="py-4 border-b border-line/40">
                <Link href={`/library/journal/${e.id}`} className="block hover:opacity-80 transition-opacity">
                  <div className="font-mono text-[10px] uppercase tracking-wider text-ink-3 flex flex-wrap gap-x-3">
                    <span>
                      {new Date(e.entry_date + 'T12:00:00Z').toLocaleDateString('en-US', {
                        timeZone: tz,
                        weekday: 'long',
                        month: 'long',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                    </span>
                    {e.source !== 'typed' && <span>via {e.source.replace('_', ' ')}</span>}
                    {/* Photo-attached indicator. Glyph only — no <img>
                        means the list view never triggers a CDN fetch. */}
                    {attachmentCount > 0 && (
                      <span title={`${attachmentCount} image${attachmentCount === 1 ? '' : 's'} attached`}>
                        📷 {attachmentCount} image{attachmentCount === 1 ? '' : 's'}
                      </span>
                    )}
                  </div>
                  <div className="mt-1 font-sans text-[14px] text-ink leading-snug whitespace-pre-wrap line-clamp-3">
                    {e.transcription_text}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
