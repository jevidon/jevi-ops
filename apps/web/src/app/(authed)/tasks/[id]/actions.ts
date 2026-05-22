'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { tasksApi, ApiError } from '@/lib/api';

export type SaveResult = { ok: true } | { ok: false; error: string };

const UpdateFormSchema = z.object({
  taskId: z.string().uuid(),
  title: z.string().trim().min(1, 'Title is required'),
  notes: z.string().trim(),
  due_date: z.string(), // empty string means clear
  due_time: z.string(),
  priority: z.coerce.number().int().min(1).max(4),
  project_id: z.string(), // empty string means clear
});

export async function updateTaskAction(
  _prev: SaveResult | null,
  formData: FormData,
): Promise<SaveResult> {
  const parsed = UpdateFormSchema.safeParse({
    taskId: formData.get('taskId'),
    title: formData.get('title'),
    notes: formData.get('notes') ?? '',
    due_date: formData.get('due_date') ?? '',
    due_time: formData.get('due_time') ?? '',
    priority: formData.get('priority') ?? '4',
    project_id: formData.get('project_id') ?? '',
  });
  if (!parsed.success) {
    const first = parsed.error.errors[0];
    return { ok: false, error: first?.message ?? 'Invalid form' };
  }
  const { taskId, title, notes, due_date, due_time, priority, project_id } = parsed.data;

  try {
    await tasksApi.update(taskId, {
      title,
      notes: notes || null,
      due_date: due_date || null,
      due_time: due_time || null,
      priority,
      project_id: project_id || null,
    });
  } catch (err) {
    if (err instanceof ApiError) {
      const body = err.body as { error?: string } | null;
      return { ok: false, error: body?.error ?? `API ${err.status}` };
    }
    return { ok: false, error: (err as Error).message };
  }

  revalidatePath('/today');
  revalidatePath('/projects');
  revalidatePath(`/tasks/${taskId}`);
  return { ok: true };
}

export async function deleteTaskAction(formData: FormData): Promise<void> {
  const taskId = String(formData.get('taskId') ?? '');
  if (!taskId) return;
  try {
    await tasksApi.remove(taskId);
  } catch {
    // best-effort; the redirect below will re-render and show the failure
    // state on /today only if the row stuck around
  }
  revalidatePath('/today');
  revalidatePath('/projects');
  redirect('/today');
}
