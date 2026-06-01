'use server';

import { revalidatePath } from 'next/cache';
import { healthApi, ApiError, type MedicationKind } from '@/lib/api';

export type SaveResult = { ok: true } | { ok: false; error: string };

const VALID_KINDS: MedicationKind[] = ['prescription', 'supplement', 'vitamin', 'otc'];

export async function createMedAction(_prev: SaveResult | null, formData: FormData): Promise<SaveResult> {
  const name = String(formData.get('name') ?? '').trim();
  if (!name) return { ok: false, error: 'Name is required.' };
  const rawKind = String(formData.get('kind') ?? 'prescription').trim();
  const kind = VALID_KINDS.includes(rawKind as MedicationKind) ? (rawKind as MedicationKind) : 'prescription';
  try {
    await healthApi.medications.create({
      name,
      kind,
      dosage: String(formData.get('dosage') ?? '').trim() || null,
      frequency: String(formData.get('frequency') ?? '').trim() || null,
      prescribing_provider: String(formData.get('prescribing_provider') ?? '').trim() || null,
      reason: String(formData.get('reason') ?? '').trim() || null,
      start_date: String(formData.get('start_date') ?? '').trim() || null,
      notes: String(formData.get('notes') ?? '').trim() || null,
      active: true,
    });
  } catch (err) {
    if (err instanceof ApiError) return { ok: false, error: `API ${err.status}` };
    return { ok: false, error: (err as Error).message };
  }
  revalidatePath('/health');
  revalidatePath('/health/meds');
  return { ok: true };
}

export async function toggleActiveAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  const active = formData.get('active') === 'true';
  if (!id) return;
  try {
    await healthApi.medications.update(id, {
      active: !active,
      stop_date: !active ? null : new Date().toISOString().slice(0, 10),
    });
  } catch { /* noop */ }
  revalidatePath('/health');
  revalidatePath('/health/meds');
}

export async function deleteMedAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  if (!id) return;
  try { await healthApi.medications.remove(id); } catch { /* noop */ }
  revalidatePath('/health');
  revalidatePath('/health/meds');
}
