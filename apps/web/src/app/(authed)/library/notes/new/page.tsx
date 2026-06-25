import Link from 'next/link';
import { ScreenHeader } from '@/components/ScreenHeader';
import { NewNoteForm } from './new-note-form';
import type { NoteSourceType } from '@/lib/api';

// /library/notes/new — manual note entry. Mirrors /library/quotes/new
// in shape. Voice (cmd+J) capture still works; this is the explicit
// form path when you'd rather type into fields than dictate.

const VALID_SOURCE_TYPES: NoteSourceType[] = [
  'own_thought', 'reading_response', 'meeting_note',
  'brainstorm', 'observation', 'other',
];

export default async function NewNotePage({
  searchParams,
}: {
  searchParams: Promise<{ source_type?: string }>;
}) {
  const { source_type: preSourceType } = await searchParams;
  const defaultSourceType = preSourceType && (VALID_SOURCE_TYPES as string[]).includes(preSourceType)
    ? (preSourceType as NoteSourceType)
    : 'own_thought';

  return (
    <div>
      <div className="px-5 lg:px-0 pt-4 pb-1 font-mono text-[10px] uppercase tracking-wider text-ink-3">
        <Link href="/library/notes" className="hover:text-ink-2 transition-colors">
          ← Notes
        </Link>
      </div>

      <ScreenHeader eyebrow="Capture" title="New note" meta="Full editor" />
      <div className="hairline mb-4" />

      <div className="px-5 lg:px-0 max-w-2xl">
        <NewNoteForm defaultSourceType={defaultSourceType} />
      </div>
    </div>
  );
}
