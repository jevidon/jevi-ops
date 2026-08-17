'use server';

import { revalidatePath } from 'next/cache';
import { tasksApi, ApiError } from '@/lib/api';

// Shared quick-add server action (Wave 2 #2) — title-only task capture into a
// domain or project context, used by QuickAddTask wherever it's mounted (Work
// page sections, domain detail, project detail). The full editor stays the
// place for dates/priority/notes; this is pure capture.

// Success carries the created id so the client can offer a "View task" jump.
export type QuickAddResult = { ok: true; id: string } | { ok: false; error: string };

export async function quickAddTaskAction(
  _prev: QuickAddResult | null,
  formData: FormData,
): Promise<QuickAddResult> {
  const title = String(formData.get('title') ?? '').trim();
  if (!title) return { ok: false, error: 'Title is required.' };

  const project_id = String(formData.get('project_id') ?? '').trim() || null;
  const domain_id = String(formData.get('domain_id') ?? '').trim() || null;
  if (!project_id && !domain_id) return { ok: false, error: 'Missing target.' };

  let createdId: string;
  try {
    // When project_id is set the server derives domain_id from the project,
    // so send exactly one — both at once 400s on a mismatch.
    const created = await tasksApi.create({
      title,
      ...(project_id ? { project_id } : { domain_id }),
      priority: 4,
      source: 'manual',
    });
    createdId = created.id;
  } catch (err) {
    if (err instanceof ApiError) return { ok: false, error: `API ${err.status}` };
    return { ok: false, error: (err as Error).message };
  }

  // Every surface that rolls up open-task counts reads from tasks.
  revalidatePath('/work');
  revalidatePath('/today');
  revalidatePath('/tasks');
  if (domain_id) revalidatePath(`/domains/${domain_id}`);
  if (project_id) revalidatePath(`/projects/${project_id}`);
  return { ok: true, id: createdId };
}
