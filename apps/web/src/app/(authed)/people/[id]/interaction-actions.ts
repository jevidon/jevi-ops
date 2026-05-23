'use server';

import { revalidatePath } from 'next/cache';
import { peopleApi, ApiError, type PersonInteractionType } from '@/lib/api';

export type SaveResult = { ok: true } | { ok: false; error: string };

const VALID_INTERACTION_TYPES: readonly PersonInteractionType[] = [
  'email', 'call', 'in_person', 'text', 'meeting', 'other',
];

export async function addInteractionAction(
  _prev: SaveResult | null,
  formData: FormData,
): Promise<SaveResult> {
  const personId = String(formData.get('person_id') ?? '');
  const rawType = String(formData.get('interaction_type') ?? '').trim();
  const type = (VALID_INTERACTION_TYPES as readonly string[]).includes(rawType)
    ? (rawType as PersonInteractionType)
    : null;
  const notes = String(formData.get('notes') ?? '').trim() || null;
  // Empty = DB default (now). The form can pass a backfill date.
  const occurredAt = String(formData.get('occurred_at') ?? '').trim() || null;
  if (!personId) return { ok: false, error: 'Missing person id.' };
  if (!type) return { ok: false, error: 'Pick an interaction type.' };
  try {
    await peopleApi.interactions.add(personId, {
      interaction_type: type,
      notes,
      occurred_at: occurredAt,
    });
  } catch (err) {
    if (err instanceof ApiError) return { ok: false, error: `API ${err.status}` };
    return { ok: false, error: (err as Error).message };
  }
  revalidatePath(`/people/${personId}`);
  return { ok: true };
}

export async function deleteInteractionAction(formData: FormData): Promise<void> {
  const personId = String(formData.get('person_id') ?? '');
  const interactionId = String(formData.get('interaction_id') ?? '');
  if (!personId || !interactionId) return;
  try {
    await peopleApi.interactions.remove(personId, interactionId);
  } catch {
    /* best-effort */
  }
  revalidatePath(`/people/${personId}`);
}
