'use server';

import { revalidatePath } from 'next/cache';
import { api, ApiError } from '@/lib/api';
import { ProjectFromTemplateSchema, TaskTemplateInputSchema, type TaskTemplate, type TaskTemplateEntry } from '@jevi-ops/shared';
import { withoutBlankTasks } from './template-draft';

export type ActionFailure = { ok: false; error: string; fieldErrors?: Record<string, string>; currentRevision?: number };
type Result<T> = { ok: true; value: T } | ActionFailure;

function invalidFields(details: Record<string, string[] | undefined>): ActionFailure {
  const fieldErrors = Object.fromEntries(Object.entries(details).filter(([, messages]) => messages?.length).map(([field, messages]) => [field, messages!.join(' ')]));
  return { ok: false, error: 'Check the highlighted fields.', fieldErrors };
}

function failure(error: unknown): ActionFailure {
  if (error instanceof ApiError) {
    const body = error.body as { current_revision?: number; details?: Record<string, string[]> } | null;
    if (error.status === 409 && Number.isInteger(body?.current_revision)) return {
      ok: false, error: 'This template was saved in another window after you opened it. Your edits are still here.', currentRevision: body!.current_revision,
    };
    if (error.status === 404) return { ok: false, error: 'This template is no longer available.' };
    if (error.status === 400 && body?.details) return invalidFields(body.details);
    if (error.status === 400) return { ok: false, error: 'Could not save these changes. Please check your entries and try again.' };
  }
  return { ok: false, error: 'Could not save. Your entries are still here; please try again.' };
}

export async function saveTaskTemplate(input: { id?: string; revision?: number; name: string; entries: TaskTemplateEntry[] }): Promise<Result<TaskTemplate>> {
  const entries = withoutBlankTasks(input.entries);
  if (!entries.length) return { ok: false, error: 'Add at least one task.', fieldErrors: { entries: 'Add at least one task.' } };
  const parsed = TaskTemplateInputSchema.safeParse({ name: input.name, entries });
  if (!parsed.success) return invalidFields(parsed.error.flatten().fieldErrors);
  try {
    const template = input.id
      ? await api.put<TaskTemplate>(`/api/task-templates/${encodeURIComponent(input.id)}`, { ...parsed.data, expected_revision: input.revision })
      : await api.post<TaskTemplate>('/api/task-templates', parsed.data);
    revalidatePath('/task-templates');
    revalidatePath('/work');
    return { ok: true, value: template };
  } catch (error) { return failure(error); }
}

export async function loadTaskTemplate(id: string): Promise<Result<TaskTemplate>> {
  try {
    const { templates } = await api.get<{ templates: TaskTemplate[] }>('/api/task-templates');
    const template = templates.find(template => template.id === id);
    return template ? { ok: true, value: template } : { ok: false, error: 'This template is no longer available.' };
  } catch (error) { return failure(error); }
}

export async function deleteTaskTemplate(id: string): Promise<Result<null>> {
  try {
    await api.delete(`/api/task-templates/${encodeURIComponent(id)}`);
    revalidatePath('/task-templates');
    revalidatePath('/work');
    return { ok: true, value: null };
  } catch (error) { return failure(error); }
}

export async function createProjectFromTemplate(input: { template_id: string; name: string; domain_id: string }): Promise<Result<{ id: string }>> {
  const parsed = ProjectFromTemplateSchema.safeParse({ name: input.name, domain_id: input.domain_id || null });
  if (!parsed.success) return invalidFields(parsed.error.flatten().fieldErrors);
  try {
    const project = await api.post<{ id: string }>(`/api/task-templates/${encodeURIComponent(input.template_id)}/projects`, parsed.data);
    revalidatePath('/work');
    revalidatePath('/tasks');
    revalidatePath('/');
    if (input.domain_id) revalidatePath(`/domains/${input.domain_id}`);
    return { ok: true, value: { id: project.id } };
  } catch (error) { return failure(error); }
}

export async function saveProjectAsTemplate(input: { project_id: string; name: string }): Promise<Result<TaskTemplate>> {
  const name = input.name.trim();
  if (!name || name.length > 200) return { ok: false, error: 'Enter a template name of up to 200 characters.' };
  try {
    const template = await api.post<TaskTemplate>(`/api/projects/${encodeURIComponent(input.project_id)}/task-template`, { name });
    revalidatePath('/task-templates');
    revalidatePath('/work');
    return { ok: true, value: template };
  } catch (error) {
    if (error instanceof ApiError && error.status === 400) {
      const code = (error.body as { error?: string } | null)?.error;
      if (code === 'empty_project') return { ok: false, error: 'Add at least one task to this project before saving a template.' };
      if (code === 'too_many_tasks') return { ok: false, error: 'Templates support up to 200 tasks. This project has more than that; no template was created.' };
      if (code === 'invalid_source_tasks') return { ok: false, error: 'Check task titles (up to 500 characters), notes (up to 200,000 characters), and parent relationships. No template was created.' };
    }
    return failure(error);
  }
}
