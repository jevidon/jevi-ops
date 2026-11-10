'use server';

import { revalidatePath } from 'next/cache';
import { api, ApiError } from '@/lib/api';
import { ProjectFromTemplateSchema, TaskTemplateInputSchema, type TaskTemplate, type TaskTemplateEntry } from '@jevi-ops/shared';

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 409) return 'This template changed in another window. Reload the page before editing it again; your unsaved text is still here.';
    if (error.status === 404) return 'This template is no longer available. Reload the page to see current templates.';
    if (error.status === 400) return 'Check the template, project name, and selected domain, then try again.';
  }
  return 'Could not save. Your entries are still here; please try again.';
}

export async function saveTaskTemplate(input: { id?: string; revision?: number; name: string; entries: TaskTemplateEntry[] }): Promise<Result<TaskTemplate>> {
  const parsed = TaskTemplateInputSchema.safeParse({ name: input.name, entries: input.entries });
  if (!parsed.success) return { ok: false, error: 'Enter a template name (up to 200 characters) and 1–200 tasks (up to 500 characters each).' };
  try {
    const template = input.id
      ? await api.put<TaskTemplate>(`/api/task-templates/${encodeURIComponent(input.id)}`, { ...parsed.data, expected_revision: input.revision })
      : await api.post<TaskTemplate>('/api/task-templates', parsed.data);
    revalidatePath('/task-templates');
    return { ok: true, value: template };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

export async function createProjectFromTemplate(input: { template_id: string; name: string; domain_id: string }): Promise<Result<{ id: string }>> {
  const parsed = ProjectFromTemplateSchema.safeParse({ name: input.name, domain_id: input.domain_id || null });
  if (!parsed.success) return { ok: false, error: 'Enter a project name (up to 200 characters) and select a valid domain.' };
  try {
    const project = await api.post<{ id: string }>(`/api/task-templates/${encodeURIComponent(input.template_id)}/projects`, parsed.data);
    revalidatePath('/work');
    revalidatePath('/tasks');
    revalidatePath('/');
    if (input.domain_id) revalidatePath(`/domains/${input.domain_id}`);
    return { ok: true, value: { id: project.id } };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

export async function saveProjectAsTemplate(input: { project_id: string; name: string }): Promise<Result<TaskTemplate>> {
  const name = input.name.trim();
  if (!name || name.length > 200) return { ok: false, error: 'Enter a template name of up to 200 characters.' };
  try {
    const template = await api.post<TaskTemplate>(`/api/projects/${encodeURIComponent(input.project_id)}/task-template`, { name });
    revalidatePath('/task-templates');
    return { ok: true, value: template };
  } catch (error) {
    if (error instanceof ApiError && error.status === 400) {
      const code = (error.body as { error?: string } | null)?.error;
      if (code === 'empty_project') return { ok: false, error: 'Add at least one task to this project before saving a template.' };
      if (code === 'too_many_tasks') return { ok: false, error: 'Templates support up to 200 tasks. This project has more than that; no template was created.' };
      if (code === 'invalid_source_tasks') return { ok: false, error: 'Check task titles (up to 500 characters), notes (up to 200,000 characters), and parent relationships. No template was created.' };
    }
    return { ok: false, error: errorMessage(error) };
  }
}
