import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderToString } from 'react-dom/server';
import { hydrateRoot } from 'react-dom/client';
import type { Task, WorkflowRegistry } from '@jevi-ops/shared';
import { TaskWorkflowsProvider } from '@/components/task-workflows/TaskWorkflows';
import { ProjectTasksProvider, ProjectTaskList, ProjectCompletedTasks } from './project-tasks';

vi.mock('@/components/task-workflows/actions', () => ({ changeWorkflowStatus: vi.fn() }));
afterEach(cleanup);

const registry: WorkflowRegistry = {
  presets: [],
  scopes: [{ id: 'project', scope: 'project', revision: 1, definition: { statuses: [
    { id: 'buy', label: 'Buy', category: 'open' },
    { id: 'buy-asap', label: 'Buy ASAP', category: 'open' },
    { id: 'pack', label: 'Pack', category: 'open' },
    { id: 'ordered', label: 'Ordered', category: 'waiting' },
    { id: 'ready', label: 'Ready', category: 'done' },
  ] } }],
};
function task(id: string, workflow_status_id: string | null, extra: Partial<Task> = {}): Task {
  return { id, title: id, workflow_status_id, status: 'open', project_id: 'project', domain_id: 'domain',
    priority: 4, source: 'manual', reminder_offsets: [], created_at: '2026-11-09T00:00:00Z', updated_at: '2026-11-09T00:00:00Z', ...extra };
}
const tasks = [
  task('Milk', 'buy', { due_date: '2026-11-09' }),
  task('Batteries', 'buy-asap'),
  task('Tent', 'pack'),
  task('Parcel', 'ordered', { status: 'waiting' }),
  task('Torch', 'ready', { status: 'done' }),
];
function view(items = tasks, groupMode: 'due' | 'milestone' = 'due', workflows = registry) {
  return <TaskWorkflowsProvider registry={workflows}>
    <ProjectTasksProvider projectId="project" tasks={items} rows={Object.fromEntries(items.map(t => [t.id, <span>{t.title}</span>]))}
      milestones={[]} today="2026-11-09" doneTodayIds={[]} groupMode={groupMode} hasWorkflow={workflows.scopes.length > 0}>
      <ProjectTaskList />
      <ProjectCompletedTasks />
    </ProjectTasksProvider>
  </TaskWorkflowsProvider>;
}
function select(label: string) {
  const trigger = screen.getByRole('button', { name: /^Status ·/ });
  if (trigger.getAttribute('aria-expanded') === 'false') fireEvent.click(trigger);
  fireEvent.click(screen.getByRole('checkbox', { name: label }));
}

describe('project task status filtering', () => {
  it('currently renders only one subtask level, requiring the template editor depth limit', () => {
    render(view([
      task('Root', null),
      task('Child', null, { parent_task_id: 'Root' }),
      task('Grandchild', null, { parent_task_id: 'Child' }),
    ], 'due', { scopes: [], presets: [] }));
    const fold = screen.getByRole('link', { name: 'Root' }).closest('details')!;
    fold.open = true;
    expect(within(fold).getByText('Child')).toBeTruthy();
    expect(screen.queryByText('Grandchild')).toBeNull();
  });

  it('updates immediately from native checkbox input events without a synthetic change event', () => {
    render(view());
    fireEvent.click(screen.getByRole('button', { name: /^Status ·/ }));
    const buy = screen.getByRole('checkbox', { name: 'Buy' }) as HTMLInputElement;
    const asap = screen.getByRole('checkbox', { name: 'Buy ASAP' }) as HTMLInputElement;
    fireEvent.input(buy, { target: { checked: true } });
    expect(screen.getByText('Status · 1 selected')).toBeTruthy();
    expect(screen.queryByText('Tent')).toBeNull();
    expect(screen.queryByText('Batteries')).toBeNull();
    fireEvent.input(asap, { target: { checked: true } });
    // Some browsers deliver both input and change; the same value is idempotent.
    fireEvent.input(asap, { target: { checked: true } });
    fireEvent.change(asap, { target: { checked: true } });
    expect(screen.getByText('Status · 2 selected')).toBeTruthy();
    expect(screen.getByText('Milk')).toBeTruthy();
    expect(screen.getByText('Batteries')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('2 of 5 tasks');
    fireEvent.input(buy, { target: { checked: false } });
    expect(screen.queryByText('Milk')).toBeNull();
    expect(screen.getByText('Status · 1 selected')).toBeTruthy();
  });

  it('prevents native-only selections before hydration, then filters on the first tap', async () => {
    const user = userEvent.setup();
    const container = document.createElement('div');
    container.innerHTML = renderToString(view());
    document.body.append(container);
    let root: ReturnType<typeof hydrateRoot> | undefined;
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const trigger = within(container).getByRole('button', { name: /^Status ·/ }) as HTMLButtonElement;
      expect(trigger.disabled).toBe(true);
      await user.click(trigger);
      expect(within(container).queryByRole('checkbox', { name: 'Buy' })).toBeNull();
      await act(async () => { root = hydrateRoot(container, view()); });
      expect(trigger.disabled).toBe(false);
      await user.pointer([{ keys: '[TouchA>]', target: trigger }, { keys: '[/TouchA]' }]);
      const buy = within(container).getByRole('checkbox', { name: 'Buy' }) as HTMLInputElement;
      await user.pointer([
        { keys: '[TouchA>]', target: within(container).getByText('Buy', { selector: 'label' }) },
        { keys: '[/TouchA]' },
      ]);
      expect(buy.checked).toBe(true);
      expect(within(container).getByText('Status · 1 selected')).toBeTruthy();
      expect(within(container).queryByText('Tent')).toBeNull();
      expect(within(container).getByText('Milk')).toBeTruthy();
      await user.pointer([
        { keys: '[TouchA>]', target: within(container).getByText('Buy ASAP', { selector: 'label' }) },
        { keys: '[/TouchA]' },
      ]);
      expect(within(container).getByText('Status · 2 selected')).toBeTruthy();
      expect(within(container).getByText('Batteries')).toBeTruthy();
      expect(within(container).queryByText('Tent')).toBeNull();
      await user.keyboard('{Escape}');
      expect(trigger.getAttribute('aria-expanded')).toBe('false');
      expect(document.activeElement).toBe(trigger);
      await user.keyboard(' ');
      expect(trigger.getAttribute('aria-expanded')).toBe('true');
      expect((within(container).getByRole('checkbox', { name: 'Buy ASAP' }) as HTMLInputElement).checked).toBe(true);
      expect(error).not.toHaveBeenCalled();
    } finally {
      if (root) await act(async () => root!.unmount());
      container.remove();
      error.mockRestore();
    }
  });

  it('combines distinct custom statuses with OR and clears back to all tasks', () => {
    render(view());
    select('Buy');
    expect(screen.getByText('Milk')).toBeTruthy();
    expect(screen.queryByText('Batteries')).toBeNull();
    select('Buy ASAP');
    expect(screen.getByText('Milk')).toBeTruthy();
    expect(screen.getByText('Batteries')).toBeTruthy();
    expect(screen.queryByText('Tent')).toBeNull();
    expect(screen.queryByText('Parcel')).toBeNull();
    expect(screen.queryByText('Torch')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('2 of 5 tasks');
    select('Buy');
    expect(screen.queryByText('Milk')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filter' }));
    tasks.forEach(t => expect(screen.getByText(t.title)).toBeTruthy());
  });

  it('retains the selection across grouping updates but resets on a fresh mount', () => {
    const result = render(view());
    select('Buy ASAP');
    result.rerender(view(tasks, 'milestone'));
    expect(screen.getByText('General')).toBeTruthy();
    expect(screen.getByText('Batteries')).toBeTruthy();
    expect(screen.queryByText('Milk')).toBeNull();
    result.unmount();
    render(view());
    expect(screen.getByText('Status · All')).toBeTruthy();
    tasks.forEach(t => expect(screen.getByText(t.title)).toBeTruthy());
  });

  it('shows matching children when a parent is excluded and excludes unrelated children from folds', () => {
    const items = [task('Parent', 'pack'), task('Child', 'buy', { parent_task_id: 'Parent' }), task('Other child', 'pack', { parent_task_id: 'Parent' })];
    render(view(items));
    select('Buy');
    expect(screen.getByText('Child')).toBeTruthy();
    expect(screen.queryByText('Parent')).toBeNull();
    expect(screen.queryByText('Other child')).toBeNull();
    select('Buy');
    select('Pack');
    const fold = screen.getByRole('link', { name: 'Parent' }).closest('details')!;
    fold.open = true;
    expect(within(fold).getByText('Other child')).toBeTruthy();
    expect(screen.queryByText('Child')).toBeNull();
  });

  it('filters completed and waiting statuses and removes empty groups', () => {
    render(view());
    select('Ready');
    expect(screen.getByText('Torch').closest('details')!.open).toBe(true);
    expect(screen.queryByText('Today')).toBeNull();
    expect(screen.queryByText('Undated')).toBeNull();
    expect(screen.getByText(/Completed matches are below/)).toBeTruthy();
    select('Ordered');
    expect(screen.getByText('Parcel')).toBeTruthy();
    expect(screen.getByText('Torch')).toBeTruthy();
    expect(screen.queryByText('Milk')).toBeNull();
  });

  it('offers configured statuses with no matches and a recoverable empty state', () => {
    render(view([tasks[0]!]));
    select('Buy ASAP');
    expect(screen.getByText('No tasks match the selected statuses.')).toBeTruthy();
    select('Buy ASAP');
    expect(screen.getByText('Milk')).toBeTruthy();
    expect(screen.getByText('Status · All')).toBeTruthy();
  });

  it('uses the displayed fallback status for tasks without a custom status ID', () => {
    render(view([task('Legacy item', null)]));
    select('Buy');
    expect(screen.getByText('Legacy item')).toBeTruthy();
    select('Buy');
    select('Buy ASAP');
    expect(screen.queryByText('Legacy item')).toBeNull();
  });

  it('supports standard statuses for projects without workflows', () => {
    render(view(tasks, 'due', { scopes: [], presets: [] }));
    select('Waiting');
    expect(screen.getByText('Parcel')).toBeTruthy();
    expect(screen.queryByText('Milk')).toBeNull();
    select('Done');
    expect(screen.getByText('Torch')).toBeTruthy();
    expect(screen.queryByText('Tent')).toBeNull();
  });
});
