'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { companiesApi, ApiError, type CompanyCreate, type CompanyRelationshipType } from '@/lib/api';

export type SaveResult = { ok: true } | { ok: false; error: string };

const VALID_RELATIONSHIPS: readonly CompanyRelationshipType[] = [
  'active_client', 'past_client', 'prospect', 'vendor', 'partner', 'brand_deal', 'other',
];

function readFields(formData: FormData): CompanyCreate {
  const name = String(formData.get('name') ?? '').trim();
  const rawRel = String(formData.get('relationship_type') ?? '').trim();
  const relationship_type = (VALID_RELATIONSHIPS as readonly string[]).includes(rawRel)
    ? (rawRel as CompanyRelationshipType)
    : null;
  const domain_id = String(formData.get('domain_id') ?? '').trim() || null;
  const website = String(formData.get('website') ?? '').trim() || null;
  const primary_email = String(formData.get('primary_email') ?? '').trim() || null;
  const primary_phone = String(formData.get('primary_phone') ?? '').trim() || null;
  const first_engagement_at = String(formData.get('first_engagement_at') ?? '').trim() || null;
  const next_review_at = String(formData.get('next_review_at') ?? '').trim() || null;
  const notes = String(formData.get('notes') ?? '').trim() || null;
  // Check-in cadence — blank/invalid → null (rule falls back to 30 days).
  const rawInterval = parseInt(String(formData.get('checkin_interval_days') ?? '').trim(), 10);
  const checkin_interval_days = Number.isFinite(rawInterval) && rawInterval > 0 ? rawInterval : null;
  // active only appears on the edit form, as a hidden 'false' + a checkbox
  // that submits 'on' when checked. Use getAll: [] on create (field absent →
  // undefined → server default true); ['false'] when unchecked → false;
  // ['false','on'] when checked → true. get() would return only the first
  // value ('false') and break the checked case, so getAll is required.
  const activeVals = formData.getAll('active').map(String);
  const active = activeVals.length === 0 ? undefined : activeVals.includes('on');
  return {
    name, relationship_type, domain_id, website, primary_email, primary_phone,
    first_engagement_at, next_review_at, checkin_interval_days, notes,
    ...(active === undefined ? {} : { active }),
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

export async function createCompanyAction(
  _prev: SaveResult | null,
  formData: FormData,
): Promise<SaveResult> {
  const fields = readFields(formData);
  if (!fields.name) return { ok: false, error: 'Name is required.' };
  let created;
  try {
    created = await companiesApi.create(fields);
  } catch (err) {
    return shapeApiError(err);
  }
  revalidatePath('/companies');
  // redirect must live OUTSIDE the try — its NEXT_REDIRECT throw would
  // otherwise be caught as an API error.
  redirect(`/companies/${created.id}`);
}

export async function updateCompanyAction(
  _prev: SaveResult | null,
  formData: FormData,
): Promise<SaveResult> {
  const id = String(formData.get('id') ?? '');
  if (!id) return { ok: false, error: 'Missing id.' };
  const fields = readFields(formData);
  if (!fields.name) return { ok: false, error: 'Name is required.' };
  try {
    await companiesApi.update(id, fields);
  } catch (err) {
    return shapeApiError(err);
  }
  revalidatePath(`/companies/${id}`);
  revalidatePath('/companies');
  return { ok: true };
}

export async function deleteCompanyAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  if (!id) return;
  try {
    await companiesApi.remove(id);
  } catch {
    /* best-effort */
  }
  revalidatePath('/companies');
  redirect('/companies');
}
