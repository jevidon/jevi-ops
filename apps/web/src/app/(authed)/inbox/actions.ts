'use server';

import { revalidatePath } from 'next/cache';
import { tasksApi, ApiError } from '@/lib/api';

export type TriageResult = { ok: true } | { ok: false; error: string };

// Decode the picker's selection ("domain:<uuid>" / "project:<uuid>") into
// the API payload and send it. The task's domain_id/project_id are both
// passed so the server can re-resolve cleanly — see /apps/api/src/routes/
// tasks.ts resolveTaskDomain() for the rules.
function decodeSelection(raw: string): { domain_id: string | null; project_id: string | null } | null {
  if (raw.startsWith('domain:')) {
    const id = raw.slice('domain:'.length);
    return id ? { domain_id: id, project_id: null } : null;
  }
  if (raw.startsWith('project:')) {
    const id = raw.slice('project:'.length);
    return id ? { domain_id: null, project_id: id } : null;
  }
  return null;
}

export async function triageTaskAction(
  _prev: TriageResult | null,
  formData: FormData,
): Promise<TriageResult> {
  const taskId = String(formData.get('taskId') ?? '');
  const selection = String(formData.get('selection') ?? '');
  if (!taskId) return { ok: false, error: 'Missing task id.' };
  const decoded = decodeSelection(selection);
  if (!decoded) return { ok: false, error: 'Pick a destination first.' };

  try {
    await tasksApi.update(taskId, decoded);
  } catch (err) {
    if (err instanceof ApiError) {
      const body = err.body as { error?: string } | null;
      return { ok: false, error: body?.error ?? `API ${err.status}` };
    }
    return { ok: false, error: (err as Error).message };
  }

  revalidatePath('/inbox');
  revalidatePath('/today');
  revalidatePath('/tasks');
  return { ok: true };
}
