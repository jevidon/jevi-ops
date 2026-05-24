import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ScreenHeader } from '@/components/ScreenHeader';
import { libraryApi, ApiError, type JournalEntry } from '@/lib/api';
import { JournalEditForm } from './edit-form';

// /library/journal/[id] — detail + edit + delete. Voice still creates
// journal entries; this page lets you come back to add an image, edit
// the transcription, or change the date.

export default async function JournalEntryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let entry: JournalEntry | null = null;
  let errorMessage: string | null = null;
  try {
    entry = await libraryApi.journal.get(id);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    errorMessage = err instanceof ApiError ? `API ${err.status}` : (err as Error).message;
  }

  if (!entry) {
    return (
      <div>
        <ScreenHeader eyebrow="Journal" title="—" />
        <div className="hairline" />
        <div className="px-5 lg:px-0 mt-6 font-sans text-[13px] text-ink-3">
          {errorMessage ?? 'Journal entry not found.'}
        </div>
      </div>
    );
  }

  const formattedDate = new Date(entry.entry_date + 'T12:00:00Z').toLocaleDateString('en-US', {
    timeZone: 'America/Denver',
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
  const sourceLabel = entry.source !== 'typed' ? `via ${entry.source.replace('_', ' ')}` : null;

  return (
    <div>
      <div className="px-5 lg:px-0 pt-4 pb-1 font-mono text-[10px] uppercase tracking-wider text-ink-3">
        <Link href="/library/journal" className="hover:text-ink-2 transition-colors">
          ← Journal
        </Link>
      </div>

      <ScreenHeader
        eyebrow={sourceLabel ? `Journal · ${sourceLabel}` : 'Journal'}
        title={formattedDate}
      />
      <div className="hairline mb-6" />

      <div className="px-5 lg:px-0">
        <JournalEditForm
          initial={{
            id: entry.id,
            entry_date: entry.entry_date,
            transcription_text: entry.transcription_text ?? '',
            attachments: entry.attachments ?? [],
          }}
        />
      </div>
    </div>
  );
}
