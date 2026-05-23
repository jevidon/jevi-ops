import Link from 'next/link';
import { ScreenHeader } from '@/components/ScreenHeader';
import { TaskItem } from '@/components/TaskItem';
import { tasksApi, projectsApi, ApiError } from '@/lib/api';
import { todayIsoDate } from '@/lib/today';
import type { Task } from '@jerad-ops/shared';

// /tasks — full task list, grouped by due date. Filters for status and project
// live in the URL so links can be shared/bookmarked.

type StatusFilter = 'open' | 'done' | 'all';

interface SearchParamsShape {
  status?: string;
  project?: string;
}

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<SearchParamsShape>;
}) {
  const params = await searchParams;
  const status: StatusFilter =
    params.status === 'done' || params.status === 'all' ? params.status : 'open';
  const projectFilter = params.project ?? 'all';

  let tasks: Task[] = [];
  let projects: { id: string; name: string; color?: string | null }[] = [];
  let errorMessage: string | null = null;

  const [tasksRes, projectsRes] = await Promise.allSettled([
    tasksApi.list(),
    projectsApi.list(),
  ]);
  if (tasksRes.status === 'fulfilled') {
    tasks = tasksRes.value.tasks;
  } else {
    const err = tasksRes.reason;
    errorMessage = err instanceof ApiError ? `API ${err.status}` : (err as Error).message;
  }
  if (projectsRes.status === 'fulfilled') {
    projects = projectsRes.value.projects
      .map((p) => ({ id: p.id, name: p.name, color: p.color }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  // Apply filters.
  const filteredTasks = tasks.filter((t) => {
    if (status === 'open' && t.status !== 'open') return false;
    if (status === 'done' && t.status !== 'done') return false;
    if (projectFilter !== 'all') {
      if (projectFilter === 'none' && t.project_id) return false;
      if (projectFilter !== 'none' && t.project_id !== projectFilter) return false;
    }
    return true;
  });

  const groups = groupByDue(filteredTasks);

  return (
    <div>
      <ScreenHeader
        eyebrow="All tasks"
        title="Tasks"
        meta={`${filteredTasks.length} of ${tasks.length}`}
      />
      <div className="hairline" />

      <div className="px-5 lg:px-0 pt-3 flex justify-end">
        <Link
          href="/tasks/new"
          className="font-mono text-[11px] uppercase tracking-wider text-ink-3 hover:text-accent transition-colors"
        >
          + New task
        </Link>
      </div>

      <FilterBar status={status} projectFilter={projectFilter} projects={projects} />

      {errorMessage ? (
        <div className="px-5 lg:px-0 mt-6 font-sans text-[13px] text-ink-3">
          Couldn't load tasks: {errorMessage}
        </div>
      ) : filteredTasks.length === 0 ? (
        <div className="px-5 lg:px-0 mt-6 font-sans text-[13px] text-ink-3 italic">
          No tasks matching these filters.
        </div>
      ) : (
        <div className="px-5 lg:px-0 mt-2">
          {GROUP_ORDER.map((key) => {
            const list = groups[key];
            if (!list || list.length === 0) return null;
            const collapseDone = key === 'done';
            return collapseDone ? (
              <details key={key} className="group pt-6">
                <summary className="eyebrow pb-2 border-b border-line cursor-pointer list-none flex items-center justify-between hover:text-ink-2 transition-colors">
                  <span>
                    {GROUP_LABEL[key]} · {list.length}
                  </span>
                  <span className="font-mono text-[10px] text-ink-3 transition-transform group-open:rotate-90" aria-hidden>
                    ▶
                  </span>
                </summary>
                <div className="mt-3">
                  {list.map((t) => (
                    <TaskItem key={t.id} task={t} showStar={false} />
                  ))}
                </div>
              </details>
            ) : (
              <section key={key} className="pt-6">
                <div className="eyebrow pb-2 border-b border-line mb-3">
                  {GROUP_LABEL[key]} · {list.length}
                </div>
                {list.map((t) => (
                  <TaskItem key={t.id} task={t} showStar={key === 'today' || key === 'overdue'} />
                ))}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Filter bar ──────────────────────────────────────────────────────────

function FilterBar({
  status,
  projectFilter,
  projects,
}: {
  status: StatusFilter;
  projectFilter: string;
  projects: { id: string; name: string; color?: string | null }[];
}) {
  const buildHref = (overrides: Partial<{ status: StatusFilter; project: string }>): string => {
    const params = new URLSearchParams();
    const newStatus = overrides.status ?? status;
    const newProject = overrides.project ?? projectFilter;
    if (newStatus !== 'open') params.set('status', newStatus);
    if (newProject !== 'all') params.set('project', newProject);
    const qs = params.toString();
    return qs ? `/tasks?${qs}` : '/tasks';
  };

  return (
    <div className="px-5 lg:px-0 pt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
      <ChipGroup label="Status">
        <Chip href={buildHref({ status: 'open' })} active={status === 'open'}>Open</Chip>
        <Chip href={buildHref({ status: 'done' })} active={status === 'done'}>Done</Chip>
        <Chip href={buildHref({ status: 'all' })} active={status === 'all'}>All</Chip>
      </ChipGroup>

      <ChipGroup label="Project">
        <Chip href={buildHref({ project: 'all' })} active={projectFilter === 'all'}>All</Chip>
        <Chip href={buildHref({ project: 'none' })} active={projectFilter === 'none'}>No project</Chip>
        {projects.map((p) => (
          <Chip key={p.id} href={buildHref({ project: p.id })} active={projectFilter === p.id}>
            {p.color && (
              <span
                className="inline-block h-1.5 w-1.5 rounded-full mr-1.5 align-middle"
                style={{ backgroundColor: p.color }}
                aria-hidden
              />
            )}
            {p.name}
          </Chip>
        ))}
      </ChipGroup>
    </div>
  );
}

function ChipGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="eyebrow">{label}</span>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

function Chip({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`px-2.5 py-1 border font-mono text-[10px] uppercase tracking-wider transition-colors ${
        active
          ? 'bg-ink text-bg border-ink'
          : 'border-line text-ink-2 hover:border-ink-2 hover:text-ink'
      }`}
    >
      {children}
    </Link>
  );
}

// ─── Grouping ────────────────────────────────────────────────────────────

const GROUP_ORDER = ['overdue', 'today', 'tomorrow', 'thisWeek', 'later', 'noDate', 'done'] as const;
type GroupKey = (typeof GROUP_ORDER)[number];

const GROUP_LABEL: Record<GroupKey, string> = {
  overdue: 'Overdue',
  today: 'Today',
  tomorrow: 'Tomorrow',
  thisWeek: 'This week',
  later: 'Later',
  noDate: 'No date',
  done: 'Done',
};

function groupByDue(tasks: Task[]): Record<GroupKey, Task[]> {
  const today = todayIsoDate();
  const tomorrow = isoDaysFromToday(1);
  const inSevenDays = isoDaysFromToday(7);

  const out: Record<GroupKey, Task[]> = {
    overdue: [], today: [], tomorrow: [], thisWeek: [], later: [], noDate: [], done: [],
  };

  for (const t of tasks) {
    if (t.status === 'done') {
      out.done.push(t);
      continue;
    }
    if (!t.due_date) {
      out.noDate.push(t);
      continue;
    }
    if (t.due_date < today) out.overdue.push(t);
    else if (t.due_date === today) out.today.push(t);
    else if (t.due_date === tomorrow) out.tomorrow.push(t);
    else if (t.due_date <= inSevenDays) out.thisWeek.push(t);
    else out.later.push(t);
  }

  // Within each group:
  out.overdue.sort((a, b) => (a.due_date ?? '').localeCompare(b.due_date ?? ''));     // oldest first
  out.tomorrow.sort((a, b) => b.created_at.localeCompare(a.created_at));
  out.today.sort((a, b) => b.created_at.localeCompare(a.created_at));
  out.thisWeek.sort((a, b) => (a.due_date ?? '').localeCompare(b.due_date ?? ''));
  out.later.sort((a, b) => (a.due_date ?? '').localeCompare(b.due_date ?? ''));
  out.noDate.sort((a, b) => b.created_at.localeCompare(a.created_at));
  out.done.sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? ''));

  return out;
}

function isoDaysFromToday(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Denver',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}
