import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteTaskAction, updateTaskAction } from './actions';

const mocks = vi.hoisted(() => ({
  getTask: vi.fn(), remove: vi.fn(), update: vi.fn(), project: vi.fn(), domain: vi.fn(), content: vi.fn(), asset: vi.fn(),
  revalidatePath: vi.fn(), redirect: vi.fn(),
  ApiError: class extends Error { constructor(public status: number, public body: unknown) { super('API failed'); } },
}));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('@/lib/api', () => ({
  tasksApi: { get: mocks.getTask, remove: mocks.remove, update: mocks.update },
  projectsApi: { get: mocks.project }, domainsApi: { get: mocks.domain }, contentApi: { get: mocks.content }, assetsApi: { get: mocks.asset }, ApiError: mocks.ApiError,
}));
beforeEach(() => {
  vi.resetAllMocks();
  mocks.getTask.mockResolvedValue({ id: 'task', project_id: 'project', domain_id: 'domain', parent_task_id: null });
  mocks.project.mockResolvedValue({ id: 'project' });
  mocks.domain.mockResolvedValue({ id: 'domain' });
});
function deletion(origin?: string) {
  const data = new FormData(); data.set('taskId', 'task');
  if (origin) data.set('returnTo', origin);
  return deleteTaskAction(data);
}

describe('task editor deletion', () => {
  it('keeps failed deletions in the editor without redirecting or reporting success', async () => {
    mocks.remove.mockRejectedValue(new mocks.ApiError(409, { error: 'Task has dependent work.' }));
    expect(await deletion('/projects/project')).toEqual({ ok: false, error: 'Task has dependent work.' });
    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
  it('returns to the actual origin rather than Home or the parent by default', async () => {
    expect(await deletion('/search?q=brakes#results')).toEqual({ ok: true, redirectTo: '/search?q=brakes#results' });
    expect(mocks.remove).toHaveBeenCalledTimes(1);
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
  it('uses a valid parent for direct entry and rejects external or deleted origins', async () => {
    expect(await deletion('//evil.example')).toEqual({ ok: true, redirectTo: '/projects/project' });
    expect(await deletion('/tasks/task')).toEqual({ ok: true, redirectTo: '/projects/project' });
  });
  it('skips unavailable parents and ends on the Tasks list, never Home', async () => {
    mocks.project.mockRejectedValue(new Error('gone')); mocks.domain.mockRejectedValue(new Error('gone'));
    expect(await deletion('/projects/missing')).toEqual({ ok: true, redirectTo: '/tasks' });
  });
  it('refreshes task, calendar and record collections after success', async () => {
    await deletion('/');
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/calendar');
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/projects/[id]', 'page');
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/domains/[id]', 'page');
  });
  it('does not mutate when the record cannot be loaded', async () => {
    mocks.getTask.mockRejectedValue(new Error('offline'));
    expect((await deletion()).ok).toBe(false);
    expect(mocks.remove).not.toHaveBeenCalled();
  });
});

describe('task editor save', () => {
  it('preserves existing server validation before any mutation', async () => {
    const data = new FormData(); data.set('taskId', 'task'); data.set('title', '');
    expect((await updateTaskAction(null, data)).ok).toBe(false);
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
