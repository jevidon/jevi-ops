import { beforeEach, expect, it, vi } from 'vitest';
import { api, ApiError } from '@/lib/api';
import { getAppTimezone } from '@/lib/app-settings';
import { deleteTaskTemplate, listTaskTemplates, loadProjectSnapshot, loadTaskTemplate, saveProjectAsTemplate, saveTaskTemplate } from './actions';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/app-settings', () => ({ getAppTimezone: vi.fn() }));
vi.mock('@/lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
  ApiError: class extends Error { constructor(public status: number, public body: unknown) { super(`API ${status}`); } },
}));
beforeEach(() => vi.resetAllMocks());
const root = { key: '00000000-0000-4000-8000-000000000001', title: 'Root', notes: 'Keep notes', parent_key: null };
const input = { name: 'Packing', entries: [root] };
const VALIDATOR_TEXT = /String must|character\(s\)|Required|Invalid/;

it('maps API validation details to written copy on individual fields, never validator text', async () => {
  vi.mocked(api.post).mockRejectedValue(new ApiError(400, { details: { name: ['String must contain at least 1 character(s)'], entries: ['String must contain at most 500 character(s)'] } }));
  const saved = await saveTaskTemplate(input);
  expect(saved).toEqual({ ok: false, error: 'Check the marked fields.', fieldErrors: {
    name: 'Enter a template name of up to 200 characters.',
    entries: 'Check the tasks. Each needs a title of up to 500 characters, and a subtask’s parent must be a task in this template.',
  } });
  expect(JSON.stringify(saved)).not.toMatch(VALIDATOR_TEXT);
});

it('rejects a whitespace-only name with written copy before calling the API', async () => {
  const template = await saveTaskTemplate({ ...input, name: '   ' });
  expect(template).toEqual({ ok: false, error: 'Check the marked fields.', fieldErrors: { name: 'Enter a template name of up to 200 characters.' } });
  expect(JSON.stringify(template)).not.toMatch(VALIDATOR_TEXT);
  expect(api.post).not.toHaveBeenCalled();
});

it('marks the specific task whose title or note is too long', async () => {
  const long = { key: '00000000-0000-4000-8000-000000000004', title: 'x'.repeat(501), notes: null, parent_key: null };
  const wordy = { key: '00000000-0000-4000-8000-000000000005', title: 'Wordy', notes: 'n'.repeat(200_001), parent_key: null };
  expect(await saveTaskTemplate({ ...input, entries: [root, long, wordy] })).toEqual({ ok: false, error: 'Check the marked fields.', fieldErrors: {
    [`entries.${long.key}`]: 'Enter a title of up to 500 characters.',
    [`entries.${wordy.key}`]: 'Shorten this note to 200,000 characters or fewer.',
  } });
  expect(api.post).not.toHaveBeenCalled();
});

it('returns the current revision for explicit conflict resolution', async () => {
  vi.mocked(api.put).mockRejectedValue(new ApiError(409, { error: 'template_changed', current_revision: 7 }));
  expect(await saveTaskTemplate({ ...input, id: 'template', revision: 6 })).toEqual({ ok: false, error: 'This template was saved in another window after you opened it. Your edits are still here.', currentRevision: 7 });
  expect(api.put).toHaveBeenCalledWith('/api/task-templates/template', { ...input, expected_revision: 6 });
});

it('drops blank tasks before schema validation and preserves children and notes', async () => {
  vi.mocked(api.post).mockResolvedValue(input);
  const blank = { key: '00000000-0000-4000-8000-000000000002', title: ' ', notes: null, parent_key: root.key };
  const child = { key: '00000000-0000-4000-8000-000000000003', title: 'Child', notes: 'Child notes', parent_key: blank.key };
  expect((await saveTaskTemplate({ ...input, entries: [root, blank, child] })).ok).toBe(true);
  expect(api.post).toHaveBeenCalledWith('/api/task-templates', { ...input, entries: [root, { ...child, parent_key: root.key }] });
  vi.mocked(api.post).mockClear();
  expect(await saveTaskTemplate({ ...input, entries: [blank] })).toMatchObject({ ok: false, error: 'Add at least one task.' });
  expect(api.post).not.toHaveBeenCalled();
});

it('refuses to drop an untitled task that has a note, and names the row', async () => {
  const noted = { key: '00000000-0000-4000-8000-000000000006', title: '  ', notes: 'Check expiry', parent_key: null };
  expect(await saveTaskTemplate({ ...input, entries: [root, noted] })).toEqual({
    ok: false, error: 'Add a title to each task that has a note, or clear the note.',
    fieldErrors: { [`entries.${noted.key}`]: 'Add a title, or clear this task’s note.' },
  });
  expect(api.post).not.toHaveBeenCalled();
});

it('loads the current saved version and handles missing templates without inventing a draft', async () => {
  const saved = { ...input, id: 'template', revision: 5 };
  vi.mocked(api.get).mockResolvedValue(saved);
  expect(await loadTaskTemplate('template')).toEqual({ ok: true, value: saved });
  expect(api.get).toHaveBeenCalledWith('/api/task-templates/template');
  vi.mocked(api.get).mockRejectedValue(new ApiError(404, { error: 'not_found' }));
  expect(await loadTaskTemplate('missing')).toEqual({ ok: false, error: 'This template is no longer available.' });
  vi.mocked(api.get).mockRejectedValue(new ApiError(500, null));
  expect(await loadTaskTemplate('template')).toEqual({ ok: false, error: 'Could not load the saved version. Your edits are still here.' });
});

it('treats an already-deleted template as deleted, and words a failed delete as a delete', async () => {
  vi.mocked(api.delete).mockResolvedValue(undefined);
  expect(await deleteTaskTemplate('template')).toEqual({ ok: true, value: null });
  expect(api.delete).toHaveBeenCalledWith('/api/task-templates/template');
  vi.mocked(api.delete).mockRejectedValue(new ApiError(404, { error: 'not_found' }));
  expect(await deleteTaskTemplate('template')).toEqual({ ok: true, value: null });
  vi.mocked(api.delete).mockRejectedValue(new ApiError(500, null));
  expect(await deleteTaskTemplate('template')).toEqual({ ok: false, error: 'Could not delete this template. Please try again.' });
});

it('reports a missing source project as a project, not a template', async () => {
  vi.mocked(api.post).mockRejectedValue(new ApiError(404, { error: 'not_found' }));
  expect(await saveProjectAsTemplate({ project_id: 'project', name: 'Packing' })).toEqual({ ok: false, error: 'This project is no longer available.' });
});

it('lists templates with each edit date formatted in the app timezone', async () => {
  vi.mocked(getAppTimezone).mockResolvedValue('America/Denver');
  // 03:30 UTC on the 13th is still the 12th in Denver.
  const templates = [{ ...input, id: 'a', revision: 1, created_at: '', updated_at: `${new Date().getUTCFullYear()}-10-13T03:30:00Z` }];
  vi.mocked(api.get).mockResolvedValue({ templates });
  expect(await listTaskTemplates()).toEqual({ ok: true, value: { templates, edited: { a: 'Oct 12' } } });
  vi.mocked(api.get).mockRejectedValue(new ApiError(500, null));
  expect(await listTaskTemplates()).toEqual({ ok: false, error: 'Could not load your templates. Please try again.' });
});

it('reads a project snapshot and explains each reason it cannot', async () => {
  vi.mocked(api.get).mockResolvedValue({ entries: [root] });
  expect(await loadProjectSnapshot('project')).toEqual({ ok: true, value: [root] });
  expect(api.get).toHaveBeenCalledWith('/api/projects/project/task-template-snapshot');
  const refusal = async (status: number, body: unknown) => { vi.mocked(api.get).mockRejectedValue(new ApiError(status, body)); return (await loadProjectSnapshot('project') as { error: string }).error; };
  expect(await refusal(400, { error: 'empty_project' })).toBe('Add at least one task to this project before saving a template.');
  expect(await refusal(400, { error: 'too_many_tasks' })).toBe('Templates support up to 200 tasks. This project has more than that; nothing was changed.');
  expect(await refusal(400, { error: 'invalid_source_tasks' })).toBe('Check task titles (up to 500 characters), notes (up to 200,000 characters), and parent relationships. Nothing was changed.');
  expect(await refusal(404, { error: 'not_found' })).toBe('This project is no longer available.');
  expect(await refusal(500, null)).toBe('Could not read this project’s tasks. Please try again.');
  // Saving as new keeps its own wording for the same refusals.
  vi.mocked(api.post).mockRejectedValue(new ApiError(400, { error: 'too_many_tasks' }));
  expect(await saveProjectAsTemplate({ project_id: 'project', name: 'Packing' })).toEqual({ ok: false, error: 'Templates support up to 200 tasks. This project has more than that; no template was created.' });
});
