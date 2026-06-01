'use server';

import { revalidatePath } from 'next/cache';
import { healthApi, ApiError } from '@/lib/api';

export type SaveResult = { ok: true } | { ok: false; error: string };

function intOrNull(raw: FormDataEntryValue | null, min: number, max: number): number | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const n = parseInt(s, 10);
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return n;
}

export async function createCheckInAction(
  _prev: SaveResult | null,
  formData: FormData,
): Promise<SaveResult> {
  const mood = intOrNull(formData.get('mood'), 1, 5);
  const energy = intOrNull(formData.get('energy'), 1, 5);
  const sleep_quality = intOrNull(formData.get('sleep_quality'), 1, 5);
  const pain = intOrNull(formData.get('pain'), 0, 10);
  const notes = String(formData.get('notes') ?? '').trim() || null;
  if (mood == null && energy == null && sleep_quality == null && pain == null && !notes) {
    return { ok: false, error: 'Log at least one rating or a note.' };
  }
  try {
    await healthApi.checkIns.create({
      mood, energy, sleep_quality, pain, notes,
    });
  } catch (err) {
    if (err instanceof ApiError) return { ok: false, error: `API ${err.status}` };
    return { ok: false, error: (err as Error).message };
  }
  revalidatePath('/health');
  revalidatePath('/health/check-ins');
  return { ok: true };
}

export async function deleteCheckInAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  if (!id) return;
  try {
    await healthApi.checkIns.remove(id);
  } catch { /* best-effort */ }
  revalidatePath('/health');
  revalidatePath('/health/check-ins');
}
