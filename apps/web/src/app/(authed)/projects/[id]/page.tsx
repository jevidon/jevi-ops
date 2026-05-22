import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ScreenHeader } from '@/components/ScreenHeader';
import { TaskItem } from '@/components/TaskItem';
import {
  projectsApi,
  ApiError,
  type ProjectDetail,
  type Milestone,
  type ActivityLogEntry,
} from '@/lib/api';
import { isToday } from '@/lib/today';
import { ProjectColorPicker } from './color-picker';

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
  let errorMessage: string | null = null;

  try {
    detail = await projectsApi.get(id);
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

  const { project, milestones, tasks, activity } = detail;
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

      {/* Milestones */}
      {milestones.length > 0 && (
        <Section
          label={`Milestones · ${formatMilestoneProgress(milestones)}`}
        >
          <ul>
            {milestones.map((m) => (
              <MilestoneRow key={m.id} milestone={m} />
            ))}
          </ul>
        </Section>
      )}

      {/* Open tasks */}
      <Section label={`Open tasks · ${openTasks.length}`}>
        {openTasks.length === 0 ? (
          <p className="font-sans text-[13px] text-ink-3 italic py-1">No open tasks.</p>
        ) : (
          openTasks.map((t) => <TaskItem key={t.id} task={t} showStar={false} showProject={false} />)
        )}
      </Section>

      {/* Activity log */}
      <Section label={`Activity · ${activity.length}`}>
        {activity.length === 0 ? (
          <p className="font-sans text-[13px] text-ink-3 italic py-1">
            No activity logged. Voice command: "log thirty minutes on {project.name} reviewing PR feedback".
          </p>
        ) : (
          <ul>
            {activity.map((a) => (
              <ActivityRow key={a.id} entry={a} />
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

function MilestoneRow({ milestone }: { milestone: Milestone }) {
  const isDone = milestone.status === 'done';
  return (
    <li className="flex items-start gap-3 py-2.5 border-b border-line/40 last:border-b-0">
      <span
        className={`mt-0.5 flex h-5 w-5 items-center justify-center border ${
          isDone ? 'border-ink-2 bg-ink-2' : 'border-line'
        }`}
        aria-hidden
      >
        {isDone && (
          <svg viewBox="0 0 16 16" className="h-3 w-3 text-bg">
            <path
              d="M3 8l3 3 7-7"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </span>
      <div className="flex-1 min-w-0">
        <div
          className={`font-sans text-[14px] leading-snug ${
            isDone ? 'text-ink-3 line-through decoration-ink-3/60' : 'text-ink'
          }`}
        >
          {milestone.title}
        </div>
        {milestone.weight !== 1 && (
          <div className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-ink-3">
            weight {milestone.weight}
          </div>
        )}
      </div>
    </li>
  );
}

function ActivityRow({ entry }: { entry: ActivityLogEntry }) {
  const when = new Date(entry.logged_at).toLocaleString('en-US', {
    timeZone: 'America/Denver',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
  return (
    <li className="flex items-start gap-4 py-2.5 border-b border-line/40 last:border-b-0">
      <span className="font-mono text-[10px] uppercase tracking-wider text-ink-3 w-24 pt-1 shrink-0">
        {when}
      </span>
      <div className="flex-1 min-w-0">
        <div className="font-sans text-[13px] text-ink leading-snug">{entry.entry}</div>
        {entry.hours_logged != null && Number(entry.hours_logged) > 0 && (
          <div className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-ink-3">
            {Number(entry.hours_logged).toFixed(2)}h
            {entry.source === 'voice' && ' · voice'}
          </div>
        )}
      </div>
    </li>
  );
}

function formatMilestoneProgress(milestones: Milestone[]): string {
  const totalWeight = milestones.reduce((s, m) => s + m.weight, 0);
  if (totalWeight === 0) return '0%';
  const doneWeight = milestones
    .filter((m) => m.status === 'done')
    .reduce((s, m) => s + m.weight, 0);
  return `${Math.round((doneWeight / totalWeight) * 100)}%`;
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
