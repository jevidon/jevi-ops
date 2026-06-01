'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { healthApi, ApiError, type LabResult } from '@/lib/api';

export type SaveResult = { ok: true } | { ok: false; error: string };

function num(raw: FormDataEntryValue | null): number | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

export async function createPanelAction(_prev: SaveResult | null, formData: FormData): Promise<SaveResult> {
  const drawn_date = String(formData.get('drawn_date') ?? '').trim();
  const panel_name = String(formData.get('panel_name') ?? '').trim();
  if (!drawn_date) return { ok: false, error: 'Date is required.' };
  if (!panel_name) return { ok: false, error: 'Panel name is required.' };
  const ordering_provider = String(formData.get('ordering_provider') ?? '').trim() || null;
  const lab_facility = String(formData.get('lab_facility') ?? '').trim() || null;
  const notes = String(formData.get('notes') ?? '').trim() || null;

  let created;
  try {
    created = await healthApi.labs.createPanel({
      drawn_date, panel_name, ordering_provider, lab_facility, notes,
    });
  } catch (err) {
    if (err instanceof ApiError) return { ok: false, error: `API ${err.status}` };
    return { ok: false, error: (err as Error).message };
  }
  revalidatePath('/health');
  revalidatePath('/health/labs');
  redirect(`/health/labs/${created.id}`);
}

export async function addResultAction(_prev: SaveResult | null, formData: FormData): Promise<SaveResult> {
  const panel_id = String(formData.get('panel_id') ?? '');
  const analyte = String(formData.get('analyte') ?? '').trim();
  if (!panel_id || !analyte) return { ok: false, error: 'Panel + analyte name are required.' };
  const body: Partial<LabResult> = {
    analyte,
    value: num(formData.get('value')) ?? undefined,
    value_text: String(formData.get('value_text') ?? '').trim() || null,
    unit: String(formData.get('unit') ?? '').trim() || null,
    reference_range_low: num(formData.get('reference_range_low')),
    reference_range_high: num(formData.get('reference_range_high')),
    reference_text: String(formData.get('reference_text') ?? '').trim() || null,
  };
  try {
    await healthApi.labs.addResult(panel_id, body);
  } catch (err) {
    if (err instanceof ApiError) return { ok: false, error: `API ${err.status}` };
    return { ok: false, error: (err as Error).message };
  }
  revalidatePath('/health');
  revalidatePath('/health/labs');
  revalidatePath(`/health/labs/${panel_id}`);
  return { ok: true };
}

export async function deleteResultAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  const panel_id = String(formData.get('panel_id') ?? '');
  if (!id) return;
  try { await healthApi.labs.removeResult(id); } catch { /* noop */ }
  revalidatePath(`/health/labs/${panel_id}`);
}

export async function deletePanelAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  if (!id) return;
  try { await healthApi.labs.removePanel(id); } catch { /* noop */ }
  revalidatePath('/health');
  revalidatePath('/health/labs');
  redirect('/health/labs');
}
