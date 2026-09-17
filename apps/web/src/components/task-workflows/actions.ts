'use server';
import { revalidatePath } from 'next/cache';
import { api, ApiError } from '@/lib/api';
import { maintenanceDetailsHref } from '@/lib/needs-details';
import type { TaskWorkflow, WorkflowScope } from '@jevi-ops/shared';

type Result = { error?: string; detailsHref?: string; ok?: boolean };
function failure(err: unknown): Result {
  const detailsHref = maintenanceDetailsHref(err);
  if (detailsHref) return { error: 'This task needs maintenance details before it can be completed.', detailsHref };
  if (err instanceof ApiError && typeof err.body === 'object' && err.body) {
    const body = err.body as { message?: string; error?: string };
    return { error: body.message ?? body.error ?? 'Could not save the change.' };
  }
  return { error: 'Could not save the change. Please try again.' };
}
export async function changeWorkflowStatus(taskId: string, statusId: string, revision: number): Promise<Result> {
  try {
    await api.patch(`/api/tasks/${taskId}`, { workflow_status_id: statusId, workflow_revision: revision });
  } catch (err) { return failure(err); }
  revalidatePath('/', 'layout');
  return { ok: true };
}
export async function configureWorkflow(scope: WorkflowScope, id: string, definition: TaskWorkflow | null, revision: number): Promise<Result> {
  try { await api.put(`/api/task-workflows/${scope}/${id}`, { definition, expected_revision: revision }); }
  catch (err) { return failure(err); }
  revalidatePath('/', 'layout');
  return { ok: true };
}
export async function saveWorkflowPreset(name: string, definition: TaskWorkflow): Promise<Result> {
  try { await api.post('/api/task-workflow-presets', { name, definition }); }
  catch (err) { return failure(err); }
  revalidatePath('/', 'layout');
  return { ok: true };
}
export async function deleteWorkflowPreset(id: string): Promise<Result> {
  try { await api.delete(`/api/task-workflow-presets/${id}`); }
  catch (err) { return failure(err); }
  revalidatePath('/', 'layout');
  return { ok: true };
}
