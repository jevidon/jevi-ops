import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, within } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { hydrateRoot, type Root } from 'react-dom/client';
import type { Task, WorkflowRegistry } from '@jevi-ops/shared';
import RootLayout from '@/app/layout';
import { PinButton } from '@/components/PinButton';
import { QuickAddTask } from '@/components/QuickAddTask';
import { ToastProvider } from '@/components/toast/ToastProvider';
import { TaskStatusControl, TaskWorkflowsProvider } from '@/components/task-workflows/TaskWorkflows';
import { WorkflowSettings } from '@/components/task-workflows/WorkflowSettings';
import { changeWorkflowStatus, configureWorkflow } from '@/components/task-workflows/actions';
import { pinAction } from '@/app/(authed)/_briefing/pin-actions';
import { quickAddTaskAction } from '@/components/quick-add-task-action';
import { LogTimeForm } from './log-time-form';
import { addActivityAction } from './activity-actions';
import { MilestonesSection } from './milestones-section';
import { updateMilestoneAction } from './milestone-actions';
import { ChecklistSection } from './checklist-section';
import { addChecklistItemAction } from './checklist-actions';
import { ProjectTasksProvider, ProjectTaskList } from './project-tasks';

vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock('@/lib/api', () => ({ pinsApi: { lookup: async () => ({ pin: null }) } }));
vi.mock('@/app/(authed)/_briefing/pin-actions', () => ({ pinAction: vi.fn(), unpinAction: vi.fn() }));
vi.mock('@/components/quick-add-task-action', () => ({ quickAddTaskAction: vi.fn() }));
vi.mock('@/components/task-workflows/actions', () => ({ changeWorkflowStatus: vi.fn(), configureWorkflow: vi.fn(), saveWorkflowPreset: vi.fn(), deleteWorkflowPreset: vi.fn() }));
vi.mock('./activity-actions', () => ({ addActivityAction: vi.fn() }));
vi.mock('./milestone-actions', () => ({ addMilestoneAction: vi.fn(), toggleMilestoneAction: vi.fn(), updateMilestoneAction: vi.fn(), deleteMilestoneAction: vi.fn() }));
vi.mock('./checklist-actions', () => ({ addChecklistItemAction: vi.fn(), toggleChecklistItemAction: vi.fn(), deleteChecklistItemAction: vi.fn() }));

const registry: WorkflowRegistry = { presets: [], scopes: [{ id: 'project', scope: 'project', revision: 1, definition: { statuses: [
  { id: 'buy', label: 'Buy', category: 'open' },
  { id: 'asap', label: 'Buy ASAP', category: 'open' },
  { id: 'stocked', label: 'Stocked', category: 'waiting' },
] } }] };
const tasks: Task[] = ['Milk', 'Bread', 'Salami'].map((title, i) => ({
  id: title, title, project_id: 'project', domain_id: 'domain', status: i === 2 ? 'waiting' : 'open',
  workflow_status_id: ['buy', 'asap', 'stocked'][i]!, priority: 4, source: 'manual',
  reminder_offsets: [], created_at: '2026-11-10T00:00:00Z', updated_at: '2026-11-10T00:00:00Z',
}));

let root: Root | undefined;
let frame: HTMLIFrameElement;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  frame?.remove();
  vi.restoreAllMocks();
  vi.resetAllMocks();
});

async function hydrateProject(injectMetadata = true, mutate?: (doc: Document) => void) {
  const pin = await PinButton({ targetType: 'project', targetId: 'project', path: '/projects/project' });
  const view = await RootLayout({ children: <ToastProvider><TaskWorkflowsProvider registry={registry}>
    {pin}
    <WorkflowSettings scope="project" id="project" />
    <QuickAddTask projectId="project" />
    <ProjectTasksProvider projectId="project" tasks={tasks}
      rows={Object.fromEntries(tasks.map(task => [task.id, <div><TaskStatusControl task={task} /><span>{task.title}</span></div>]))}
      milestones={[]} today="2026-11-10" doneTodayIds={[]} groupMode="due" hasWorkflow>
      <ProjectTaskList />
    </ProjectTasksProvider>
    <LogTimeForm projectId="project" />
    <MilestonesSection projectId="project" milestones={[{ id: 'meat', project_id: 'project', title: 'Meat', status: 'open', weight: 1, position: 0, completed_at: null, created_at: '2026-11-10T00:00:00Z' }]} />
    <ChecklistSection projectId="project" items={[{ id: 'bags', project_id: 'project', title: 'Bring bags', done: false, done_at: null, recurrence_rule: null, position: 0, created_at: '2026-11-10T00:00:00Z', updated_at: '2026-11-10T00:00:00Z' }]} />
  </TaskWorkflowsProvider></ToastProvider> });
  frame = document.createElement('iframe');
  document.body.append(frame);
  const doc = frame.contentDocument!;
  doc.open();
  doc.write(renderToString(view));
  doc.close();
  // Includes collapsed workflow/milestone details and the CSS-hidden date picker.
  const controls = [...doc.querySelectorAll('form, input:not([type="hidden"]):not([type="checkbox"]), select')];
  if (injectMetadata) {
    doc.documentElement.setAttribute('__gCrRemoteFrameToken', 'chrome-frame-token');
    controls.forEach((element, i) => element.setAttribute('__gCrUniqueID', String(i + 1)));
  }
  mutate?.(doc);
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  const onRecoverableError = vi.fn();
  await act(async () => { root = hydrateRoot(doc, view, { onRecoverableError }); });
  return { doc, controls, error, onRecoverableError, ui: within(doc.body) };
}

describe('project page hydration', () => {
  it.each([false, true])('hydrates forms and controls without replacement (Chrome metadata: %s)', async metadata => {
    const { doc, controls, error, onRecoverableError } = await hydrateProject(metadata);
    expect(controls.length).toBeGreaterThan(25);
    const hydratedControls = [...doc.querySelectorAll('form, input:not([type="hidden"]):not([type="checkbox"]), select')];
    expect(hydratedControls).toHaveLength(controls.length);
    controls.forEach((element, i) => expect(hydratedControls[i]).toBe(element));
    expect(error).not.toHaveBeenCalled();
    expect(onRecoverableError).not.toHaveBeenCalled();
    if (metadata) {
      expect(doc.documentElement.getAttribute('__gcrremoteframetoken')).toBe('chrome-frame-token');
      expect(controls.every(element => element.hasAttribute('__gcruniqueid'))).toBe(true);
    }
  });

  it('keeps filtering, status editing and form submissions working after browser metadata injection', async () => {
    vi.mocked(changeWorkflowStatus).mockResolvedValue({ ok: true });
    vi.mocked(configureWorkflow).mockResolvedValue({ ok: true });
    const { doc, ui, error, onRecoverableError } = await hydrateProject();
    fireEvent.click(ui.getByRole('button', { name: /^Status ·/ }));
    fireEvent.click(ui.getByRole('checkbox', { name: 'Buy' }));
    fireEvent.click(ui.getByRole('checkbox', { name: 'Buy ASAP' }));
    expect(ui.getByText('Status · 2 selected')).toBeTruthy();
    expect(ui.getByText('Milk')).toBeTruthy();
    expect(ui.getByText('Bread')).toBeTruthy();
    expect(ui.queryByText('Salami')).toBeNull();
    await act(async () => { fireEvent.change(ui.getAllByLabelText('Task status')[0]!, { target: { value: 'asap' } }); });
    expect(changeWorkflowStatus).toHaveBeenCalledWith('Milk', 'asap', 1);

    fireEvent.change(ui.getByLabelText('Status 1 name'), { target: { value: 'Buy soon' } });
    await act(async () => { fireEvent.click(ui.getByText('Save settings')); });
    expect(configureWorkflow).toHaveBeenCalledWith('project', 'project', { statuses: [
      { id: 'buy', label: 'Buy soon', category: 'open' }, ...registry.scopes[0]!.definition!.statuses.slice(1),
    ] }, 1);

    await act(async () => { fireEvent.submit(ui.getByTitle('Pin to the Agenda').closest('form')!); });
    expect(pinAction).toHaveBeenCalledOnce();
    const quick = ui.getByPlaceholderText('Quick add — just a title…') as HTMLInputElement;
    fireEvent.change(quick, { target: { value: 'Apples' } });
    await act(async () => { fireEvent.submit(quick.form!); });
    expect(vi.mocked(quickAddTaskAction).mock.calls[0]![1].get('title')).toBe('Apples');

    const entry = ui.getByPlaceholderText('What did you work on?') as HTMLInputElement;
    fireEvent.change(entry, { target: { value: 'Shopping' } });
    fireEvent.change(ui.getByLabelText('When (type)'), { target: { value: '2026-11-10 12:30' } });
    fireEvent.blur(ui.getByLabelText('When (type)'));
    await act(async () => { fireEvent.submit(entry.form!); });
    expect(vi.mocked(addActivityAction).mock.calls[0]![1].get('logged_at')).toBe('2026-11-10T12:30');

    const milestone = doc.querySelector<HTMLInputElement>('input[value="Meat"]')!;
    fireEvent.change(milestone, { target: { value: 'Produce' } });
    await act(async () => { fireEvent.submit(milestone.form!); });
    expect(vi.mocked(updateMilestoneAction).mock.calls[0]![0].get('title')).toBe('Produce');
    const checklist = ui.getByPlaceholderText('Add a checklist item…') as HTMLInputElement;
    fireEvent.change(checklist, { target: { value: 'Bring cooler' } });
    fireEvent.change(doc.querySelector('select[name="recurrence_rule"]')!, { target: { value: 'weekly' } });
    await act(async () => { fireEvent.submit(checklist.form!); });
    expect(vi.mocked(addChecklistItemAction).mock.calls[0]![1].get('recurrence_rule')).toBe('weekly');
    expect(error).not.toHaveBeenCalled();
    expect(onRecoverableError).not.toHaveBeenCalled();
  });

  it('still reports attribute mismatches below the affected elements', async () => {
    const { error } = await hydrateProject(true, doc => {
      doc.querySelector('form button')!.setAttribute('aria-label', 'Unexpected edit');
      doc.body.setAttribute('data-unexpected', 'mismatch');
    });
    const messages = error.mock.calls.flat().join(' ');
    expect(messages).toContain('aria-label');
    expect(messages).toContain('data-unexpected');
  });
});
