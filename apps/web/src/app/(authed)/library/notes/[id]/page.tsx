import Link from 'next/link';
import { notFound } from 'next/navigation';
import { libraryApi, ApiError, type Note, type NoteSourceType } from '@/lib/api';
import { getAppTimezone } from '@/lib/app-settings';
import { PhotoGallery } from '@/components/PhotoGallery';
import { EditDrawer } from '@/components/detail/EditDrawer';
import { PinButton } from '@/components/PinButton';
import { BoostButton } from '@/components/BoostButton';
import { EditNoteForm } from './edit-note-form';

// /library/notes/[id] — note reader (Detail Pages v2, Addendum 10 §10). Body is
// the serif hero, source-type is a quiet chip, attached images inherit the
// journal's photo treatment, and the related links + resurface + edit retreat
// to a quiet footer.

const SOURCE_TYPE_LABELS: Record<NoteSourceType, string> = {
  own_thought: 'Own thought',
  reading_response: 'Reading response',
  meeting_note: 'Meeting note',
  brainstorm: 'Brainstorm',
  observation: 'Observation',
  other: 'Other',
};

export default async function NoteDetailPage({ params }: { params: Promise<{ id: string }> }) {
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
      <div className="mx-auto max-w-2xl px-5 lg:px-8 pt-10">
        <h1 className="font-serif text-[32px] font-medium tracking-[-0.02em] text-ink">—</h1>
        <p className="mt-4 font-sans text-[13px] text-ink-3">{errorMessage ?? 'Note not found.'}</p>
      </div>
    );
  }

  const title = note.title?.trim() ?? '';
  const savedLabel = new Date(note.created_at).toLocaleDateString('en-US', { timeZone: tz, month: 'short', day: 'numeric', year: 'numeric' });
  const hasRelated = Boolean(note.project || note.person || note.quote || note.source_reference);

  return (
    <div className="mx-auto max-w-2xl px-5 lg:px-8 pt-4 pb-24">
      <div className="pb-1 font-mono text-[10px] uppercase tracking-wider text-ink-3">
        <Link href="/library/notes" className="hover:text-ink-2 transition-colors">← Notes</Link>
      </div>

      <header className="mt-2">
        <div className="font-mono text-[10px] uppercase tracking-[0.11em] text-ink-3">
          {SOURCE_TYPE_LABELS[note.source_type]}
          {note.needs_review && <span className="text-warn"> · needs review</span>}
          <span className="text-ink-4"> · saved {savedLabel}</span>
        </div>
        {title && (
          <h1 className="mt-2 font-serif text-[30px] leading-[1.1] tracking-[-0.02em] font-medium text-ink text-balance">{title}</h1>
        )}
      </header>

      <div className={`${title ? 'mt-6 text-[18px]' : 'mt-6 text-[20px]'} font-serif leading-[1.62] text-ink-2 whitespace-pre-wrap`}>
        {note.body}
      </div>

      {note.attachments.length > 0 && (
        <div className="mt-8 -mx-5 lg:mx-0">
          <PhotoGallery attachments={note.attachments} />
        </div>
      )}

      <footer className="mt-12 pt-5 border-t border-line flex flex-col gap-4">
        {hasRelated && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 font-mono text-[10px] uppercase tracking-wider text-ink-3">
            {note.project && (
              <Link href={`/projects/${note.project.id}`} className="inline-flex items-center gap-1.5 hover:text-accent transition-colors">
                {note.project.color && <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: note.project.color }} aria-hidden />}
                Project · {note.project.name}
              </Link>
            )}
            {note.person && <span>Person · {note.person.name}</span>}
            {note.quote && (
              <Link href={`/library/quotes/${note.quote.id}`} className="hover:text-accent transition-colors max-w-md truncate" title={note.quote.text}>
                Quote · &ldquo;{note.quote.text.length > 50 ? note.quote.text.slice(0, 50) + '…' : note.quote.text}&rdquo;
              </Link>
            )}
            {note.source_reference && !note.project && !note.person && !note.quote && <span>Source · {note.source_reference}</span>}
          </div>
        )}

        {note.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {note.tags.map((t) => (
              <span key={t} className="px-2 py-0.5 border border-line font-mono text-[10px] uppercase tracking-wider text-ink-3">{t}</span>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <span className="eyebrow">Resurfacing</span>
            <BoostButton kind="note" id={note.id} weight={note.resurface_weight} />
          </div>
          <div className="flex items-center gap-3">
          <PinButton targetType="note" targetId={note.id} path={`/library/notes/${note.id}`} />
          <EditDrawer title="Edit note" triggerVariant="quiet">
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
          </EditDrawer>
          </div>
        </div>
      </footer>
    </div>
  );
}
