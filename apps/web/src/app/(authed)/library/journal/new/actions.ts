'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { libraryApi, ApiError, type Attachment } from '@/lib/api';

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

  if (!text && attachments.length === 0) {
    return { ok: false, error: 'Add some text, an image, or both.' };
  }

  let createdId: string;
  try {
    const created = await libraryApi.journal.create({
      transcription_text: text,
      ...(entry_date ? { entry_date } : {}),
      attachments,
      source: 'manual',
    });
    createdId = created.id;
  } catch (err) {
    if (err instanceof ApiError) {
      const body = err.body as { error?: string } | null;
      return { ok: false, error: body?.error ?? `API ${err.status}` };
    }
    return { ok: false, error: (err as Error).message };
  }

  revalidatePath('/library/journal');
  revalidatePath('/library');
  redirect(`/library/journal/${createdId}`);
}
