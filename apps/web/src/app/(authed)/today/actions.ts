'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { tasksApi, observationsApi, ApiError } from '@/lib/api';
import { todayIsoDate } from '@/lib/today';

const CreateTaskFormSchema = z.object({
  title: z.string().trim().min(1),
});

export async function createTaskAction(_prev: { error?: string } | null, formData: FormData) {
  const parsed = CreateTaskFormSchema.safeParse({ title: formData.get('title') });
  if (!parsed.success) {
    return { error: 'Title is required.' };
  }
  try {
    await tasksApi.create({
      title: parsed.data.title,
      priority: 4,
      source: 'manual',
    });
  } catch (err) {
    return { error: err instanceof ApiError ? `API ${err.status}` : (err as Error).message };
  }
  revalidatePath('/today');
  return {};
}

export async function toggleTaskDoneAction(formData: FormData) {
  const taskId = String(formData.get('taskId') ?? '');
  const currentStatus = String(formData.get('status') ?? 'open');
  if (!taskId) return;
  try {
    await tasksApi.update(taskId, {
      status: currentStatus === 'done' ? 'open' : 'done',
    });
  } catch {
    // Best-effort; UI will reload on next request and reflect reality.
  }
  revalidatePath('/today');
}

export async function toggleTop3Action(formData: FormData) {
  const taskId = String(formData.get('taskId') ?? '');
  const currentlyTop3 = formData.get('isTop3') === 'true';
  if (!taskId) return;
  try {
    await tasksApi.update(taskId, {
      // Set to today's date to mark; null to unmark.
      top3_for_date: currentlyTop3 ? null : todayIsoDate(),
    } as Parameters<typeof tasksApi.update>[1]);
  } catch {
    // ignore — revalidate will resync
  }
  revalidatePath('/today');
}

export async function dismissObservationAction(formData: FormData) {
  const id = String(formData.get('id') ?? '');
  if (!id) return;
  try {
    await observationsApi.dismiss(id);
  } catch {
    /* best-effort */
  }
  revalidatePath('/today');
  revalidatePath('/observations');
}
