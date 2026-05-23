'use server';

import { revalidatePath } from 'next/cache';
import { projectsApi } from '@/lib/api';

// Server actions for the project-detail milestones section. Each takes a
// FormData with `project_id` and either `milestone_id` (for edit/toggle/
// delete) or just the project_id (for add). Failures are swallowed —
// network blips shouldn't strand a half-checked milestone; the next
// revalidate will show real state.

export async function addMilestoneAction(formData: FormData): Promise<void> {
  const projectId = String(formData.get('project_id') ?? '');
  const title = String(formData.get('title') ?? '').trim();
  const weightRaw = String(formData.get('weight') ?? '1').trim();
  const weight = Math.max(1, parseInt(weightRaw, 10) || 1);
  if (!projectId || !title) return;
  try {
    await projectsApi.milestones.create(projectId, { title, weight });
  } catch {
    /* best-effort */
  }
  revalidatePath(`/projects/${projectId}`);
  revalidatePath('/projects');
}

export async function toggleMilestoneAction(formData: FormData): Promise<void> {
  const projectId = String(formData.get('project_id') ?? '');
  const milestoneId = String(formData.get('milestone_id') ?? '');
  const nextStatus = (String(formData.get('next_status') ?? '') as 'open' | 'done') || 'done';
  if (!projectId || !milestoneId) return;
  try {
    await projectsApi.milestones.update(projectId, milestoneId, { status: nextStatus });
  } catch {
    /* best-effort */
  }
  revalidatePath(`/projects/${projectId}`);
  revalidatePath('/projects');
}

export async function updateMilestoneAction(formData: FormData): Promise<void> {
  const projectId = String(formData.get('project_id') ?? '');
  const milestoneId = String(formData.get('milestone_id') ?? '');
  const title = String(formData.get('title') ?? '').trim();
  const weightRaw = String(formData.get('weight') ?? '').trim();
  if (!projectId || !milestoneId) return;
  const update: { title?: string; weight?: number } = {};
  if (title) update.title = title;
  if (weightRaw) {
    const w = Math.max(1, parseInt(weightRaw, 10) || 1);
    update.weight = w;
  }
  if (Object.keys(update).length === 0) return;
  try {
    await projectsApi.milestones.update(projectId, milestoneId, update);
  } catch {
    /* best-effort */
  }
  revalidatePath(`/projects/${projectId}`);
  revalidatePath('/projects');
}

export async function deleteMilestoneAction(formData: FormData): Promise<void> {
  const projectId = String(formData.get('project_id') ?? '');
  const milestoneId = String(formData.get('milestone_id') ?? '');
  if (!projectId || !milestoneId) return;
  try {
    await projectsApi.milestones.remove(projectId, milestoneId);
  } catch {
    /* best-effort */
  }
  revalidatePath(`/projects/${projectId}`);
  revalidatePath('/projects');
}
