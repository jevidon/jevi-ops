'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { peopleApi, ApiError, type PersonCreate, type RelationshipType } from '@/lib/api';

export type SaveResult = { ok: true } | { ok: false; error: string };

const VALID_RELATIONSHIPS: readonly RelationshipType[] = [
  'client', 'family', 'church', 'friend', 'team', 'vendor', 'other',
];

function readFields(formData: FormData): {
  name: string;
  relationship_type: RelationshipType | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  notes: string | null;
} {
  const name = String(formData.get('name') ?? '').trim();
  const rawRelationship = String(formData.get('relationship_type') ?? '').trim();
  const relationship_type = (VALID_RELATIONSHIPS as readonly string[]).includes(rawRelationship)
    ? (rawRelationship as RelationshipType)
    : null;
  const email = String(formData.get('email') ?? '').trim() || null;
  const phone = String(formData.get('phone') ?? '').trim() || null;
  const company = String(formData.get('company') ?? '').trim() || null;
  const notes = String(formData.get('notes') ?? '').trim() || null;
  return { name, relationship_type, email, phone, company, notes };
}

function shapeApiError(err: unknown): SaveResult {
  if (err instanceof ApiError) {
    const body = err.body as { error?: string; details?: Record<string, string[]> } | null;
    const detail = body?.details
      ? ` — ${Object.entries(body.details).map(([k, v]) => `${k}: ${v.join('|')}`).join('; ')}`
      : '';
    return { ok: false, error: `API ${err.status} ${body?.error ?? ''}${detail}`.trim() };
  }
  return { ok: false, error: (err as Error).message };
}

export async function createPersonAction(
  _prev: SaveResult | null,
  formData: FormData,
): Promise<SaveResult> {
  const fields = readFields(formData);
  if (!fields.name) return { ok: false, error: 'Name is required.' };
  const payload: PersonCreate = { ...fields };
  let created;
  try {
    created = await peopleApi.create(payload);
  } catch (err) {
    return shapeApiError(err);
  }
  revalidatePath('/people');
  // redirect must live OUTSIDE the try so its internal NEXT_REDIRECT
  // throw isn't caught by the API-error handler above.
  redirect(`/people/${created.id}`);
}

export async function updatePersonAction(
  _prev: SaveResult | null,
  formData: FormData,
): Promise<SaveResult> {
  const id = String(formData.get('id') ?? '');
  if (!id) return { ok: false, error: 'Missing id.' };
  const fields = readFields(formData);
  if (!fields.name) return { ok: false, error: 'Name is required.' };
  try {
    await peopleApi.update(id, fields);
  } catch (err) {
    return shapeApiError(err);
  }
  revalidatePath(`/people/${id}`);
  revalidatePath('/people');
  return { ok: true };
}

export async function deletePersonAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  if (!id) return;
  try {
    await peopleApi.remove(id);
  } catch {
    /* best-effort */
  }
  revalidatePath('/people');
  redirect('/people');
}
