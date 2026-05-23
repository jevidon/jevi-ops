'use server';

import { revalidatePath } from 'next/cache';
import { libraryApi, type NoteSourceType } from '@/lib/api';

// One-tap classifications for the Needs Review rail on /today. Each
// action sets a source_type (or just clears the review flag) and flips
// needs_review=false in one round-trip. Best-effort: failures are
// swallowed so a flaky network doesn't strand the user mid-triage —
// the next page revalidate will show real state either way.

async function classify(noteId: string, sourceType: NoteSourceType): Promise<void> {
  try {
    await libraryApi.notes.update(noteId, {
      source_type: sourceType,
      needs_review: false,
    });
  } catch {
    /* best-effort */
  }
  revalidatePath('/today');
  revalidatePath('/library/notes');
  revalidatePath(`/library/notes/${noteId}`);
}

export async function classifyAsOwnThoughtAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  if (id) await classify(id, 'own_thought');
}

export async function classifyAsReadingAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  if (id) await classify(id, 'reading_response');
}

export async function classifyAsMeetingAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  if (id) await classify(id, 'meeting_note');
}

export async function classifyAsBrainstormAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  if (id) await classify(id, 'brainstorm');
}

// Clears the review flag without changing source_type — useful when the
// existing source_type is already correct and you just want the note off
// the review list.
export async function clearReviewFlagAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  if (!id) return;
  try {
    await libraryApi.notes.update(id, { needs_review: false });
  } catch {
    /* best-effort */
  }
  revalidatePath('/today');
  revalidatePath('/library/notes');
  revalidatePath(`/library/notes/${id}`);
}
