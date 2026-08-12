import Link from 'next/link';
import { tasksApi, ApiError } from '@/lib/api';
import { todayIsoDate } from '@/lib/today';
import { getAppTimezone } from '@/lib/app-settings';
import type { Task } from '@jevi-ops/shared';
import { RECURRENCE_LABELS, isRecurrencePattern } from '@jevi-ops/shared';
import { completeMaintenanceTaskAction } from './actions';

// /tasks/maintenance — the recurring-upkeep audit view. Every open
// recurring task, grouped by domain, so the whole rotation (filter
// changes, registration renewals, expiration checks…) is inspectable
// at a glance instead of scattered through the date-sorted lists.
//
// Cadence tabs narrow to one rhythm; Quarterly is the default landing
// because that's the classic home-maintenance beat. "All" shows the
// entire rotation including the fast (daily/weekly) cadences.
//
// Like /tasks, this is a Today sub-view — no tab of its own; the
// Today rail entry stays lit while it's open.

type Cadence = 'monthly' | 'quarterly' | 'semiannually' | 'yearly' | 'all';
const CADENCES: Array<{ value: Cadence; label: string }> = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'semiannually', label: 'Semi-annual' },
  { value: 'yearly', label: 'Annual' },
  { value: 'all', label: 'All' },
];

export default async function MaintenancePage({
  searchParams,
}: {
  searchParams: Promise<{ cadence?: string }>;
}) {
  const params = await searchParams;
  const tz = await getAppTimezone();
  const today = todayIsoDate(tz);
  const cadence: Cadence =
    CADENCES.find((c) => c.value === params.cadence)?.value ?? 'quarterly';

  let tasks: Task[] = [];
  let errorMessage: string | null = null;
  try {
    const res = await tasksApi.list();
    tasks = res.tasks;
  } catch (err) {
    errorMessage = err instanceof ApiError ? `API ${err.status}` : (err as Error).message;
  }

  // The full rotation: every open task with a recurrence rule. Recurring
  // tasks roll forward on completion, so "open" is their steady state.
  const rotation = tasks.filter(
    (t) => t.status === 'open' && t.recurrence_rule && isRecurrencePattern(t.recurrence_rule),
  );
  const visible =
    cadence === 'all' ? rotation : rotation.filter((t) => t.recurrence_rule === cadence);
  const overdueCount = visible.filter((t) => t.due_date && t.due_date < today).length;

  // Group by domain, alphabetical; within a group, soonest due first.
  const byDomain = new Map<string, Task[]>();
  for (const t of visible) {
    const key = t.domain?.name ?? '(no domain)';
    const list = byDomain.get(key) ?? [];
    list.push(t);
    byDomain.set(key, list);
  }
  const groups = Array.from(byDomain.entries())
    .map(([label, ts]) => ({ label, tasks: sortByDueAsc(ts) }))
    .sort((a, b) => a.label.localeCompare(b.label));

  return (
    <div className="pb-32">
      {/* ─── Breadcrumb + masthead ────────────────────────────────── */}
      <div className="px-5 lg:px-0 pt-5">
        <Link
          href="/tasks"
          className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3 hover:text-ink-2 transition-colors mb-2 w-fit"
        >
          <span className="h-[5px] w-[5px] rounded-full bg-accent" aria-hidden />
          From Tasks
        </Link>
        <h1 className="font-serif text-[28px] font-medium tracking-[-0.4px] text-ink leading-none">
          Maintenance
        </h1>
        <div className="mt-1.5 font-sans text-[12px] text-ink-3">
          {visible.length} in rotation
          {overdueCount > 0 ? ` · ${overdueCount} overdue` : ''}
          {' · '}completing an item rolls it to its next date
        </div>
      </div>

      {/* ─── Cadence tabs ─────────────────────────────────────────── */}
      <div className="px-5 lg:px-0 mt-4 flex items-center gap-5">
        {CADENCES.map((c) => {
          const active = cadence === c.value;
          const href =
            c.value === 'quarterly' ? '/tasks/maintenance' : `/tasks/maintenance?cadence=${c.value}`;
          return (
            <Link
              key={c.value}
              href={href}
              className={`pb-1 font-mono text-[10px] uppercase tracking-[0.06em] transition-colors ${
                active
                  ? 'text-ink border-b border-ink'
                  : 'text-ink-3 hover:text-ink-2 border-b border-transparent'
              }`}
            >
              {c.label}
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

      {/* ─── Domain groups ────────────────────────────────────────── */}
      <div className="px-5 lg:px-0 mt-5">
        {groups.length === 0 ? (
          <p className="font-sans text-[13px] text-ink-3 italic">
            Nothing on a {cadence === 'all' ? 'recurring' : cadenceNoun(cadence)} rotation yet.
            Give a task a due date and a &ldquo;Repeat&rdquo; rule and it shows up here.
          </p>
        ) : (
          groups.map((g) => (
            <div key={g.label} className="mb-6">
              <div className="flex items-baseline justify-between mb-2">
                <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3">
                  {g.label}
                </span>
                <span className="font-mono text-[10px] text-ink-3">{g.tasks.length}</span>
              </div>
              {g.tasks.map((t) => (
                <MaintenanceRow key={t.id} task={t} today={today} showCadence={cadence === 'all'} />
              ))}
            </div>
          ))
        )}
      </div>

      {/* ─── Footer add ──────────────────────────────────────────── */}
      <div className="mx-5 lg:mx-0 mt-10">
        <Link
          href="/tasks/new"
          className="block border border-dashed border-line-strong px-4 py-3 text-center font-sans text-[13px] text-ink-2 hover:text-ink hover:border-ink-2 transition-colors"
        >
          + Add a recurring task
        </Link>
      </div>
    </div>
  );
}

// One rotation item. Checking the box completes it — the server rolls
// the due date forward and the row re-renders with its next date.
function MaintenanceRow({
  task,
  today,
  showCadence,
}: {
  task: Task;
  today: string;
  showCadence: boolean;
}) {
  const overdue = task.due_date != null && task.due_date < today;
  return (
    <div className="flex gap-3 items-start py-3 border-b border-line">
      <form action={completeMaintenanceTaskAction} className="pt-0.5">
        <input type="hidden" name="taskId" value={task.id} />
        <button
          type="submit"
          aria-label="Mark done (rolls forward)"
          className="h-4 w-4 border border-ink-3 hover:border-ink transition-colors block"
        />
      </form>

      <Link href={`/tasks/${task.id}`} className="flex-1 min-w-0 hover:opacity-80 transition-opacity">
        <div className="font-sans text-[14px] font-medium text-ink leading-snug">
          {task.title}
        </div>
        <div className="mt-1 flex items-center gap-2 flex-wrap">
          {task.project?.name && (
            <span className="font-sans text-[11px] text-ink-3">{task.project.name}</span>
          )}
          {showCadence && task.recurrence_rule && isRecurrencePattern(task.recurrence_rule) && (
            <span className="font-mono text-[9px] tracking-[0.05em] px-1.5 py-px bg-surface-2 text-ink-3">
              ↻ {RECURRENCE_LABELS[task.recurrence_rule]}
            </span>
          )}
        </div>
      </Link>

      <div className="flex items-center gap-2.5 shrink-0 pt-0.5">
        <span
          className={`font-mono text-[10px] tabular-nums ${overdue ? 'text-accent' : 'text-ink-3'}`}
        >
          {dueLabel(task.due_date, today)}
        </span>
      </div>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function cadenceNoun(c: Exclude<Cadence, 'all'>): string {
  return { monthly: 'monthly', quarterly: 'quarterly', semiannually: 'semi-annual', yearly: 'annual' }[c];
}

// "overdue 12d" / "today" / "in 3w" + the date itself. Relative phrasing
// is what an audit view is for — "in 5 months" reads instantly, a bare
// date makes you do calendar math.
function dueLabel(due: string | null | undefined, today: string): string {
  if (!due) return 'no date';
  const days = Math.round(
    (Date.parse(due + 'T12:00:00Z') - Date.parse(today + 'T12:00:00Z')) / 86_400_000,
  );
  const date = due.slice(5).replace('-', '/');
  if (days === 0) return 'today';
  if (days < 0) return `${date} · ${-days}d over`;
  if (days < 14) return `${date} · in ${days}d`;
  if (days < 70) return `${date} · in ${Math.round(days / 7)}w`;
  return `${date} · in ${Math.round(days / 30)}mo`;
}

function sortByDueAsc(list: Task[]): Task[] {
  // No-date items sink to the bottom — they're the ones needing setup.
  return [...list].sort((a, b) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999'));
}
