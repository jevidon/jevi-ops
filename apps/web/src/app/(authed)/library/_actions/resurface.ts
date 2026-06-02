'use server';

import { revalidatePath } from 'next/cache';
import { libraryApi, ApiError } from '@/lib/api';

// Shared "boost" action used by the resurface button on quote, note, and
// journal detail pages. The button only ever cycles through a fixed set
// of weights (1.0 / 2.0 / 5.0 / 0) so we don't try to validate arbitrary
// numbers here — we trust the client to send one of those four values.

export type ResurfaceKind = 'quote' | 'note' | 'journal';

const ALLOWED: ReadonlySet<number> = new Set([0, 1, 2, 5]);

export type ResurfaceResult = { ok: true; weight: number } | { ok: false; error: string };

export async function setResurfaceWeightAction(
  _prev: ResurfaceResult | null,
  formData: FormData,
): Promise<ResurfaceResult> {
  const kind = String(formData.get('kind') ?? '') as ResurfaceKind;
  const id = String(formData.get('id') ?? '');
  const weightRaw = Number(formData.get('weight') ?? NaN);

  if (!id || !kind) return { ok: false, error: 'Missing id or kind.' };
  if (!Number.isFinite(weightRaw) || !ALLOWED.has(weightRaw)) {
    return { ok: false, error: 'Invalid weight.' };
  }

  try {
    if (kind === 'quote') {
      await libraryApi.quotes.update(id, { resurface_weight: weightRaw });
      revalidatePath(`/library/quotes/${id}`);
      revalidatePath('/library/quotes');
    } else if (kind === 'note') {
      await libraryApi.notes.update(id, { resurface_weight: weightRaw });
      revalidatePath(`/library/notes/${id}`);
      revalidatePath('/library/notes');
    } else if (kind === 'journal') {
      await libraryApi.journal.update(id, { resurface_weight: weightRaw });
      revalidatePath(`/library/journal/${id}`);
      revalidatePath('/library/journal');
    } else {
      return { ok: false, error: 'Unknown kind.' };
    }
  } catch (err) {
    if (err instanceof ApiError) {
      const body = err.body as { error?: string } | null;
      return { ok: false, error: `API ${err.status} ${body?.error ?? ''}`.trim() };
    }
    return { ok: false, error: (err as Error).message };
  }

  // The Today page picks a fresh resurfacing item per day, so revalidating
  // /today after a weight change isn't strictly necessary, but it keeps the
  // mental model consistent: a weight bump might affect today's pick on
  // next request if the new pool is small enough.
  revalidatePath('/today');
  revalidatePath('/library');

  return { ok: true, weight: weightRaw };
}
