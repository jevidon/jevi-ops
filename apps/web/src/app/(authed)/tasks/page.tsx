import Link from 'next/link';
import { tasksApi, ApiError } from '@/lib/api';
import { todayIsoDate, isToday } from '@/lib/today';
import { getAppTimezone } from '@/lib/app-settings';
import type { Task } from '@jevi-ops/shared';
import { isRecurrencePattern } from '@jevi-ops/shared';
import { toggleTaskDoneAction } from '../today/actions';

// /tasks — full task list, reached from the Briefing's "Doing today"
// strip. No dedicated tab; this is a sub-view of Today (the Today tab
// stays active while it's open).
//
// Filter tabs: All / Today / Upcoming / Project — matches the design's
// editorial pattern. "Completed today" is collapsed below the active
// list; clicking expands it.
//
// Per the redesign: serif/sans typography, hairline dividers, single
// accent. Priority gets a small dot (P1 accent, P2 ink-2, else ink-4)
// rather than a colored badge. Due date renders in accent only when
// overdue — neutrals otherwise.

type Filter = 'all' | 'today' | 'upcoming' | 'project';
const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'today', label: 'Today' },
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'project', label: 'Project' },
];

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const params = await searchParams;
  const tz = await getAppTimezone();
  const today = todayIsoDate(tz);
  const filter: Filter = (FILTERS.find((f) => f.value === params.filter)?.value ?? 'all') as Filter;

  let tasks: Task[] = [];
  let errorMessage: string | null = null;
  try {
    const res = await tasksApi.list();
    tasks = res.tasks;
  } catch (err) {
    errorMessage = err instanceof ApiError ? `API ${err.status}` : (err as Error).message;
  }

  const open = tasks.filter((t) => t.status === 'open');
  const overdue = open.filter((t) => t.due_date && t.due_date < today);
  const dueToday = open.filter((t) => t.due_date === today);
  const upcoming = open.filter((t) => t.due_date && t.due_date > today);
  const noDate = open.filter((t) => !t.due_date);
  const completedToday = tasks.filter(
    (t) => t.status === 'done' && isToday(tz, t.completed_at ?? null),
  );

  // Build the body groups based on the active filter.
  type Group = { label: string; tasks: Task[]; accent?: boolean; showProject?: boolean };
  let groups: Group[] = [];
  if (filter === 'all') {
    groups = [
      { label: 'Overdue', tasks: sortByDueAsc(overdue), accent: true, showProject: true },
      { label: 'Today', tasks: sortByCreatedDesc(dueToday), showProject: true },
      { label: 'Upcoming', tasks: sortByDueAsc(upcoming), showProject: true },
      { label: 'No date', tasks: sortByCreatedDesc(noDate), showProject: true },
    ];
  } else if (filter === 'today') {
    groups = [
      { label: 'Overdue', tasks: sortByDueAsc(overdue), accent: true, showProject: true },
      { label: 'Today', tasks: sortByCreatedDesc(dueToday), showProject: true },
    ];
  } else if (filter === 'upcoming') {
    groups = [{ label: 'Upcoming', tasks: sortByDueAsc(upcoming), showProject: true }];
  } else if (filter === 'project') {
    const byProject = new Map<string, Task[]>();
    for (const t of open) {
      const key = t.project?.name ?? '(no project)';
      const list = byProject.get(key) ?? [];
      list.push(t);
      byProject.set(key, list);
    }
    groups = Array.from(byProject.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([label, ts]) => ({ label, tasks: sortByDueAsc(ts), showProject: false }));
  }

  return (
    <div className="pb-32">
      {/* ─── Breadcrumb + masthead ────────────────────────────────── */}
      <div className="px-5 lg:px-0 pt-5">
        <Link
          href="/today"
          className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3 hover:text-ink-2 transition-colors mb-2 w-fit"
        >
          <span className="h-[5px] w-[5px] rounded-full bg-accent" aria-hidden />
          From Today · Doing
        </Link>
        <h1 className="font-serif text-[28px] font-medium tracking-[-0.4px] text-ink leading-none">
          Tasks
        </h1>
        <div className="mt-1.5 font-sans text-[12px] text-ink-3">
          {open.length} open · {overdue.length} overdue · {dueToday.length} today
        </div>
      </div>

      {/* ─── Filter tabs ──────────────────────────────────────────── */}
      <div className="px-5 lg:px-0 mt-4 flex items-center gap-5">
        {FILTERS.map((f) => {
          const active = filter === f.value;
          const href = f.value === 'all' ? '/tasks' : `/tasks?filter=${f.value}`;
          return (
            <Link
              key={f.value}
              href={href}
              className={`pb-1 font-mono text-[10px] uppercase tracking-[0.06em] transition-colors ${
                active
                  ? 'text-ink border-b border-ink'
                  : 'text-ink-3 hover:text-ink-2 border-b border-transparent'
              }`}
            >
              {f.label}
            </Link>
          );
        })}
      </div>

      <div className="hairline mt-3 mx-5 lg:mx-0" />

      {errorMessage && (
        <div className="px-5 lg:px-0 mt-6 font-sans text-[13px] text-ink-3">
          Couldn&rsquo;t load tasks: {errorMessage}
        </div>
      )}

      {/* ─── Groups ──────────────────────────────────────────────── */}
      <div className="px-5 lg:px-0 mt-5">
        {groups.every((g) => g.tasks.length === 0) ? (
          <p className="font-sans text-[13px] text-ink-3 italic">
            Nothing in this view.
          </p>
        ) : (
          groups.map((g) =>
            g.tasks.length > 0 ? (
              <TaskGroup
                key={g.label}
                label={g.label}
                tasks={g.tasks}
                accent={g.accent}
                showProject={g.showProject !== false}
                today={today}
              />
            ) : null,
          )
        )}
      </div>

      {/* ─── Completed today (collapsed) ─────────────────────────── */}
      {completedToday.length > 0 && (
        <details className="mx-5 lg:mx-0 mt-6 pt-4 border-t border-line-strong group">
          <summary className="cursor-pointer list-none flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3">
              Completed today
            </span>
            <span className="font-mono text-[10px] text-ink-3">
              {completedToday.length}{' '}
              <span className="transition-transform inline-block group-open:rotate-90" aria-hidden>
                ▸
              </span>
            </span>
          </summary>
          <div className="mt-3">
            {completedToday.map((t) => (
              <CompletedRow key={t.id} task={t} />
            ))}
          </div>
        </details>
      )}

      {/* ─── Footer add ──────────────────────────────────────────── */}
      <div className="mx-5 lg:mx-0 mt-10">
        <Link
          href="/tasks/new"
          className="block border border-dashed border-line-strong px-4 py-3 text-center font-sans text-[13px] text-ink-2 hover:text-ink hover:border-ink-2 transition-colors"
        >
          + Add task <span className="text-ink-3">— or hold the mic</span>
        </Link>
      </div>
    </div>
  );
}

function TaskGroup({
  label,
  tasks,
  accent,
  showProject,
  today,
}: {
  label: string;
  tasks: Task[];
  accent?: boolean;
  showProject: boolean;
  today: string;
}) {
  return (
    <div className="mb-6">
      <div className="flex items-baseline justify-between mb-2">
        <span
          className={`font-mono text-[10px] uppercase tracking-[0.08em] ${
            accent ? 'text-accent' : 'text-ink-3'
          }`}
        >
          {label}
        </span>
        <span className="font-mono text-[10px] text-ink-3">{tasks.length}</span>
      </div>
      {tasks.map((t) => (
        <TaskRow key={t.id} task={t} showProject={showProject} today={today} />
      ))}
    </div>
  );
}

// Compact editorial task row. Whole row links to /tasks/[id]; the
// checkbox is a separate form so tapping it doesn't navigate.
function TaskRow({ task, showProject, today }: { task: Task; showProject: boolean; today: string }) {
  const dueLabel = formatDueLabel(task.due_date, today);
  const overdue = task.due_date != null && task.due_date < today;
  const flags = collectFlags(task);
  return (
    <div className="flex gap-3 items-start py-3 border-b border-line">
      {/* Checkbox — separate form so the row link doesn't fire on click. */}
      <form action={toggleTaskDoneAction} className="pt-0.5">
        <input type="hidden" name="taskId" value={task.id} />
        <input type="hidden" name="status" value={task.status} />
        <button
          type="submit"
          aria-label="Toggle done"
          className="h-4 w-4 border border-ink-3 hover:border-ink transition-colors block"
        />
      </form>

      {/* Title + meta */}
      <Link href={`/tasks/${task.id}`} className="flex-1 min-w-0 hover:opacity-80 transition-opacity">
        <div className="font-sans text-[14px] font-medium text-ink leading-snug">
          {task.title}
        </div>
        <div className="mt-1 flex items-center gap-2 flex-wrap">
          {showProject && (
            <span className="font-sans text-[11px] text-ink-3">
              {task.project?.name ?? '(no project)'}
            </span>
          )}
          {flags.map((f) => (
            <span
              key={f.label}
              className={`font-mono text-[9px] tracking-[0.05em] px-1.5 py-px bg-surface-2 ${
                f.accent ? 'text-accent' : 'text-ink-3'
              }`}
            >
              {f.label}
            </span>
          ))}
        </div>
      </Link>

      {/* Right: due + priority dot */}
      <div className="flex items-center gap-2.5 shrink-0 pt-0.5">
        {dueLabel && (
          <span
            className={`font-mono text-[10px] tabular-nums ${
              overdue ? 'text-accent' : 'text-ink-3'
            }`}
          >
            {dueLabel}
          </span>
        )}
        <span
          aria-label={`priority ${task.priority}`}
          className={`h-1.5 w-1.5 rounded-full ${priorityClass(task.priority)}`}
        />
      </div>
    </div>
  );
}

function CompletedRow({ task }: { task: Task }) {
  return (
    <div className="flex gap-3 items-center py-2 border-b border-line/60">
      <span className="h-4 w-4 border border-ink-3 bg-ink-3 flex items-center justify-center shrink-0">
        <svg viewBox="0 0 12 12" className="h-2.5 w-2.5 text-bg" aria-hidden>
          <path d="M2 6l3 3 5-6" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <Link
        href={`/tasks/${task.id}`}
        className="flex-1 min-w-0 font-sans text-[13px] text-ink-3 line-through decoration-ink-4 hover:opacity-80 transition-opacity truncate"
      >
        {task.title}
      </Link>
      {task.completed_at && (
        <span className="font-mono text-[10px] text-ink-4 tabular-nums shrink-0">
          {formatTime(task.completed_at)}
        </span>
      )}
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────

interface Flag { label: string; accent?: boolean }
function collectFlags(task: Task): Flag[] {
  const flags: Flag[] = [];
  if (task.recurrence_rule && isRecurrencePattern(task.recurrence_rule)) {
    flags.push({ label: `repeats ${task.recurrence_rule}` });
  }
  if (task.reminder_offsets && task.reminder_offsets.length > 0) {
    flags.push({ label: `remind ${formatReminders(task.reminder_offsets)}` });
  }
  if (task.content_item) {
    flags.push({ label: `linked content`, accent: true });
  }
  return flags;
}

function formatReminders(offsets: number[]): string {
  return offsets
    .map((o) => {
      if (o === 0) return 'at time';
      if (o < 60) return `−${o}m`;
      if (o < 60 * 24) return `−${Math.round(o / 60)}h`;
      return `−${Math.round(o / (60 * 24))}d`;
    })
    .join(' · ');
}

function priorityClass(p: number): string {
  if (p === 1) return 'bg-accent';
  if (p === 2) return 'bg-ink-2';
  if (p === 3) return 'bg-ink-3';
  return 'bg-ink-4';
}

function formatDueLabel(due: string | null | undefined, today: string): string | null {
  if (!due) return null;
  if (due === today) return 'today';
  if (due < today) {
    // Show the actual date for overdue — "Jun 18" reads more honestly
    // than "−3d". Locale-free formatting via slice keeps it predictable.
    return due.slice(5).replace('-', '/');
  }
  return due.slice(5).replace('-', '/');
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function sortByDueAsc(list: Task[]): Task[] {
  return [...list].sort((a, b) => (a.due_date ?? '').localeCompare(b.due_date ?? ''));
}
function sortByCreatedDesc(list: Task[]): Task[] {
  return [...list].sort((a, b) => b.created_at.localeCompare(a.created_at));
}
