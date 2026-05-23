'use server';

import { revalidatePath } from 'next/cache';
import { peopleApi, ApiError, type PersonFactType } from '@/lib/api';

export type SaveResult = { ok: true } | { ok: false; error: string };

const VALID_FACT_TYPES: readonly PersonFactType[] = [
  'anniversary', 'birthday', 'kid_name', 'shared', 'follow_up', 'other',
];

export async function addFactAction(
  _prev: SaveResult | null,
  formData: FormData,
): Promise<SaveResult> {
  const personId = String(formData.get('person_id') ?? '');
  const rawType = String(formData.get('fact_type') ?? '').trim();
  const factType = (VALID_FACT_TYPES as readonly string[]).includes(rawType)
    ? (rawType as PersonFactType)
    : null;
  const factValue = String(formData.get('fact_value') ?? '').trim();
  const dateRelevant = String(formData.get('date_relevant') ?? '').trim() || null;
  const recurring = formData.get('recurring') === 'on';
  if (!personId) return { ok: false, error: 'Missing person id.' };
  if (!factType) return { ok: false, error: 'Pick a fact type.' };
  if (!factValue) return { ok: false, error: 'Value required.' };
  try {
    await peopleApi.facts.add(personId, {
      fact_type: factType,
      fact_value: factValue,
      date_relevant: dateRelevant,
      recurring,
    });
  } catch (err) {
    if (err instanceof ApiError) return { ok: false, error: `API ${err.status}` };
    return { ok: false, error: (err as Error).message };
  }
  revalidatePath(`/people/${personId}`);
  return { ok: true };
}

export async function deleteFactAction(formData: FormData): Promise<void> {
  const personId = String(formData.get('person_id') ?? '');
  const factId = String(formData.get('fact_id') ?? '');
  if (!personId || !factId) return;
  try {
    await peopleApi.facts.remove(personId, factId);
  } catch {
    /* best-effort */
  }
  revalidatePath(`/people/${personId}`);
}
