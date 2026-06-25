'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { libraryApi, ApiError, type NoteSourceType, type Attachment } from '@/lib/api';

export type SaveResult = { ok: true } | { ok: false; error: string };

const VALID_SOURCE_TYPES: NoteSourceType[] = [
  'own_thought', 'reading_response', 'meeting_note',
  'brainstorm', 'observation', 'other',
];

export async function createNoteAction(
  _prev: SaveResult | null,
  formData: FormData,
): Promise<SaveResult> {
  const body = String(formData.get('body') ?? '').trim();
  if (!body) return { ok: false, error: 'Body is required.' };

  const title = String(formData.get('title') ?? '').trim() || null;

  const rawSourceType = String(formData.get('source_type') ?? 'own_thought');
  const source_type = (VALID_SOURCE_TYPES as string[]).includes(rawSourceType)
    ? (rawSourceType as NoteSourceType)
    : 'own_thought';

  const source_reference = String(formData.get('source_reference') ?? '').trim() || null;
  const needs_review = formData.get('needs_review') === 'on';

  const tagsRaw = String(formData.get('tags') ?? '').trim();
  const tags = tagsRaw
    ? tagsRaw.split(',').map((t) => t.trim()).filter(Boolean)
    : [];

  // Attachments come in as a JSON-encoded array from the ImageUploader's
  // hidden field. Malformed → empty array; we don't surface upload
  // errors here since they would've fired earlier.
  const attachmentsRaw = String(formData.get('attachments') ?? '[]');
  let attachments: Attachment[] = [];
  try {
    const parsed = JSON.parse(attachmentsRaw);
    if (Array.isArray(parsed)) attachments = parsed as Attachment[];
  } catch { /* ignore */ }

  let createdId: string;
  try {
    const created = await libraryApi.notes.create({
      title,
      body,
      source_type,
      source_reference: source_reference ?? null,
      tags,
      needs_review,
      attachments,
    });
    createdId = created.id;
  } catch (err) {
    if (err instanceof ApiError) {
      const errBody = err.body as { error?: string; details?: Record<string, string[]> } | null;
      const detailParts = errBody?.details
        ? Object.entries(errBody.details).map(([k, v]) => `${k}: ${v.join('|')}`)
        : [];
      const detail = detailParts.length ? ` — ${detailParts.join('; ')}` : '';
      return { ok: false, error: `API ${err.status} ${errBody?.error ?? ''}${detail}`.trim() };
    }
    return { ok: false, error: (err as Error).message };
  }

  revalidatePath('/library/notes');
  revalidatePath('/library');
  redirect(`/library/notes/${createdId}`);
}
