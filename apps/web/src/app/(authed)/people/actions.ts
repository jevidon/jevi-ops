'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { peopleApi, ApiError, type PersonCreate, type RelationshipType } from '@/lib/api';

export type SaveResult = { ok: true } | { ok: false; error: string };

const VALID_RELATIONSHIPS: readonly RelationshipType[] = [
  'client', 'family', 'church', 'friend', 'team', 'vendor', 'other',
];

function readFields(formData: FormData): PersonCreate {
  const name = String(formData.get('name') ?? '').trim();
  const rawRelationship = String(formData.get('relationship_type') ?? '').trim();
  const relationship_type = (VALID_RELATIONSHIPS as readonly string[]).includes(rawRelationship)
    ? (rawRelationship as RelationshipType)
    : null;
  const email = String(formData.get('email') ?? '').trim() || null;
  const phone = String(formData.get('phone') ?? '').trim() || null;
  const company_id = String(formData.get('company_id') ?? '').trim() || null;
  const role_at_company = String(formData.get('role_at_company') ?? '').trim() || null;
  const birthday = String(formData.get('birthday') ?? '').trim() || null;
  const anniversary = String(formData.get('anniversary') ?? '').trim() || null;
  // Checkbox with a hidden 'false' companion — getAll returns ['false'] when
  // unchecked, ['false','on'] when checked (never absent since the form
  // always renders it), so presence of 'on' means true.
  const is_primary_contact = formData.getAll('is_primary_contact').map(String).includes('on');
  const notes = String(formData.get('notes') ?? '').trim() || null;
  // If no company is selected, a primary-contact flag is meaningless — force
  // it false so we never trip the one-primary-per-company partial index with
  // a null company_id edge case.
  return {
    name,
    relationship_type,
    email,
    phone,
    company_id,
    role_at_company,
    is_primary_contact: company_id ? is_primary_contact : false,
    birthday,
    anniversary,
    notes,
  };
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
