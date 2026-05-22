import { ScreenHeader } from '@/components/ScreenHeader';
import { libraryApi, ApiError, type JournalEntry } from '@/lib/api';
import { LibraryTabBar } from '../library-tab-bar';

export default async function JournalListPage() {
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
          {entries.map((e) => (
            <li key={e.id} className="py-4 border-b border-line/40">
              <div className="font-mono text-[10px] uppercase tracking-wider text-ink-3">
                {new Date(e.entry_date + 'T12:00:00Z').toLocaleDateString('en-US', {
                  timeZone: 'America/Denver',
                  weekday: 'long',
                  month: 'long',
                  day: 'numeric',
                  year: 'numeric',
                })}
                {e.source !== 'typed' && ` · via ${e.source.replace('_', ' ')}`}
              </div>
              <div className="mt-1 font-sans text-[14px] text-ink leading-snug whitespace-pre-wrap">
                {e.transcription_text}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
