'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { healthApi, ApiError, type VisitType } from '@/lib/api';

export type SaveResult = { ok: true } | { ok: false; error: string };

const VALID_TYPES: VisitType[] = [
  'annual', 'sick', 'specialist', 'follow_up', 'lab', 'imaging',
  'urgent_care', 'emergency', 'telehealth', 'other',
];

function readFields(formData: FormData) {
  const visit_date = String(formData.get('visit_date') ?? '').trim();
  const provider_name = String(formData.get('provider_name') ?? '').trim() || null;
  const provider_specialty = String(formData.get('provider_specialty') ?? '').trim() || null;
  const rawType = String(formData.get('visit_type') ?? '').trim();
  const visit_type = VALID_TYPES.includes(rawType as VisitType) ? (rawType as VisitType) : null;
  const reason = String(formData.get('reason') ?? '').trim() || null;
  const assessment = String(formData.get('assessment') ?? '').trim() || null;
  const plan = String(formData.get('plan') ?? '').trim() || null;
  const notes = String(formData.get('notes') ?? '').trim() || null;
  const follow_up_date = String(formData.get('follow_up_date') ?? '').trim() || null;
  return { visit_date, provider_name, provider_specialty, visit_type, reason, assessment, plan, notes, follow_up_date };
}

export async function createVisitAction(_prev: SaveResult | null, formData: FormData): Promise<SaveResult> {
  const fields = readFields(formData);
  if (!fields.visit_date) return { ok: false, error: 'Date is required.' };
  let created;
  try {
    created = await healthApi.visits.create(fields);
  } catch (err) {
    if (err instanceof ApiError) return { ok: false, error: `API ${err.status}` };
    return { ok: false, error: (err as Error).message };
  }
  revalidatePath('/health');
  revalidatePath('/health/visits');
  redirect(`/health/visits/${created.id}`);
}

export async function updateVisitAction(_prev: SaveResult | null, formData: FormData): Promise<SaveResult> {
  const id = String(formData.get('id') ?? '');
  if (!id) return { ok: false, error: 'Missing id.' };
  const fields = readFields(formData);
  if (!fields.visit_date) return { ok: false, error: 'Date is required.' };
  try {
    await healthApi.visits.update(id, fields);
  } catch (err) {
    if (err instanceof ApiError) return { ok: false, error: `API ${err.status}` };
    return { ok: false, error: (err as Error).message };
  }
  revalidatePath('/health');
  revalidatePath('/health/visits');
  revalidatePath(`/health/visits/${id}`);
  return { ok: true };
}

export async function deleteVisitAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  if (!id) return;
  try { await healthApi.visits.remove(id); } catch { /* noop */ }
  revalidatePath('/health');
  revalidatePath('/health/visits');
  redirect('/health/visits');
}
