'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { routinesApi, ApiError, type TimeOfDayBucket } from '@/lib/api';

const VALID_BUCKETS: readonly TimeOfDayBucket[] = ['morning', 'afternoon', 'evening', 'anytime'];

// Extract the schedule fields the form posts. Centralized so create + update
// share the same parse + null-empty-strings behavior.
function readScheduleFields(formData: FormData): {
  time_of_day: TimeOfDayBucket;
  specific_time: string | null;
  reminder_enabled: boolean;
} {
  const rawBucket = String(formData.get('time_of_day') ?? '').trim();
  const time_of_day = (VALID_BUCKETS as readonly string[]).includes(rawBucket)
    ? (rawBucket as TimeOfDayBucket)
    : 'anytime';
  const rawTime = String(formData.get('specific_time') ?? '').trim();
  const specific_time = rawTime || null;
  // HTML checkboxes send "on" when checked, nothing when unchecked.
  const reminder_enabled = formData.get('reminder_enabled') === 'on';
  return { time_of_day, specific_time, reminder_enabled };
}

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
  const schedule = readScheduleFields(formData);
  // Defense-in-depth: the form gates the checkbox UI on having a time,
  // but if someone manually submits without one, drop the toggle.
  if (schedule.reminder_enabled && !schedule.specific_time) {
    schedule.reminder_enabled = false;
  }
  let created;
  try {
    created = await routinesApi.create({ name, description, ...schedule });
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
  const schedule = readScheduleFields(formData);
  if (schedule.reminder_enabled && !schedule.specific_time) {
    schedule.reminder_enabled = false;
  }
  try {
    await routinesApi.update(id, { name, description, ...schedule });
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
