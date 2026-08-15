import Link from 'next/link';
import { notFound } from 'next/navigation';
import { libraryApi, ApiError, type JournalEntryDetail, type JournalNeighbor } from '@/lib/api';
import { getAppTimezone } from '@/lib/app-settings';
import { PhotoGallery } from '@/components/PhotoGallery';
import { EditDrawer } from '@/components/detail/EditDrawer';
import { BoostButton } from '@/components/BoostButton';
import { JournalEditForm } from './edit-form';

// /library/journal/[id] — journal reader (Detail Pages v2, Addendum 10 §10).
// A different job from the operational pages: no stat strip, no state chip. The
// date is the title, the entry is the serif prose hero, photos are large and
// composed (PhotoGallery + lightbox), and prev/next-day nav lets it page like a
// journal. Resurfacing sits in a quiet footer; edit + delete live behind Edit.

export default async function JournalEntryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tz = await getAppTimezone();

  let detail: JournalEntryDetail | null = null;
  let errorMessage: string | null = null;
  try {
    detail = await libraryApi.journal.get(id);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    errorMessage = err instanceof ApiError ? `API ${err.status}` : (err as Error).message;
  }

  if (!detail) {
    return (
      <div className="mx-auto max-w-2xl px-5 lg:px-8 pt-10">
        <h1 className="font-serif text-[32px] font-medium tracking-[-0.02em] text-ink">—</h1>
        <p className="mt-4 font-sans text-[13px] text-ink-3">{errorMessage ?? 'Journal entry not found.'}</p>
      </div>
    );
  }

  const { entry, prev, next } = detail;
  const body = (entry.transcription_text ?? '').trim();
  const sourceLabel = entry.source !== 'typed' ? `via ${entry.source.replace('_', ' ')}` : null;

  return (
    <div className="mx-auto max-w-2xl px-5 lg:px-8 pt-4 pb-24">
      <div className="pb-1 font-mono text-[10px] uppercase tracking-wider text-ink-3">
        <Link href="/library/journal" className="hover:text-ink-2 transition-colors">← Journal</Link>
      </div>

      <DayNav prev={prev} next={next} tz={tz} className="mt-2 mb-6" />

      <header>
        <div className="font-mono text-[10px] uppercase tracking-[0.11em] text-ink-3">
          Journal{sourceLabel ? ` · ${sourceLabel}` : ''}
        </div>
        <h1 className="mt-2 font-serif text-[34px] leading-[1.08] tracking-[-0.02em] font-medium text-ink text-balance">
          {fmtFull(entry.entry_date, tz)}
        </h1>
      </header>

      {body && (
        <div className="mt-7 font-serif text-[19px] leading-[1.62] text-ink-2 whitespace-pre-wrap">
          {body}
        </div>
      )}

      {entry.attachments.length > 0 && (
        <div className={`${body ? 'mt-8' : 'mt-7'} -mx-5 lg:mx-0`}>
          <PhotoGallery attachments={entry.attachments} />
        </div>
      )}

      {!body && entry.attachments.length === 0 && (
        <p className="mt-7 font-sans text-[14px] text-ink-3 italic">An empty entry — add a note or a photo from Edit.</p>
      )}

      <footer className="mt-12 pt-5 border-t border-line flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <span className="eyebrow">Resurfacing</span>
          <BoostButton kind="journal" id={entry.id} weight={entry.resurface_weight} />
        </div>
        <EditDrawer title="Edit entry" triggerVariant="quiet">
          <JournalEditForm
            initial={{
              id: entry.id,
              entry_date: entry.entry_date,
              transcription_text: entry.transcription_text ?? '',
              attachments: entry.attachments ?? [],
            }}
          />
        </EditDrawer>
      </footer>

      <DayNav prev={prev} next={next} tz={tz} className="mt-6" />
    </div>
  );
}

function DayNav({ prev, next, tz, className = '' }: { prev: JournalNeighbor | null; next: JournalNeighbor | null; tz: string; className?: string }) {
  if (!prev && !next) return null;
  return (
    <nav className={`flex items-center justify-between gap-4 font-mono text-[10px] uppercase tracking-wider text-ink-3 ${className}`}>
      {prev
        ? <Link href={`/library/journal/${prev.id}`} className="hover:text-accent transition-colors">‹ {fmtShort(prev.entry_date, tz)}</Link>
        : <span aria-hidden />}
      {next
        ? <Link href={`/library/journal/${next.id}`} className="hover:text-accent transition-colors">{fmtShort(next.entry_date, tz)} ›</Link>
        : <span aria-hidden />}
    </nav>
  );
}

// entry_date is a bare app-tz calendar day; anchor at noon UTC so display never
// rolls to an adjacent day in any timezone.
function fmtFull(ymd: string, tz: string): string {
  return new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-US', {
    timeZone: tz, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });
}
function fmtShort(ymd: string, tz: string): string {
  return new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-US', {
    timeZone: tz, month: 'short', day: 'numeric',
  });
}
