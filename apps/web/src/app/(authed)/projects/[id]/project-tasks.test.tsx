import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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
  const summary = screen.getByText(/^Status ·/);
  summary.closest('details')!.open = true;
  fireEvent.click(screen.getByRole('checkbox', { name: label }));
}

describe('project task status filtering', () => {
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
