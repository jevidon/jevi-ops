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

// One-tap status change. The full edit form still exposes status as a
// dropdown, but burying status three clicks deep meant users couldn't
// find it. Surfacing it as a chip row near the header makes the lifecycle
// (active → done / archived) a visible affordance.
const VALID_STATUSES = ['active', 'paused', 'done', 'archived'] as const;
type ProjectStatus = (typeof VALID_STATUSES)[number];

export async function setProjectStatusAction(formData: FormData) {
  const projectId = String(formData.get('projectId') ?? '');
  const raw = String(formData.get('status') ?? '');
  if (!projectId) return;
  if (!(VALID_STATUSES as readonly string[]).includes(raw)) return;
  const status = raw as ProjectStatus;

  try {
    const patch: Record<string, unknown> = { status };
    // Setting status='done' also stamps completed_at server-side via the
    // PATCH endpoint. Same for moving back to 'active' — completed_at
    // gets cleared so analytics don't see a stale finish on a row that's
    // back in flight. The shared schema accepts both; we don't override
    // here.
    await api.patch<Project>(`/api/projects/${projectId}`, patch);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('setProjectStatus failed:', err instanceof ApiError ? err.status : err);
  }
  revalidatePath(`/projects/${projectId}`);
  revalidatePath('/projects');
  revalidatePath('/today');
  revalidatePath('/tasks');
  revalidatePath('/domains');
}
