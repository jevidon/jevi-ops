'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { tasksApi, ApiError } from '@/lib/api';

export type SaveResult = { ok: true } | { ok: false; error: string };

// Form schema — captures every field the shared TaskForm posts. We accept
// empty strings for the foreign-key dropdowns (project, content) and turn
// them into null at the API call so the user can clear an existing link.
const TaskFormSchema = z.object({
  title: z.string().trim().min(1, 'Title is required'),
  notes: z.string().trim(),
  due_date: z.string(),
  due_time: z.string(),
  priority: z.coerce.number().int().min(1).max(4),
  project_id: z.string(),
  content_item_id: z.string(),
});

function readFormFields(formData: FormData) {
  return TaskFormSchema.safeParse({
    title: formData.get('title'),
    notes: formData.get('notes') ?? '',
    due_date: formData.get('due_date') ?? '',
    due_time: formData.get('due_time') ?? '',
    priority: formData.get('priority') ?? '4',
    project_id: formData.get('project_id') ?? '',
    content_item_id: formData.get('content_item_id') ?? '',
  });
}

function toApiPayload(parsed: z.infer<typeof TaskFormSchema>) {
  return {
    title: parsed.title,
    notes: parsed.notes || null,
    due_date: parsed.due_date || null,
    due_time: parsed.due_time || null,
    priority: parsed.priority,
    project_id: parsed.project_id || null,
    content_item_id: parsed.content_item_id || null,
  };
}

export async function updateTaskAction(
  _prev: SaveResult | null,
  formData: FormData,
): Promise<SaveResult> {
  const taskId = String(formData.get('taskId') ?? '');
  if (!taskId) return { ok: false, error: 'Missing task id.' };
  const parsed = readFormFields(formData);
  if (!parsed.success) {
    const first = parsed.error.errors[0];
    return { ok: false, error: first?.message ?? 'Invalid form' };
  }
  try {
    await tasksApi.update(taskId, toApiPayload(parsed.data));
  } catch (err) {
    if (err instanceof ApiError) {
      const body = err.body as { error?: string } | null;
      return { ok: false, error: body?.error ?? `API ${err.status}` };
    }
    return { ok: false, error: (err as Error).message };
  }
  revalidatePath('/today');
  revalidatePath('/tasks');
  revalidatePath('/projects');
  revalidatePath('/content');
  revalidatePath(`/tasks/${taskId}`);
  return { ok: true };
}

// Full create — used by /tasks/new and the content-detail inline add.
// Distinct from the simple inline create on /today so the rich form can
// set project + content_item + due date + priority in one shot.
//
// Note: redirect() must live OUTSIDE the try/catch. Next.js implements
// redirect by throwing a synthetic NEXT_REDIRECT — putting it inside try
// makes the catch block swallow it as a real error and the UI shows
// "NEXT_REDIRECT" instead of navigating.
export async function createTaskFullAction(
  _prev: SaveResult | null,
  formData: FormData,
): Promise<SaveResult> {
  const parsed = readFormFields(formData);
  if (!parsed.success) {
    const first = parsed.error.errors[0];
    return { ok: false, error: first?.message ?? 'Invalid form' };
  }
  let createdId: string;
  try {
    const created = await tasksApi.create(toApiPayload(parsed.data));
    createdId = created.id;
  } catch (err) {
    if (err instanceof ApiError) {
      const body = err.body as { error?: string } | null;
      return { ok: false, error: body?.error ?? `API ${err.status}` };
    }
    return { ok: false, error: (err as Error).message };
  }
  revalidatePath('/today');
  revalidatePath('/tasks');
  revalidatePath('/projects');
  revalidatePath('/content');
  if (parsed.data.content_item_id) revalidatePath(`/content/${parsed.data.content_item_id}`);
  redirect(`/tasks/${createdId}`);
}

export async function deleteTaskAction(formData: FormData): Promise<void> {
  const taskId = String(formData.get('taskId') ?? '');
  if (!taskId) return;
  try {
    await tasksApi.remove(taskId);
  } catch {
    /* best-effort */
  }
  revalidatePath('/today');
  revalidatePath('/tasks');
  revalidatePath('/projects');
  revalidatePath('/content');
  redirect('/today');
}
