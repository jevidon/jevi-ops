'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { libraryApi, ApiError, type NoteSourceType } from '@/lib/api';

export type SaveResult = { ok: true } | { ok: false; error: string };

const VALID_SOURCE_TYPES: NoteSourceType[] = [
  'own_thought', 'reading_response', 'meeting_note',
  'brainstorm', 'observation', 'other',
];

export async function updateNoteAction(
  _prev: SaveResult | null,
  formData: FormData,
): Promise<SaveResult> {
  const id = String(formData.get('id') ?? '');
  if (!id) return { ok: false, error: 'Missing id.' };

  const body = String(formData.get('body') ?? '').trim();
  if (!body) return { ok: false, error: 'Body is required.' };

  // Title is optional. Empty string → null so the DB clears any prior value.
  const title = String(formData.get('title') ?? '').trim() || null;

  const rawSourceType = String(formData.get('source_type') ?? 'own_thought');
  const source_type = (VALID_SOURCE_TYPES as string[]).includes(rawSourceType)
    ? (rawSourceType as NoteSourceType)
    : 'own_thought';

  const source_reference = String(formData.get('source_reference') ?? '').trim() || undefined;
  const needs_review = formData.get('needs_review') === 'on';

  // Tags as comma-separated input.
  const tagsRaw = String(formData.get('tags') ?? '').trim();
  const tags = tagsRaw
    ? tagsRaw.split(',').map((t) => t.trim()).filter(Boolean)
    : [];

  try {
    await libraryApi.notes.update(id, {
      title,
      body,
      source_type,
      source_reference: source_reference ?? null,
      tags,
      needs_review,
    });
  } catch (err) {
    if (err instanceof ApiError) {
      // Surface Zod field errors so the UI doesn't just say "API 400" —
      // makes future schema mismatches debuggable in one click.
      const body = err.body as { error?: string; details?: Record<string, string[]> } | null;
      const detailParts = body?.details
        ? Object.entries(body.details).map(([k, v]) => `${k}: ${v.join('|')}`)
        : [];
      const detail = detailParts.length ? ` — ${detailParts.join('; ')}` : '';
      return { ok: false, error: `API ${err.status} ${body?.error ?? ''}${detail}`.trim() };
    }
    return { ok: false, error: (err as Error).message };
  }

  revalidatePath(`/library/notes/${id}`);
  revalidatePath('/library/notes');
  revalidatePath('/library');
  return { ok: true };
}

export async function deleteNoteAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  if (!id) return;
  try {
    await libraryApi.notes.remove(id);
  } catch {
    /* best-effort */
  }
  revalidatePath('/library/notes');
  revalidatePath('/library');
  redirect('/library/notes');
}
