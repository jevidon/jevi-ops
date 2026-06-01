'use server';

import { revalidatePath } from 'next/cache';
import { healthApi, ApiError } from '@/lib/api';

export type SaveResult = { ok: true } | { ok: false; error: string };

export async function updateNarrativeAction(_prev: SaveResult | null, formData: FormData): Promise<SaveResult> {
  const narrative = String(formData.get('narrative') ?? '');
  try {
    await healthApi.history.update({ narrative: narrative || null });
  } catch (err) {
    if (err instanceof ApiError) return { ok: false, error: `API ${err.status}` };
    return { ok: false, error: (err as Error).message };
  }
  revalidatePath('/health/history');
  return { ok: true };
}

// Each structured section (conditions, surgeries, etc.) stores an array
// of free-shape JSON objects. We send the whole array on every save —
// the caller passes the JSON-encoded new array and we patch it in.

export async function updateSectionAction(_prev: SaveResult | null, formData: FormData): Promise<SaveResult> {
  const section = String(formData.get('section') ?? '');
  const rawJson = String(formData.get('entries_json') ?? '[]');
  let entries: unknown;
  try {
    entries = JSON.parse(rawJson);
  } catch {
    return { ok: false, error: 'Invalid JSON.' };
  }
  if (!Array.isArray(entries)) return { ok: false, error: 'Expected an array.' };

  const valid = ['conditions', 'surgeries', 'allergies', 'immunizations', 'family_history'];
  if (!valid.includes(section)) return { ok: false, error: 'Unknown section.' };

  try {
    await healthApi.history.update({ [section]: entries } as Record<string, unknown>);
  } catch (err) {
    if (err instanceof ApiError) return { ok: false, error: `API ${err.status}` };
    return { ok: false, error: (err as Error).message };
  }
  revalidatePath('/health/history');
  return { ok: true };
}
