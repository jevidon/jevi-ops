import { beforeEach, expect, it, vi } from 'vitest';
import { api, ApiError } from '@/lib/api';
import { createProjectFromTemplate, deleteTaskTemplate, loadTaskTemplate, saveTaskTemplate } from './actions';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
  ApiError: class extends Error { constructor(public status: number, public body: unknown) { super(`API ${status}`); } },
}));
beforeEach(() => vi.resetAllMocks());
const root = { key: '00000000-0000-4000-8000-000000000001', title: 'Root', notes: 'Keep notes', parent_key: null };
const input = { name: 'Packing', entries: [root] };

it('maps API validation details to individual fields', async () => {
  vi.mocked(api.post).mockRejectedValue(new ApiError(400, { details: { name: ['Name rejected'], entries: ['Task rejected'] } }));
  expect(await saveTaskTemplate(input)).toEqual({ ok: false, error: 'Check the highlighted fields.', fieldErrors: { name: 'Name rejected', entries: 'Task rejected' } });
  vi.mocked(api.post).mockRejectedValue(new ApiError(400, { details: { domain_id: ['Choose an available domain'] } }));
  expect(await createProjectFromTemplate({ template_id: 'template', name: 'Trip', domain_id: '' })).toMatchObject({ ok: false, fieldErrors: { domain_id: 'Choose an available domain' } });
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

it('loads the current saved version and handles missing templates without inventing a draft', async () => {
  const saved = { ...input, id: 'template', revision: 5 };
  vi.mocked(api.get).mockResolvedValue({ templates: [saved] });
  expect(await loadTaskTemplate('template')).toEqual({ ok: true, value: saved });
  expect(await loadTaskTemplate('missing')).toEqual({ ok: false, error: 'This template is no longer available.' });
});

it('handles empty delete responses and reports a missing template', async () => {
  vi.mocked(api.delete).mockResolvedValue(undefined);
  expect(await deleteTaskTemplate('template')).toEqual({ ok: true, value: null });
  expect(api.delete).toHaveBeenCalledWith('/api/task-templates/template');
  vi.mocked(api.delete).mockRejectedValue(new ApiError(404, { error: 'not_found' }));
  expect(await deleteTaskTemplate('template')).toEqual({ ok: false, error: 'This template is no longer available.' });
});
