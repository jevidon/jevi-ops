'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { libraryApi, ApiError, type Attachment } from '@/lib/api';

export type SaveResult = { ok: true } | { ok: false; error: string };

function shapeApiError(err: unknown): SaveResult {
  if (err instanceof ApiError) {
    const body = err.body as { error?: string; details?: Record<string, string[]> } | null;
    const detailParts = body?.details
      ? Object.entries(body.details).map(([k, v]) => `${k}: ${v.join('|')}`)
      : [];
    const detail = detailParts.length ? ` — ${detailParts.join('; ')}` : '';
    return { ok: false, error: `API ${err.status} ${body?.error ?? ''}${detail}`.trim() };
  }
  return { ok: false, error: (err as Error).message };
}

export async function updateJournalEntryAction(
  _prev: SaveResult | null,
  formData: FormData,
): Promise<SaveResult> {
  const id = String(formData.get('id') ?? '');
  if (!id) return { ok: false, error: 'Missing id.' };

  // Allow blank text — sometimes a journal entry is just a photo.
  const transcription_text = String(formData.get('transcription_text') ?? '');
  const entry_date = String(formData.get('entry_date') ?? '').trim() || undefined;

  // Attachments round-tripped as JSON string from the ImageUploader.
  const attachmentsRaw = String(formData.get('attachments') ?? '[]');
  let attachments: Attachment[] = [];
  try {
    const parsed = JSON.parse(attachmentsRaw);
    if (Array.isArray(parsed)) attachments = parsed as Attachment[];
  } catch { /* ignore */ }

  try {
    await libraryApi.journal.update(id, {
      transcription_text: transcription_text.trim() ? transcription_text : null,
      ...(entry_date ? { entry_date } : {}),
      attachments,
    });
  } catch (err) {
    return shapeApiError(err);
  }
  revalidatePath(`/library/journal/${id}`);
  revalidatePath('/library/journal');
  revalidatePath('/library');
  return { ok: true };
}

export async function deleteJournalEntryAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  if (!id) return;
  try {
    await libraryApi.journal.remove(id);
  } catch {
    /* best-effort */
  }
  revalidatePath('/library/journal');
  revalidatePath('/library');
  redirect('/library/journal');
}
