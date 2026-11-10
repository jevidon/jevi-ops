'use server';

import { revalidatePath } from 'next/cache';
import { api, ApiError } from '@/lib/api';
import { ProjectFromTemplateSchema, TaskTemplateInputSchema, type TaskTemplate, type TaskTemplateEntry } from '@jevi-ops/shared';
import { entryField, untitledWithNotes, withoutBlankTasks, UNTITLED_NOTE_ERROR, UNTITLED_NOTE_FIELD_ERROR } from './template-draft';

export type ActionFailure = { ok: false; error: string; fieldErrors?: Record<string, string>; currentRevision?: number };
type Result<T> = { ok: true; value: T } | ActionFailure;
type FieldCopy = Record<string, string>;

// Written copy per field. Validator text ("String must contain at least 1
// character(s)") never reaches the screen, whether it comes from the local
// parse or from the API's `details`.
const TEMPLATE_COPY: FieldCopy = {
  name: 'Enter a template name of up to 200 characters.',
  entries: 'Check the tasks. Each needs a title of up to 500 characters, and a subtask’s parent must be a task in this template.',
};
const PROJECT_COPY: FieldCopy = {
  name: 'Enter a project name of up to 200 characters.',
  domain_id: 'Choose an available domain.',
};
const SAVE_FAILED = 'Could not save. Your entries are still here; please try again.';
const LOAD_FAILED = 'Could not load the saved version. Your edits are still here.';
const DELETE_FAILED = 'Could not delete this template. Please try again.';
const CREATE_FAILED = 'Could not create the project. Your entries are still here; please try again.';

const marked = (fieldErrors: Record<string, string>): ActionFailure => ({ ok: false, error: 'Check the marked fields.', fieldErrors });

function invalidFields(fields: string[], copy: FieldCopy): ActionFailure | null {
  const fieldErrors = Object.fromEntries(fields.filter(field => copy[field]).map(field => [field, copy[field]!]));
  return Object.keys(fieldErrors).length ? marked(fieldErrors) : null;
}

function failure(error: unknown, fallback: string, copy: FieldCopy = {}): ActionFailure {
  if (error instanceof ApiError) {
    const body = error.body as { error?: string; current_revision?: number; details?: Record<string, string[] | undefined> } | null;
    if (error.status === 409 && Number.isInteger(body?.current_revision)) return {
      ok: false, error: 'This template was saved in another window after you opened it. Your edits are still here.', currentRevision: body!.current_revision,
    };
    if (error.status === 404) return { ok: false, error: 'This template is no longer available.' };
    if (error.status === 400 && body?.error === 'domain_not_found') return marked({ domain_id: 'That domain is no longer available. Choose another.' });
    if (error.status === 400 && body?.details) {
      const fields = Object.entries(body.details).filter(([, messages]) => messages?.length).map(([field]) => field);
      const invalid = invalidFields(fields, copy);
      if (invalid) return invalid;
    }
  }
  return { ok: false, error: fallback };
}

export async function saveTaskTemplate(input: { id?: string; revision?: number; name: string; entries: TaskTemplateEntry[] }): Promise<Result<TaskTemplate>> {
  // A note without a title would vanish with the blank rows below. Stop and
  // point at the row instead of discarding what was written.
  const orphaned = untitledWithNotes(input.entries);
  if (orphaned.length) return {
    ok: false, error: UNTITLED_NOTE_ERROR, fieldErrors: Object.fromEntries(orphaned.map(entry => [entryField(entry.key), UNTITLED_NOTE_FIELD_ERROR])),
  };
  const entries = withoutBlankTasks(input.entries);
  if (!entries.length) return { ok: false, error: 'Add at least one task.', fieldErrors: { entries: 'Add at least one task.' } };
  const parsed = TaskTemplateInputSchema.safeParse({ name: input.name, entries });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const [field, index, property] = issue.path;
      const entry = typeof index === 'number' ? entries[index] : undefined;
      if (field === 'name') fieldErrors.name = TEMPLATE_COPY.name!;
      else if (field === 'entries' && entry) fieldErrors[entryField(entry.key)] ??= property === 'notes'
        ? 'Shorten this note to 200,000 characters or fewer.' : 'Enter a title of up to 500 characters.';
      else if (field === 'entries') fieldErrors.entries ??= issue.code === 'too_big' ? 'Templates support up to 200 tasks.' : TEMPLATE_COPY.entries!;
    }
    return Object.keys(fieldErrors).length ? marked(fieldErrors) : { ok: false, error: SAVE_FAILED };
  }
  try {
    const template = input.id
      ? await api.put<TaskTemplate>(`/api/task-templates/${encodeURIComponent(input.id)}`, { ...parsed.data, expected_revision: input.revision })
      : await api.post<TaskTemplate>('/api/task-templates', parsed.data);
    revalidatePath('/task-templates');
    revalidatePath('/work');
    return { ok: true, value: template };
  } catch (error) { return failure(error, SAVE_FAILED, TEMPLATE_COPY); }
}

export async function loadTaskTemplate(id: string): Promise<Result<TaskTemplate>> {
  try {
    const { templates } = await api.get<{ templates: TaskTemplate[] }>('/api/task-templates');
    const template = templates.find(template => template.id === id);
    return template ? { ok: true, value: template } : { ok: false, error: 'This template is no longer available.' };
  } catch (error) { return failure(error, LOAD_FAILED); }
}

export async function deleteTaskTemplate(id: string): Promise<Result<null>> {
  try {
    await api.delete(`/api/task-templates/${encodeURIComponent(id)}`);
  } catch (error) {
    // Already deleted elsewhere is the outcome that was asked for: report
    // success so the stale row leaves the list instead of lingering.
    if (!(error instanceof ApiError && error.status === 404)) return failure(error, DELETE_FAILED);
  }
  revalidatePath('/task-templates');
  revalidatePath('/work');
  return { ok: true, value: null };
}

export async function createProjectFromTemplate(input: { template_id: string; name: string; domain_id: string }): Promise<Result<{ id: string }>> {
  const parsed = ProjectFromTemplateSchema.safeParse({ name: input.name, domain_id: input.domain_id || null });
  if (!parsed.success) {
    return invalidFields(Object.keys(parsed.error.flatten().fieldErrors), PROJECT_COPY) ?? { ok: false, error: CREATE_FAILED };
  }
  try {
    const project = await api.post<{ id: string }>(`/api/task-templates/${encodeURIComponent(input.template_id)}/projects`, parsed.data);
    revalidatePath('/work');
    revalidatePath('/tasks');
    revalidatePath('/');
    if (input.domain_id) revalidatePath(`/domains/${input.domain_id}`);
    return { ok: true, value: { id: project.id } };
  } catch (error) { return failure(error, CREATE_FAILED, PROJECT_COPY); }
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
    // Here a 404 means the source project is gone, not a template.
    if (error instanceof ApiError && error.status === 404) return { ok: false, error: 'This project is no longer available.' };
    return failure(error, 'Could not save the template. Please try again.', TEMPLATE_COPY);
  }
}
