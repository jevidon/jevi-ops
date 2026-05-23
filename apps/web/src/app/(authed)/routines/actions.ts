'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { routinesApi, ApiError } from '@/lib/api';

export type SaveResult = { ok: true } | { ok: false; error: string };

function shapeError(err: unknown): SaveResult {
  if (err instanceof ApiError) {
    const body = err.body as { error?: string; details?: Record<string, string[]> } | null;
    const detail = body?.details
      ? ` — ${Object.entries(body.details).map(([k, v]) => `${k}: ${v.join('|')}`).join('; ')}`
      : '';
    return { ok: false, error: `API ${err.status} ${body?.error ?? ''}${detail}`.trim() };
  }
  return { ok: false, error: (err as Error).message };
}

// Touch every surface that surfaces routines (today widget, list,
// detail). Cheap calls — Next.js dedupes.
function revalidateAll(id?: string) {
  revalidatePath('/today');
  revalidatePath('/routines');
  if (id) revalidatePath(`/routines/${id}`);
}

export async function toggleCompletionAction(formData: FormData): Promise<void> {
  const routineId = String(formData.get('routine_id') ?? '');
  const currentlyDone = formData.get('done_today') === 'true';
  if (!routineId) return;
  try {
    // No date → server uses its "today" in app TZ.
    await routinesApi.toggleCompletion(routineId, { done: !currentlyDone });
  } catch {
    /* best-effort — UI reloads next render */
  }
  revalidateAll(routineId);
}

export async function createRoutineAction(
  _prev: SaveResult | null,
  formData: FormData,
): Promise<SaveResult> {
  const name = String(formData.get('name') ?? '').trim();
  const description = String(formData.get('description') ?? '').trim() || null;
  if (!name) return { ok: false, error: 'Name is required.' };
  let created;
  try {
    created = await routinesApi.create({ name, description });
  } catch (err) {
    return shapeError(err);
  }
  revalidateAll();
  redirect(`/routines/${created.id}`);
}

export async function updateRoutineAction(
  _prev: SaveResult | null,
  formData: FormData,
): Promise<SaveResult> {
  const id = String(formData.get('id') ?? '');
  const name = String(formData.get('name') ?? '').trim();
  const description = String(formData.get('description') ?? '').trim() || null;
  if (!id) return { ok: false, error: 'Missing id.' };
  if (!name) return { ok: false, error: 'Name is required.' };
  try {
    await routinesApi.update(id, { name, description });
  } catch (err) {
    return shapeError(err);
  }
  revalidateAll(id);
  return { ok: true };
}

export async function archiveRoutineAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  if (!id) return;
  try {
    await routinesApi.update(id, { active: false });
  } catch {
    /* best-effort */
  }
  revalidateAll(id);
}

export async function reactivateRoutineAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  if (!id) return;
  try {
    await routinesApi.update(id, { active: true });
  } catch {
    /* best-effort */
  }
  revalidateAll(id);
}

export async function deleteRoutineAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  if (!id) return;
  try {
    await routinesApi.remove(id);
  } catch {
    /* best-effort */
  }
  revalidateAll();
  redirect('/routines');
}
