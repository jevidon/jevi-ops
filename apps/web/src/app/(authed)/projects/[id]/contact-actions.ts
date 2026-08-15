'use server';

import { revalidatePath } from 'next/cache';
import { projectsApi, ApiError } from '@/lib/api';

// Server actions for the project ↔ people contact join (Addendum 05).
// add returns a SaveResult so the picker can surface an error and reset
// on success; remove is fire-and-forget. Both revalidate the detail page.

export type SaveResult = { ok: true } | { ok: false; error: string };

export async function addProjectContactAction(
  _prev: SaveResult | null,
  formData: FormData,
): Promise<SaveResult> {
  const projectId = String(formData.get('projectId') ?? '');
  const personId = String(formData.get('person_id') ?? '').trim();
  const role = String(formData.get('role') ?? '').trim();
  if (!projectId) return { ok: false, error: 'Missing project id.' };
  if (!personId) return { ok: false, error: 'Pick a person.' };
  try {
    await projectsApi.contacts.add(projectId, {
      person_id: personId,
      role: role || null,
    });
  } catch (err) {
    if (err instanceof ApiError) return { ok: false, error: `API ${err.status}` };
    return { ok: false, error: (err as Error).message };
  }
  revalidatePath(`/projects/${projectId}`);
  return { ok: true };
}

export async function removeProjectContactAction(formData: FormData): Promise<void> {
  const projectId = String(formData.get('projectId') ?? '');
  const contactId = String(formData.get('contactId') ?? '');
  if (!projectId || !contactId) return;
  try {
    await projectsApi.contacts.remove(projectId, contactId);
  } catch {
    /* best-effort */
  }
  revalidatePath(`/projects/${projectId}`);
}
