'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { libraryApi, immichApi, ApiError, type Attachment } from '@/lib/api';

export type SaveResult = { ok: true } | { ok: false; error: string };

export async function createJournalEntryAction(
  _prev: SaveResult | null,
  formData: FormData,
): Promise<SaveResult> {
  const transcription_text = String(formData.get('transcription_text') ?? '').trim();
  // Allow blank text — sometimes a journal entry is just a photo of a
  // page. The DB accepts null transcription_text by design.
  const text = transcription_text || null;

  const entry_date = String(formData.get('entry_date') ?? '').trim();

  const attachmentsRaw = String(formData.get('attachments') ?? '[]');
  let attachments: Attachment[] = [];
  try {
    const parsed = JSON.parse(attachmentsRaw);
    if (Array.isArray(parsed)) attachments = parsed as Attachment[];
  } catch { /* ignore */ }

  // Immich picker selection — attached right after the insert (the attach
  // endpoint needs an entry id, so it can't run before create).
  const immichRaw = String(formData.get('immich_asset_ids') ?? '[]');
  let immichIds: string[] = [];
  try {
    const parsed = JSON.parse(immichRaw);
    if (Array.isArray(parsed)) immichIds = parsed.filter((x): x is string => typeof x === 'string');
  } catch { /* ignore */ }

  if (!text && attachments.length === 0 && immichIds.length === 0) {
    return { ok: false, error: 'Add some text, an image, or both.' };
  }

  let createdId: string;
  try {
    const created = await libraryApi.journal.create({
      transcription_text: text,
      ...(entry_date ? { entry_date } : {}),
      attachments,
      // journal_entries.source CHECK allows only handwritten_photo | voice |
      // typed. A manually composed entry is 'typed'.
      source: 'typed',
    });
    createdId = created.id;
  } catch (err) {
    if (err instanceof ApiError) {
      const body = err.body as { error?: string } | null;
      return { ok: false, error: body?.error ?? `API ${err.status}` };
    }
    return { ok: false, error: (err as Error).message };
  }

  // Best-effort: a failed copy must not orphan the just-created entry —
  // the reader's "From Immich" section offers the same photos for retry.
  // The attach endpoint caps asset_ids at 20 per request, so chunk.
  for (let i = 0; i < immichIds.length; i += 20) {
    try {
      await immichApi.attachToJournal(createdId, immichIds.slice(i, i + 20));
    } catch { /* best-effort */ }
  }

  revalidatePath('/library/journal');
  revalidatePath('/library');
  redirect(`/library/journal/${createdId}`);
}
