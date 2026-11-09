"use client";

import { createContext, Fragment, useContext, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { effectiveWorkflowStatus, type Task } from '@jevi-ops/shared';
import type { Milestone } from '@/lib/api';
import { useTaskWorkflows } from '@/components/task-workflows/TaskWorkflows';

type ProjectTasksProps = {
  projectId: string;
  tasks: Task[];
  // Server-rendered rows keep TaskItem and its server-only dependencies on the server.
  rows: Record<string, ReactNode>;
  milestones: Milestone[];
  today: string;
  doneTodayIds: string[];
  groupMode: 'milestone' | 'due';
  hasWorkflow: boolean;
};
type FilterContext = ProjectTasksProps & {
  selected: string[];
  setSelected: (ids: string[]) => void;
  options: { id: string; label: string }[];
  matches: (task: Task) => boolean;
};
const Context = createContext<FilterContext | null>(null);
const BASE_STATUSES = [
  { id: 'base:open', label: 'Open' },
  { id: 'base:waiting', label: 'Waiting' },
  { id: 'base:done', label: 'Done' },
];

export function ProjectTasksProvider({ children, ...props }: ProjectTasksProps & { children: ReactNode }) {
  // Deliberately local: refreshing the page starts with all statuses again.
  const [selected, setSelected] = useState<string[]>([]);
  const registry = useTaskWorkflows();
  const definition = registry.scopes.find(s => s.scope === 'project' && s.id === props.projectId)?.definition;
  const statusId = (task: Task) => {
    const status = definition && effectiveWorkflowStatus(task, definition);
    return status ? `workflow:${status.id}` : `base:${task.status}`;
  };
  const options = definition
    ? [
        ...definition.statuses.map(s => ({ id: `workflow:${s.id}`, label: s.label })),
        ...BASE_STATUSES.filter(s => props.tasks.some(t => statusId(t) === s.id)),
      ]
    : BASE_STATUSES;
  const matches = (task: Task) => selected.length === 0 || selected.includes(statusId(task));
  return <Context.Provider value={{ ...props, selected, setSelected, options, matches }}>{children}</Context.Provider>;
}

function useProjectTasks() {
  const context = useContext(Context);
  if (!context) throw new Error('Project tasks require ProjectTasksProvider');
  return context;
}

function StatusFilter() {
  const { selected, setSelected, options, tasks, matches } = useProjectTasks();
  return <div className="flex flex-wrap items-center gap-3">
    <span className="eyebrow">Filter by</span>
    <details className="relative" onKeyDown={event => {
      if (event.key === 'Escape') {
        event.currentTarget.open = false;
        event.currentTarget.querySelector('summary')?.focus();
      }
    }}>
      <summary className="cursor-pointer rounded border border-line bg-surface px-2 py-1 font-mono text-[11px] text-ink">
        Status · {selected.length ? `${selected.length} selected` : 'All'}
      </summary>
      <fieldset className="absolute left-0 z-20 mt-1 max-h-72 w-56 overflow-y-auto rounded border border-line bg-surface p-2 shadow-lg">
        <legend className="sr-only">Filter tasks by status</legend>
        {options.map(option => <label key={option.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-2 font-sans text-[13px] text-ink hover:bg-surface-2">
          <input type="checkbox" checked={selected.includes(option.id)}
            onChange={event => setSelected(event.target.checked ? [...selected, option.id] : selected.filter(id => id !== option.id))} />
          {option.label}
        </label>)}
      </fieldset>
    </details>
    {selected.length > 0 && <>
      <button type="button" onClick={() => setSelected([])} className="font-sans text-[12px] text-ink-3 underline hover:text-ink">Clear filter</button>
      <span role="status" className="font-mono text-[10px] text-ink-3">{tasks.filter(matches).length} of {tasks.length} tasks</span>
    </>}
  </div>;
}

export function ProjectTaskList() {
  const { projectId, tasks, rows, milestones, today, groupMode, selected, matches } = useProjectTasks();
  const visible = tasks.filter(matches);
  const live = visible.filter(t => t.status !== 'done');
  const liveIds = new Set(live.map(t => t.id));
  const childrenByParent = new Map<string, Task[]>();
  for (const task of visible) {
    if (task.parent_task_id) childrenByParent.set(task.parent_task_id, [...(childrenByParent.get(task.parent_task_id) ?? []), task]);
  }
  // A matching child becomes a standalone row when its parent is filtered out.
  const pool = live.filter(t => !t.parent_task_id || !liveIds.has(t.parent_task_id));
  const parentIds = new Set(childrenByParent.keys());
  const groups = groupMode === 'milestone'
    ? buildMilestoneGroups(pool, milestones, parentIds)
    : buildDueGroups(pool, today, parentIds);

  return <>
    <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-3">
      <div className="flex flex-wrap items-center gap-4">
        <span className="eyebrow">Group by</span>
        <GroupByLink projectId={projectId} mode="milestone" active={groupMode === 'milestone'} label="Milestone" />
        <GroupByLink projectId={projectId} mode="due" active={groupMode === 'due'} label="Due window" />
      </div>
      <StatusFilter />
    </div>
    {pool.length === 0 && <p className="font-sans text-[13px] text-ink-3 italic py-1">
      {selected.length ? visible.length ? 'No open tasks match the selected statuses. Completed matches are below.' : 'No tasks match the selected statuses.' : 'No open tasks.'}
    </p>}
    {groups.map(group => <div key={group.key} className="mb-6">
      <div className="flex items-baseline gap-3 mb-2">
        <span className={`font-sans text-[14px] font-semibold ${group.muted ? 'text-ink-3' : 'text-ink'}`}>{group.title}</span>
        <span className={`font-mono text-[10px] uppercase tracking-wider ${group.accent ? 'text-accent' : 'text-ink-3'}`}>{group.meta}</span>
      </div>
      {group.tasks.map(task => {
        const kids = childrenByParent.get(task.id) ?? [];
        return kids.length > 0
          ? <ParentFold key={task.id} parent={task} kids={kids} />
          : <Fragment key={task.id}>{rows[task.id]}</Fragment>;
      })}
    </div>)}
  </>;
}

export function ProjectCompletedTasks() {
  const { tasks, rows, doneTodayIds, hasWorkflow, selected, matches } = useProjectTasks();
  const done = tasks.filter(t => t.status === 'done' && matches(t))
    .sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? ''));
  const doneToday = done.filter(t => doneTodayIds.includes(t.id)).length;
  if (done.length === 0) return null;
  return <details className="mt-8 group" open={hasWorkflow || selected.length > 0}>
    <summary className="eyebrow pb-2 border-b border-line cursor-pointer list-none flex items-center justify-between hover:text-ink-2 transition-colors">
      <span>✓ {done.length} {hasWorkflow ? 'satisfied' : 'done'} {doneToday > 0 ? `(${doneToday} today)` : ''}</span>
      <span className="font-mono text-[10px] text-ink-3 transition-transform group-open:rotate-90" aria-hidden>▶</span>
    </summary>
    <div className="mt-3">{done.map(task => <Fragment key={task.id}>{rows[task.id]}</Fragment>)}</div>
  </details>;
}

// Parent task with live children — a details-fold (fork, one level deep).
// The chip carries done/total; open kids render with live checkboxes.
function ParentFold({ parent, kids }: { parent: Task; kids: Task[] }) {
  const { rows } = useProjectTasks();
  const openKids = kids.filter((k) => k.status !== 'done');
  const doneKidCount = kids.length - openKids.length;
  return (
    <details className="group border-b border-line">
      <summary className="cursor-pointer list-none flex items-start gap-3 py-2">
        <span
          className="flex h-5 w-5 shrink-0 items-center justify-center pt-0.5 font-mono text-[10px] text-ink-3 transition-transform group-open:rotate-90"
          aria-hidden
        >
          ▶
        </span>
        <Link
          href={`/tasks/${parent.id}`}
          className="flex-1 min-w-0 font-sans text-[14px] leading-snug text-ink hover:text-accent transition-colors pt-0.5"
        >
          {parent.title}
        </Link>
        <span className="shrink-0 mt-0.5 bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] tracking-wider text-ink-2">
          {doneKidCount} / {kids.length}
        </span>
      </summary>
      <div className="ml-[9px] border-l border-line-strong pl-4 pb-2">
        {openKids.map((k) => (
          <Fragment key={k.id}>{rows[k.id]}</Fragment>
        ))}
        {openKids.length === 0 && (
          <p className="font-sans text-[13px] text-ink-3 italic py-1">All subtasks done.</p>
        )}
      </div>
    </details>
  );
}

// ─── Drill-in grouping (Addendum 08 §10) ─────────────────────────────────────

interface TaskGroup { key: string; title: string; meta: string; tasks: Task[]; muted?: boolean; accent?: boolean; }

function sortPool(list: Task[], parentIds: Set<string> = new Set()): Task[] {
  return [...list].sort((a, b) => {
    // Parents carrying subtasks first: the fold rows read as sections, and
    // scattered loose items below them are the real to-do surface.
    const ap = parentIds.has(a.id) ? 0 : 1;
    const bp = parentIds.has(b.id) ? 0 : 1;
    if (ap !== bp) return ap - bp;
    const aw = a.status === 'waiting' ? 1 : 0;
    const bw = b.status === 'waiting' ? 1 : 0;
    if (aw !== bw) return aw - bw;
    return (a.due_date ?? '9999-99-99').localeCompare(b.due_date ?? '9999-99-99');
  });
}

function buildMilestoneGroups(pool: Task[], milestones: Milestone[], parentIds: Set<string> = new Set()): TaskGroup[] {
  const ordered = [...milestones].sort((a, b) => a.position - b.position);
  const currentId = ordered.find((m) => m.status === 'open')?.id ?? null;
  const groups: TaskGroup[] = [];
  for (const m of ordered) {
    const t = sortPool(pool.filter((x) => x.milestone_id === m.id), parentIds);
    if (t.length === 0) continue;
    const meta = m.status === 'done' ? `done · weight ${m.weight}` : m.id === currentId ? `in progress · weight ${m.weight}` : `weight ${m.weight}`;
    groups.push({ key: m.id, title: m.title, meta, tasks: t, muted: m.status === 'done' });
  }
  const general = sortPool(pool.filter((t) => !t.milestone_id), parentIds);
  if (general.length > 0) groups.push({ key: 'general', title: 'General', meta: 'no milestone', tasks: general });
  return groups;
}

function buildDueGroups(pool: Task[], today: string, parentIds: Set<string> = new Set()): TaskGroup[] {
  const plus7 = new Date(new Date(`${today}T00:00:00Z`).getTime() + 7 * 86_400_000).toISOString().slice(0, 10);
  const open = pool.filter((t) => t.status === 'open');
  const waiting = pool.filter((t) => t.status === 'waiting');
  const buckets: TaskGroup[] = [
    { key: 'overdue', title: 'Overdue', accent: true, tasks: open.filter((t) => t.due_date && t.due_date < today), meta: '' },
    { key: 'today', title: 'Today', tasks: open.filter((t) => t.due_date === today), meta: '' },
    { key: 'week', title: 'This week', tasks: open.filter((t) => t.due_date && t.due_date > today && t.due_date <= plus7), meta: '' },
    { key: 'later', title: 'Later', tasks: open.filter((t) => t.due_date && t.due_date > plus7), meta: '' },
    { key: 'undated', title: 'Undated', tasks: open.filter((t) => !t.due_date), meta: '' },
    { key: 'waiting', title: 'Waiting', muted: true, tasks: waiting, meta: '' },
  ].map((g) => ({ ...g, meta: String(g.tasks.length), tasks: sortPool(g.tasks, parentIds) }));
  return buckets.filter((g) => g.tasks.length > 0);
}

function GroupByLink({ projectId, mode, active, label }: { projectId: string; mode: 'milestone' | 'due'; active: boolean; label: string }) {
  return (
    <Link href={`/projects/${projectId}?group=${mode}`} scroll={false}
      className={`font-mono text-[11px] uppercase tracking-wider pb-0.5 transition-colors ${active ? 'text-ink border-b border-ink' : 'text-ink-3 hover:text-ink-2 border-b border-transparent'}`}>
      {label}
    </Link>
  );
}
