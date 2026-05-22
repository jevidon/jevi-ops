'use server';

import { revalidatePath } from 'next/cache';
import { api, ApiError } from '@/lib/api';
import type { Project } from '@jerad-ops/shared';

export async function setProjectColorAction(formData: FormData) {
  const projectId = String(formData.get('projectId') ?? '');
  const color = String(formData.get('color') ?? '');
  if (!projectId) return;

  try {
    // The shared PATCH /api/projects/:id endpoint accepts a color field on
    // the body (UpdateProjectSchema). Empty string = clear.
    await api.patch<Project>(`/api/projects/${projectId}`, {
      color: color || null,
    });
  } catch (err) {
    // best-effort; revalidate so the page re-renders even if the patch errored
    // eslint-disable-next-line no-console
    console.warn('setProjectColor failed:', err instanceof ApiError ? err.status : err);
  }
  revalidatePath(`/projects/${projectId}`);
  revalidatePath('/projects');
  revalidatePath('/today');
  revalidatePath('/tasks');
  revalidatePath('/calendar');
}
