import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ScreenHeader } from '@/components/ScreenHeader';
import { TaskItem } from '@/components/TaskItem';
import {
  projectsApi,
  domainsApi,
  tasksApi,
  ApiError,
  type ProjectDetail,
} from '@/lib/api';
import { isToday } from '@/lib/today';
import { getAppTimezone } from '@/lib/app-settings';
import type { Task } from '@jevi-ops/shared';
import { ProjectColorPicker } from './color-picker';
import { ProjectStatusChips } from './status-chips';
import { ProjectForm } from '../project-form';
import { MilestonesSection } from './milestones-section';
import { ChecklistSection } from './checklist-section';
import { LogTimeForm } from './log-time-form';
import { ActivityRow } from './activity-row';

// /projects/[id] — project detail. Mirrors the mockup's project detail:
// header with status/hours/target, weighted milestone progress, open tasks,
// activity log, completed tasks.

const STATUS_LABELS: Record<string, string> = {
  active: 'Active',
  paused: 'Paused',
  done: 'Done',
  archived: 'Archived',
};

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const tz = await getAppTimezone();

  let detail: ProjectDetail | null = null;
  let domains: { id: string; name: string }[] = [];
  let errorMessage: string | null = null;

  try {
    const [detailRes, domainsRes] = await Promise.all([
      projectsApi.get(id),
      domainsApi.list(),
    ]);
    detail = detailRes;
    domains = domainsRes.domains.map((d) => ({ id: d.id, name: d.name }));
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      notFound();
    }
    errorMessage = err instanceof ApiError ? `API ${err.status}` : (err as Error).message;
  }

  if (!detail) {
    return (
      <div>
        <ScreenHeader eyebrow="Project" title="—" />
        <div className="hairline" />
        <div className="px-5 lg:px-0 mt-6 font-sans text-[13px] text-ink-3">
          {errorMessage ?? 'Project not found.'}
        </div>
      </div>
    );
  }

  const { project, milestones, tasks, activity, checklist } = detail;
  const isArea = project.kind === 'area';
  const isRetainer = !isArea && project.engagement_type === 'retainer';
  const openTasks = tasks.filter((t) => t.status === 'open');
  const doneTasks = tasks
    .filter((t) => t.status === 'done')
    .sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? ''));
  const doneToday = doneTasks.filter((t) => isToday(tz, t.completed_at ?? null));

  // Group open tasks by parent (one level deep). Children group under
  // their parent even when the parent is done or isn't attached to this
  // project — parents missing from the project's task list are fetched
  // by id and rendered as group headers, so subtasks never sit flat at
  // the root. Only a parent that can't be fetched at all (deleted
  // mid-request) drops its children back to the loose list.
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const childrenByParent = new Map<string, Task[]>();
  for (const t of tasks) {
    if (!t.parent_task_id) continue;
    const list = childrenByParent.get(t.parent_task_id) ?? [];
    list.push(t);
    childrenByParent.set(t.parent_task_id, list);
  }
  const externalParentIds = [...childrenByParent.keys()].filter((pid) => !taskById.has(pid));
  const externalParents = new Map<string, Task>();
  if (externalParentIds.length > 0) {
    const fetched = await Promise.allSettled(externalParentIds.map((pid) => tasksApi.get(pid)));
    for (const r of fetched) {
      if (r.status === 'fulfilled') externalParents.set(r.value.id, r.value);
    }
  }
  const parentFor = (pid: string): Task | null =>
    taskById.get(pid) ?? externalParents.get(pid) ?? null;
  // Group order: open project parents first (list order), then done or
  // external parents in order of their first open child's appearance.
  const groupIds: string[] = [];
  for (const t of openTasks) {
    if (!t.parent_task_id && (childrenByParent.get(t.id)?.length ?? 0) > 0) groupIds.push(t.id);
  }
  for (const t of openTasks) {
    const pid = t.parent_task_id;
    if (!pid || groupIds.includes(pid)) continue;
    if (parentFor(pid)) groupIds.push(pid);
  }
  const looseTasks = openTasks.filter(
    (t) =>
      (!t.parent_task_id && (childrenByParent.get(t.id)?.length ?? 0) === 0) ||
      (t.parent_task_id != null && !parentFor(t.parent_task_id)),
  );

  const hoursLogged = Number(project.hours_logged ?? 0);
  const quoted = project.quoted_hours != null ? Number(project.quoted_hours) : null;
  const hoursThisMonth = Number(detail.hours_this_month ?? 0);
  const hoursLastMonth = Number(detail.hours_last_month ?? 0);
  const meta = [
    isArea ? 'Area' : isRetainer ? 'Retainer' : null,
    project.domain?.name,
    project.status !== 'active' ? STATUS_LABELS[project.status] : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div>
      <div className="px-5 lg:px-0 pt-4 pb-1 font-mono text-[10px] uppercase tracking-wider text-ink-3">
        <Link href="/projects" className="hover:text-ink-2 transition-colors">
          ← All projects
        </Link>
      </div>

      <ScreenHeader
        eyebrow={meta || (isArea ? 'Area' : 'Project')}
        title={
          project.color
            ? (
                <span className="inline-flex items-center gap-3">
                  <span className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: project.color }} aria-hidden />
                  <span>{project.name}</span>
                </span>
              )
            : project.name
        }
        meta={
          project.target_date
            ? `Target ${formatTargetDate(project.target_date, tz)}`
            : undefined
        }
      />
      <div className="hairline" />

      {/* Status + color row. Areas don't follow the project lifecycle
          (active/paused/done/archived) — they're ongoing contexts — so
          the chip row is project-only. */}
      <div className="px-5 lg:px-0 pt-5 flex flex-col gap-3">
        {!isArea && (
          <ProjectStatusChips
            projectId={project.id}
            current={project.status as 'active' | 'paused' | 'done' | 'archived'}
          />
        )}
        <ProjectColorPicker projectId={project.id} current={project.color ?? null} />
      </div>

      {/* Hours summary. Retainers lead with "this month" (the metric
          that matters for monthly caps) and show cumulative + last
          month as secondary context. Project-mode keeps the original
          cumulative + quoted display. */}
      {isRetainer ? (
        <Section label="Hours · this month">
          <div className="flex items-baseline gap-3 flex-wrap">
            <span className="font-serif text-[28px] text-ink leading-none">
              {hoursThisMonth.toFixed(1)}
            </span>
            {quoted != null && (
              <>
                <span className="font-mono text-[12px] text-ink-3">/</span>
                <span className="font-serif text-[20px] text-ink-2">{quoted.toFixed(1)}</span>
                <span className="font-mono text-[10px] uppercase tracking-wider text-ink-3">
                  monthly cap
                </span>
              </>
            )}
          </div>
          <div className="mt-2 font-mono text-[10px] uppercase tracking-wider text-ink-3 flex flex-wrap gap-x-4">
            <span>Last month · {hoursLastMonth.toFixed(1)}h</span>
            <span>All time · {hoursLogged.toFixed(1)}h</span>
          </div>
        </Section>
      ) : (
        <Section label="Hours">
          <div className="flex items-baseline gap-3">
            <span className="font-serif text-[28px] text-ink leading-none">
              {hoursLogged.toFixed(1)}
            </span>
            {quoted != null && (
              <>
                <span className="font-mono text-[12px] text-ink-3">/</span>
                <span className="font-serif text-[20px] text-ink-2">{quoted.toFixed(1)}</span>
                <span className="font-mono text-[10px] uppercase tracking-wider text-ink-3">
                  quoted
                </span>
              </>
            )}
          </div>
        </Section>
      )}

      {/* Milestones — hidden for retainers (no defined finish line) and
          for areas (areas don't complete, they hold tasks indefinitely). */}
      {!isRetainer && !isArea && (
        <MilestonesSection projectId={project.id} milestones={milestones} />
      )}

      {/* Open tasks — section header carries the "+ Add task" link so
          you can spin off real, due-dated, reminded tasks from anywhere
          inside the project. Mirrors the content detail page. */}
      <section className="px-5 lg:px-0 pt-6">
        <div className="eyebrow pb-2 border-b border-line mb-3 flex items-baseline justify-between">
          <span>Open tasks · {openTasks.length}</span>
          <Link
            href={`/tasks/new?project_id=${project.id}`}
            className="font-mono text-[10px] uppercase tracking-wider text-ink-3 hover:text-accent transition-colors"
          >
            + Add task
          </Link>
        </div>
        {openTasks.length === 0 ? (
          <p className="font-sans text-[13px] text-ink-3 italic py-1">No open tasks.</p>
        ) : (
          <>
            {groupIds.map((pid) => {
              const parent = parentFor(pid);
              if (!parent) return null;
              const kids = childrenByParent.get(pid) ?? [];
              const openKids = kids.filter((k) => k.status === 'open');
              const doneKidCount = kids.length - openKids.length;
              const parentDone = parent.status === 'done';
              return (
                <details key={pid} className="group border-b border-line">
                  <summary className="cursor-pointer list-none flex items-start gap-3 py-2">
                    <span
                      className="flex h-5 w-5 shrink-0 items-center justify-center pt-0.5 font-mono text-[10px] text-ink-3 transition-transform group-open:rotate-90"
                      aria-hidden
                    >
                      ▶
                    </span>
                    <Link
                      href={`/tasks/${parent.id}`}
                      className={`flex-1 min-w-0 font-sans text-[14px] leading-snug transition-colors pt-0.5 ${
                        parentDone
                          ? 'text-ink-3 line-through decoration-ink-3/60 hover:text-ink-2'
                          : 'text-ink hover:text-accent'
                      }`}
                    >
                      {parent.title}
                    </Link>
                    <span className="shrink-0 mt-0.5 bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] tracking-wider text-ink-2">
                      {doneKidCount} / {kids.length}
                    </span>
                  </summary>
                  <div className="ml-[9px] border-l border-line-strong pl-4 pb-2">
                    {openKids.map((k) => (
                      <TaskItem key={k.id} task={k} showStar={false} showProject={false} />
                    ))}
                    {openKids.length === 0 && (
                      <p className="font-sans text-[13px] text-ink-3 italic py-1">
                        All subtasks done.
                      </p>
                    )}
                  </div>
                </details>
              );
            })}
            {looseTasks.map((t) => (
              <TaskItem key={t.id} task={t} showStar={false} showProject={false} />
            ))}
          </>
        )}
      </section>

      {/* Per-project ad-hoc checklist. Use for granular sub-steps below
          the bar for a full task. Separate from milestones (which roll
          up into project %) and tasks (which have due dates + reminders). */}
      <ChecklistSection projectId={project.id} items={checklist} />

      {/* Activity log — inline form for manual time entries above the
          feed. Voice still works ("log 30 min on X reviewing PR…") but
          the form is the fastest path on desktop. */}
      <Section label={`Activity · ${activity.length}`}>
        <LogTimeForm projectId={project.id} />
        {activity.length === 0 ? (
          <p className="font-sans text-[13px] text-ink-3 italic py-1">
            No activity logged yet. Use the form above, or say{' '}
            <span className="font-mono">log thirty minutes on {project.name} reviewing PR feedback</span>.
          </p>
        ) : (
          <>
            <ul>
              {activity.map((a) => (
                <ActivityRow key={a.id} entry={a} projectId={project.id} />
              ))}
            </ul>
            {/* Help text for the click-to-edit affordance, since it's a
                new pattern and not entirely obvious. */}
            <div className="mt-2 font-mono text-[10px] uppercase tracking-wider text-ink-3 italic">
              Click any row to edit the entry, hours, or timestamp.
            </div>
          </>
        )}
      </Section>

      {/* Done tasks (collapsible) */}
      {doneTasks.length > 0 && (
        <section className="px-5 lg:px-0 pt-6">
          <details className="group">
            <summary className="eyebrow pb-2 border-b border-line cursor-pointer list-none flex items-center justify-between hover:text-ink-2 transition-colors">
              <span>
                ✓ {doneTasks.length} done {doneToday.length > 0 ? `(${doneToday.length} today)` : ''}
              </span>
              <span className="font-mono text-[10px] text-ink-3 transition-transform group-open:rotate-90" aria-hidden>
                ▶
              </span>
            </summary>
            <div className="mt-3">
              {doneTasks.map((t) => (
                <TaskItem key={t.id} task={t} showStar={false} showProject={false} />
              ))}
            </div>
          </details>
        </section>
      )}

      {/* Edit + delete — collapsed by default to keep the focus on
          the project's content above. Click to expand. */}
      <section className="px-5 lg:px-0 mt-12 max-w-2xl">
        <details className="border border-line">
          <summary className="cursor-pointer px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-ink-3 hover:text-ink-2 transition-colors list-none">
            Edit {isArea ? 'area' : 'project'} ▾
          </summary>
          <div className="px-4 pb-4 pt-3 border-t border-line">
            <ProjectForm
              domains={domains}
              initial={{
                id: project.id,
                name: project.name,
                description: project.description ?? '',
                domain_id: project.domain_id ?? '',
                type: (project.type as '' | 'client' | 'internal' | 'content') ?? '',
                status: project.status as 'active' | 'paused' | 'done' | 'archived',
                engagement_type: project.engagement_type ?? 'project',
                kind: project.kind ?? 'project',
                quoted_hours: project.quoted_hours != null ? String(project.quoted_hours) : '',
                start_date: project.start_date ?? '',
                target_date: project.target_date ?? '',
                color: project.color ?? '',
              }}
            />
          </div>
        </details>
      </section>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="px-5 lg:px-0 pt-6">
      <div className="eyebrow pb-2 border-b border-line mb-3">{label}</div>
      {children}
    </section>
  );
}

function formatTargetDate(iso: string, tz: string): string {
  return new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', {
    timeZone: tz,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(new Date(iso).getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}),
  });
}
