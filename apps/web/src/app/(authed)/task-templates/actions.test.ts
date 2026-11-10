import { beforeEach, expect, it, vi } from 'vitest';
import { api, ApiError } from '@/lib/api';
import { createProjectFromTemplate, deleteTaskTemplate, loadTaskTemplate, saveProjectAsTemplate, saveTaskTemplate } from './actions';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
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
  vi.mocked(api.post).mockRejectedValue(new ApiError(400, { details: { domain_id: ['Invalid uuid'] } }));
  expect(await createProjectFromTemplate({ template_id: 'template', name: 'Trip', domain_id: '' })).toEqual({ ok: false, error: 'Check the marked fields.', fieldErrors: { domain_id: 'Choose an available domain.' } });
});

it('rejects whitespace-only names with written copy before calling the API', async () => {
  const template = await saveTaskTemplate({ ...input, name: '   ' });
  expect(template).toEqual({ ok: false, error: 'Check the marked fields.', fieldErrors: { name: 'Enter a template name of up to 200 characters.' } });
  const project = await createProjectFromTemplate({ template_id: 'template', name: '   ', domain_id: '' });
  expect(project).toEqual({ ok: false, error: 'Check the marked fields.', fieldErrors: { name: 'Enter a project name of up to 200 characters.' } });
  expect(JSON.stringify([template, project])).not.toMatch(VALIDATOR_TEXT);
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
  vi.mocked(api.get).mockResolvedValue({ templates: [saved] });
  expect(await loadTaskTemplate('template')).toEqual({ ok: true, value: saved });
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

it('words create-project failures as creation and marks an unavailable domain', async () => {
  const create = () => createProjectFromTemplate({ template_id: 'template', name: 'Trip', domain_id: '00000000-0000-4000-8000-000000000009' });
  vi.mocked(api.post).mockRejectedValue(new ApiError(500, null));
  expect(await create()).toEqual({ ok: false, error: 'Could not create the project. Your entries are still here; please try again.' });
  vi.mocked(api.post).mockRejectedValue(new ApiError(400, { error: 'domain_not_found' }));
  expect(await create()).toEqual({ ok: false, error: 'Check the marked fields.', fieldErrors: { domain_id: 'That domain is no longer available. Choose another.' } });
  vi.mocked(api.post).mockRejectedValue(new ApiError(404, { error: 'not_found' }));
  expect(await create()).toEqual({ ok: false, error: 'This template is no longer available.' });
});

it('reports a missing source project as a project, not a template', async () => {
  vi.mocked(api.post).mockRejectedValue(new ApiError(404, { error: 'not_found' }));
  expect(await saveProjectAsTemplate({ project_id: 'project', name: 'Packing' })).toEqual({ ok: false, error: 'This project is no longer available.' });
});
