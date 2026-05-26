import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ScreenHeader } from '@/components/ScreenHeader';
import { libraryApi, ApiError, type Note, type NoteSourceType } from '@/lib/api';
import { getAppTimezone } from '@/lib/app-settings';
import { EditNoteForm } from './edit-note-form';

// /library/notes/[id] — single-note detail with edit form. Related project,
// person, and quote (if any) surface as small linked breadcrumbs above the
// form so the note's context stays visible while editing.

const SOURCE_TYPE_LABELS: Record<NoteSourceType, string> = {
  own_thought: 'Own thought',
  reading_response: 'Reading response',
  meeting_note: 'Meeting note',
  brainstorm: 'Brainstorm',
  observation: 'Observation',
  other: 'Other',
};

export default async function NoteDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const tz = await getAppTimezone();

  let note: Note | null = null;
  let errorMessage: string | null = null;

  try {
    note = await libraryApi.notes.get(id);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    errorMessage = err instanceof ApiError ? `API ${err.status}` : (err as Error).message;
  }

  if (!note) {
    return (
      <div>
        <ScreenHeader eyebrow="Note" title="—" />
        <div className="hairline" />
        <div className="px-5 lg:px-0 mt-6 font-sans text-[13px] text-ink-3">
          {errorMessage ?? 'Note not found.'}
        </div>
      </div>
    );
  }

  const meta = [
    SOURCE_TYPE_LABELS[note.source_type],
    note.needs_review ? 'needs review' : null,
  ]
    .filter(Boolean)
    .join(' · ');

  // Prefer the explicit title (set on Obsidian imports + manually-edited
  // notes). Fall back to a body preview for voice captures and untitled
  // legacy notes.
  const headerTitle = note.title?.trim()
    ? note.title
    : note.body.length > 80
      ? note.body.slice(0, 80).trimEnd() + '…'
      : note.body;

  return (
    <div>
      <div className="px-5 lg:px-0 pt-4 pb-1 font-mono text-[10px] uppercase tracking-wider text-ink-3">
        <Link href="/library/notes" className="hover:text-ink-2 transition-colors">
          ← Notes
        </Link>
      </div>

      <ScreenHeader
        eyebrow={meta}
        title={headerTitle}
        meta={`Saved ${new Date(note.created_at).toLocaleDateString('en-US', { timeZone: tz, month: 'short', day: 'numeric', year: 'numeric' })}`}
      />
      <div className="hairline mb-6" />

      <div className="px-5 lg:px-0 max-w-2xl">
        {/* Related context — only render if anything attached */}
        {(note.project || note.person || note.quote || note.source_reference) && (
          <div className="mb-6 flex flex-wrap items-center gap-x-3 gap-y-2 font-mono text-[10px] uppercase tracking-wider text-ink-3">
            {note.project && (
              <Link
                href={`/projects/${note.project.id}`}
                className="inline-flex items-center gap-1.5 hover:text-ink transition-colors"
              >
                {note.project.color && (
                  <span
                    className="inline-block w-2 h-2 rounded-full"
                    style={{ backgroundColor: note.project.color }}
                    aria-hidden
                  />
                )}
                Project · {note.project.name}
              </Link>
            )}
            {note.person && (
              <span className="hover:text-ink transition-colors">
                Person · {note.person.name}
              </span>
            )}
            {note.quote && (
              <Link
                href={`/library/quotes/${note.quote.id}`}
                className="hover:text-ink transition-colors max-w-md truncate"
                title={note.quote.text}
              >
                Quote · &ldquo;{note.quote.text.length > 50 ? note.quote.text.slice(0, 50) + '…' : note.quote.text}&rdquo;
              </Link>
            )}
            {note.source_reference && !note.project && !note.person && !note.quote && (
              <span>Source · {note.source_reference}</span>
            )}
          </div>
        )}

        <EditNoteForm
          initial={{
            id: note.id,
            title: note.title ?? '',
            body: note.body,
            source_type: note.source_type,
            source_reference: note.source_reference ?? '',
            tags: note.tags ?? [],
            needs_review: note.needs_review,
            attachments: note.attachments ?? [],
          }}
        />
      </div>
    </div>
  );
}
