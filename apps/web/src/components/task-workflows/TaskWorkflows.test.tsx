import { TasksView } from '@/app/(authed)/tasks/tasks-view';
import type { Task } from '@jevi-ops/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BUILTIN_WORKFLOW_PRESETS, type WorkflowRegistry } from '@jevi-ops/shared';
import { TaskStatusControl, TaskWorkflowsProvider } from './TaskWorkflows';
import { WorkflowSettings } from './WorkflowSettings';
import { changeWorkflowStatus, configureWorkflow } from './actions';
import { UnrecognizedActionError } from 'next/dist/client/components/unrecognized-action-error';

vi.mock('@/app/(authed)/today/actions', () => ({ toggleTaskDoneAction: vi.fn() }));
vi.mock('./actions', () => ({ changeWorkflowStatus: vi.fn(), configureWorkflow: vi.fn(), saveWorkflowPreset: vi.fn(), deleteWorkflowPreset: vi.fn() }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.resetAllMocks(); });
const kit = BUILTIN_WORKFLOW_PRESETS[1]!.definition;
const registry: WorkflowRegistry = { scopes: [{ id: 'project', scope: 'project', definition: kit, revision: 3 }, { id: 'domain', scope: 'domain', definition: kit, revision: 2 }], presets: BUILTIN_WORKFLOW_PRESETS };
const task = { id: 'task', status: 'open', project_id: 'project', domain_id: 'domain', workflow_status_id: 'pack' };

describe('task status controls', () => {
  it.each(['project', 'domain'] as const)('adds and saves a %s status without native randomUUID', async (scope) => {
    vi.stubGlobal('crypto', { getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto) });
    vi.mocked(configureWorkflow).mockResolvedValue({ ok: true });
    render(<TaskWorkflowsProvider registry={registry}><WorkflowSettings scope={scope} id={scope} /></TaskWorkflowsProvider>);
    fireEvent.click(screen.getByText('Task statuses · Custom'));
    fireEvent.click(screen.getByRole('button', { name: 'Add status' }));
    fireEvent.change(screen.getByLabelText('Status 4 name'), { target: { value: 'Ordered' } });
    fireEvent.change(screen.getByLabelText('Status 4 category'), { target: { value: 'waiting' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));

    await waitFor(() => expect(configureWorkflow).toHaveBeenCalledWith(scope, scope, { statuses: [
      ...kit.statuses,
      { id: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/), label: 'Ordered', category: 'waiting' },
    ] }, scope === 'project' ? 3 : 2));
    expect(screen.getByRole('status').textContent).toBe('Task status settings saved.');
  });
  it('keeps the checkbox for an unconfigured project even inside a configured domain', () => {
    render(<TaskWorkflowsProvider registry={registry}><TaskStatusControl task={{ ...task, project_id: 'simple' }}><input type="checkbox" aria-label="Done" /></TaskStatusControl></TaskWorkflowsProvider>);
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.getByRole('checkbox')).toBeTruthy();
  });
  it('submits the selected stage and revision, prevents duplicate clicks, and exposes maintenance details', async () => {
    let finish!: (r: { error: string; detailsHref: string }) => void;
    vi.mocked(changeWorkflowStatus).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    render(<TaskWorkflowsProvider registry={registry}><TaskStatusControl task={task} /></TaskWorkflowsProvider>);
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe('pack');
    fireEvent.change(select, { target: { value: 'packed' } });
    await waitFor(() => expect(select.disabled).toBe(true));
    expect(changeWorkflowStatus).toHaveBeenCalledWith('task', 'packed', 3);
    finish({ error: 'Inspection needs details', detailsHref: '/maintenance/item' });
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Inspection needs details'));
    expect(select.value).toBe('pack');
    expect(screen.getByRole('link').getAttribute('href')).toBe('/maintenance/item');
  });
  it('keeps the current status and offers a full reload when the server no longer recognizes the action', async () => {
    vi.mocked(changeWorkflowStatus).mockRejectedValue(new UnrecognizedActionError('Server Action was not found on the server.'));
    render(<TaskWorkflowsProvider registry={registry}><TaskStatusControl task={task} /></TaskWorkflowsProvider>);
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'packed' } });

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('The app has updated'));
    expect(select.value).toBe('pack');
    expect(select.disabled).toBe(true);
    expect(screen.queryByRole('status')).toBeNull();
    expect(changeWorkflowStatus).toHaveBeenCalledTimes(1);

    const reload = vi.fn();
    vi.stubGlobal('window', { location: { reload } });
    fireEvent.click(screen.getByRole('button', { name: 'Reload page' }));
    expect(reload).toHaveBeenCalledOnce();
    expect(changeWorkflowStatus).toHaveBeenCalledTimes(1);
  });
  it('shows a retryable error for a failed request without losing the current status', async () => {
    vi.mocked(changeWorkflowStatus).mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce({ ok: true });
    render(<TaskWorkflowsProvider registry={registry}><TaskStatusControl task={task} /></TaskWorkflowsProvider>);
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'packed' } });

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Could not save the status'));
    expect(select.value).toBe('pack');
    expect(select.disabled).toBe(false);
    expect(screen.queryByRole('button', { name: 'Reload page' })).toBeNull();

    fireEvent.change(select, { target: { value: 'packed' } });
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(changeWorkflowStatus).toHaveBeenCalledTimes(2);
  });
  it('keeps previously satisfied items reusable and respects text filtering', () => {
    const item: Task = { ...task, status: 'done', workflow_status_id: 'packed', title: 'Stored torch', priority: 4, source: 'manual', reminder_offsets: [], created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z', completed_at: '2026-09-01T00:00:00Z' };
    render(<TaskWorkflowsProvider registry={registry}><TasksView tasks={[item]} today="2026-09-17" tz="Pacific/Auckland" /></TaskWorkflowsProvider>);
    fireEvent.click(screen.getByText('Satisfied & completed today'));
    expect(screen.getByText('Stored torch')).toBeTruthy();
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('packed');
    fireEvent.change(screen.getByPlaceholderText('Filter tasks, projects, waiting-on…'), { target: { value: 'milk' } });
    expect(screen.queryByText('Stored torch')).toBeNull();
  });
  it('keeps occupied-deletion errors visible and retains the editable draft', async () => {
    vi.mocked(configureWorkflow).mockResolvedValue({ error: 'Move tasks out of Need to pack first.' });
    render(<TaskWorkflowsProvider registry={registry}><WorkflowSettings scope="project" id="project" /></TaskWorkflowsProvider>);
    fireEvent.click(screen.getByText('Task statuses · Custom'));
    fireEvent.click(screen.getAllByText('Remove')[1]!);
    fireEvent.click(screen.getByText('Save settings'));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Move tasks out'));
    expect(screen.getAllByRole('textbox').map(e => (e as HTMLInputElement).value)).not.toContain('Need to pack');
  });
});
