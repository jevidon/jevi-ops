import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ScreenHeader } from '@/components/ScreenHeader';
import { TaskItem } from '@/components/TaskItem';
import {
  projectsApi,
  domainsApi,
  ApiError,
  type ProjectDetail,
  type ActivityLogEntry,
} from '@/lib/api';
import { isToday } from '@/lib/today';
import { ProjectColorPicker } from './color-picker';
import { ProjectForm } from '../project-form';
import { MilestonesSection } from './milestones-section';
import { ChecklistSection } from './checklist-section';
import { LogTimeForm } from './log-time-form';
import { deleteActivityAction } from './activity-actions';

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
  const openTasks = tasks.filter((t) => t.status === 'open');
  const doneTasks = tasks
    .filter((t) => t.status === 'done')
    .sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? ''));
  const doneToday = doneTasks.filter((t) => isToday(t.completed_at ?? null));

  const hoursLogged = Number(project.hours_logged ?? 0);
  const quoted = project.quoted_hours != null ? Number(project.quoted_hours) : null;
  const meta = [
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
        eyebrow={meta || 'Project'}
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
            ? `Target ${formatTargetDate(project.target_date)}`
            : undefined
        }
      />
      <div className="hairline" />

      {/* Color picker row */}
      <div className="px-5 lg:px-0 pt-5">
        <ProjectColorPicker projectId={project.id} current={project.color ?? null} />
      </div>

      {/* Hours summary */}
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

      {/* Milestones — always visible; the section itself shows an empty
          state + add form when there are none. */}
      <MilestonesSection projectId={project.id} milestones={milestones} />

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
          openTasks.map((t) => <TaskItem key={t.id} task={t} showStar={false} showProject={false} />)
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
          <ul>
            {activity.map((a) => (
              <ActivityRow key={a.id} entry={a} projectId={project.id} />
            ))}
          </ul>
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
            Edit project ▾
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

function ActivityRow({ entry, projectId }: { entry: ActivityLogEntry; projectId: string }) {
  const when = new Date(entry.logged_at).toLocaleString('en-US', {
    timeZone: 'America/Denver',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
  const hours = Number(entry.hours_logged ?? 0);
  return (
    <li className="flex items-start gap-4 py-2.5 border-b border-line/40 last:border-b-0 group">
      <span className="font-mono text-[10px] uppercase tracking-wider text-ink-3 w-24 pt-1 shrink-0">
        {when}
      </span>
      <div className="flex-1 min-w-0">
        <div className="font-sans text-[13px] text-ink leading-snug">{entry.entry}</div>
        {hours > 0 && (
          <div className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-ink-3">
            {hours.toFixed(2)}h
            {entry.source === 'voice' && ' · voice'}
            {entry.source === 'manual' && ' · manual'}
          </div>
        )}
      </div>
      <form
        action={deleteActivityAction}
        className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <input type="hidden" name="project_id" value={projectId} />
        <input type="hidden" name="entry_id" value={entry.id} />
        <button
          type="submit"
          aria-label="Delete entry"
          title={hours > 0 ? `Delete · rolls back ${hours.toFixed(2)}h` : 'Delete entry'}
          className="font-mono text-[10px] uppercase tracking-wider text-ink-3 hover:text-accent transition-colors pt-1"
        >
          ✕
        </button>
      </form>
    </li>
  );
}

function formatTargetDate(iso: string): string {
  return new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', {
    timeZone: 'America/Denver',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(new Date(iso).getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}),
  });
}
