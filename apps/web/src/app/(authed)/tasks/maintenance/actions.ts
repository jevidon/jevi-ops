'use server';

import { revalidatePath } from 'next/cache';
import { tasksApi } from '@/lib/api';

// Completing a maintenance task rolls it forward server-side (recurring
// tasks flip back to open with the next due date instead of closing) —
// this action just sends the "done" and refreshes the audit view.
export async function completeMaintenanceTaskAction(formData: FormData) {
  const taskId = String(formData.get('taskId') ?? '');
  if (!taskId) return;
  try {
    await tasksApi.update(taskId, { status: 'done' });
  } catch {
    // Best-effort; UI will reload on next request and reflect reality.
  }
  revalidatePath('/tasks/maintenance');
}
