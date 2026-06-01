'use server';

import { revalidatePath } from 'next/cache';
import { healthApi, ApiError } from '@/lib/api';

export type SaveResult = { ok: true } | { ok: false; error: string };

function num(raw: FormDataEntryValue | null): number | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

export async function createMetricAction(
  _prev: SaveResult | null,
  formData: FormData,
): Promise<SaveResult> {
  const metric = String(formData.get('metric') ?? '').trim();
  if (!metric) return { ok: false, error: 'Pick a metric.' };
  const value = num(formData.get('value'));
  const valueSecondary = num(formData.get('value_secondary'));
  const unit = String(formData.get('unit') ?? '').trim() || null;
  const measuredAtRaw = String(formData.get('measured_at') ?? '').trim();
  const measuredAt = measuredAtRaw ? new Date(measuredAtRaw).toISOString() : new Date().toISOString();
  const notes = String(formData.get('notes') ?? '').trim() || null;
  if (value == null && !notes) {
    return { ok: false, error: 'Enter a value or a note.' };
  }

  try {
    await healthApi.metrics.create({
      metric,
      value: value ?? undefined,
      value_secondary: valueSecondary,
      unit,
      measured_at: measuredAt,
      source: 'manual',
      notes,
    });
  } catch (err) {
    if (err instanceof ApiError) return { ok: false, error: `API ${err.status}` };
    return { ok: false, error: (err as Error).message };
  }
  revalidatePath('/health');
  revalidatePath('/health/vitals');
  return { ok: true };
}

export async function deleteMetricAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  if (!id) return;
  try { await healthApi.metrics.remove(id); } catch { /* noop */ }
  revalidatePath('/health');
  revalidatePath('/health/vitals');
}
