import Link from 'next/link';
import { ScreenHeader } from '@/components/ScreenHeader';
import { libraryApi, ApiError, type JournalEntry } from '@/lib/api';
import { getAppTimezone } from '@/lib/app-settings';
import { LibraryTabBar } from '../library-tab-bar';

export default async function JournalListPage() {
  const tz = await getAppTimezone();
  let entries: JournalEntry[] = [];
  let errorMessage: string | null = null;
  try {
    entries = (await libraryApi.journal.list()).entries;
  } catch (err) {
    errorMessage = err instanceof ApiError ? `API ${err.status}` : (err as Error).message;
  }

  return (
    <div>
      <ScreenHeader eyebrow="Library" title="Journal" meta={`${entries.length} entries`} />
      <div className="hairline" />
      <LibraryTabBar active="journal" />

      {errorMessage ? (
        <div className="px-5 lg:px-0 mt-6 font-sans text-[13px] text-ink-3">Error: {errorMessage}</div>
      ) : entries.length === 0 ? (
        <div className="px-5 lg:px-0 mt-6 font-sans text-[13px] text-ink-3 italic">
          No journal entries yet. Voice command: &ldquo;Journal entry for today: ...&rdquo;
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
