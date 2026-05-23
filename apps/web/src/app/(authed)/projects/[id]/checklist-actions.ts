'use server';

import { revalidatePath } from 'next/cache';
import { projectsApi, ApiError } from '@/lib/api';

// Server actions for the per-project ad-hoc checklist. Mirrors the
// content-checklist actions in shape so the client section can use the
// same form-driven pattern. add returns a SaveResult so the input clears
// on success; toggle + delete are fire-and-forget.

export type SaveResult = { ok: true } | { ok: false; error: string };

export async function addChecklistItemAction(
  _prev: SaveResult | null,
  formData: FormData,
): Promise<SaveResult> {
  const projectId = String(formData.get('projectId') ?? '');
  const title = String(formData.get('title') ?? '').trim();
  if (!projectId) return { ok: false, error: 'Missing project id.' };
  if (!title) return { ok: false, error: 'Title required.' };
  try {
    await projectsApi.checklist.add(projectId, { title });
  } catch (err) {
    if (err instanceof ApiError) return { ok: false, error: `API ${err.status}` };
    return { ok: false, error: (err as Error).message };
  }
  revalidatePath(`/projects/${projectId}`);
  return { ok: true };
}

export async function toggleChecklistItemAction(formData: FormData): Promise<void> {
  const projectId = String(formData.get('projectId') ?? '');
  const itemId = String(formData.get('itemId') ?? '');
  const done = formData.get('done') === 'true';
  if (!projectId || !itemId) return;
  try {
    await projectsApi.checklist.update(projectId, itemId, { done });
  } catch {
    /* best-effort */
  }
  revalidatePath(`/projects/${projectId}`);
}

export async function deleteChecklistItemAction(formData: FormData): Promise<void> {
  const projectId = String(formData.get('projectId') ?? '');
  const itemId = String(formData.get('itemId') ?? '');
  if (!projectId || !itemId) return;
  try {
    await projectsApi.checklist.remove(projectId, itemId);
  } catch {
    /* best-effort */
  }
  revalidatePath(`/projects/${projectId}`);
}
