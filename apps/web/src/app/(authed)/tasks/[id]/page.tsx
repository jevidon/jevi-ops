import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SetCrumbs } from '@/components/crumbs/crumbs';
import { buildTaskTrail } from '@/components/crumbs/task-trail';
import { Pill } from '@/components/Pill';
import {
  DetailHeader, CrumbDot, StatStrip, Stat, DetailBody, DetailSection, RailBlock,
} from '@/components/detail/DetailShell';
import { EditDrawer } from '@/components/detail/EditDrawer';
import { PinButton } from '@/components/PinButton';
import { tasksApi, projectsApi, contentApi, domainsApi, ApiError } from '@/lib/api';
import { getAppTimezone } from '@/lib/app-settings';
import { todayIsoDate } from '@/lib/today';
import type { Task } from '@jevi-ops/shared';
import { INBOX_DOMAIN_ID } from '@jevi-ops/shared';
import { TaskForm } from '../task-form';
import { SubtasksSection } from './subtasks-section';
import { setTaskStatusAction } from './actions';

// /tasks/[id] — task detail (Detail Pages v2 adoption, Aug 2026). Same anatomy
// as the project page: header band (surface bg, status controls riding in it,
// the full edit form behind the Edit drawer) → computed stat strip → two-column
// read layout (notes + subtasks left, stable details right).

const SOURCE_LABEL: Record<string, string> = {
  voice: 'via voice', email: 'via email', observation: 'via observation', import: 'imported',
};

export default async function TaskDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const tz = await getAppTimezone();
  const today = todayIsoDate(tz);

  let task: Task | null = null;
  let errorMessage: string | null = null;
  let projects: { id: string; name: string; domain_id: string | null }[] = [];
  let domains: { id: string; name: string; is_system?: boolean }[] = [];
  let contentItems: { id: string; title: string }[] = [];

  const [taskRes, projectsRes, domainsRes, contentRes, milestonesRes, subtasksRes] = await Promise.allSettled([
    tasksApi.get(id),
    projectsApi.list(),
    domainsApi.list(),
    contentApi.list(),
    projectsApi.milestones.listAll(),
    // Fork: children of this task for the subtasks ledger (one level deep).
    tasksApi.list({ parent_task_id: id }),
  ]);
  const subtasks: Task[] = subtasksRes.status === 'fulfilled' ? subtasksRes.value.tasks : [];

  if (taskRes.status === 'fulfilled') {
    task = taskRes.value;
  } else if (taskRes.reason instanceof ApiError && taskRes.reason.status === 404) {
    notFound();
  } else {
    const err = taskRes.reason;
    errorMessage = err instanceof ApiError ? `API ${err.status}` : (err as Error).message;
  }

  if (projectsRes.status === 'fulfilled') {
    projects = projectsRes.value.projects
      .filter((p) => p.status === 'active')
      .map((p) => ({ id: p.id, name: p.name, domain_id: p.domain?.id ?? null }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  if (domainsRes.status === 'fulfilled') {
    domains = domainsRes.value.domains
      .map((d) => ({ id: d.id, name: d.name, is_system: d.is_system === true }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  if (contentRes.status === 'fulfilled') {
    // Pre-filter to "in progress" (anything not done/published) so the
    // dropdown isn't 100+ historical items.
    contentItems = contentRes.value.items
      .filter((c) => c.status !== 'done' && c.status !== 'published')
      .map((c) => ({ id: c.id, title: c.title }))
      .sort((a, b) => a.title.localeCompare(b.title));
  }

  // The task's CURRENT link must always be an option, even when the filters
  // above (or archiving, Addendum 09) would exclude it. Without this the
  // <select> falls back to its first option — "(none)" — and the next save of
  // any unrelated field silently drops the link. Mirrors /tasks/new's
  // deep-link fallback.
  if (task?.content_item_id && !contentItems.some((c) => c.id === task!.content_item_id)) {
    try {
      const linked = await contentApi.get(task.content_item_id);
      contentItems.unshift({ id: linked.id, title: linked.title });
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
    }
  }

  // Milestones grouped by project — powers the task form's milestone picker
  // (Addendum 08). Only the selected project's list is shown.
  const projectMilestones: Record<string, { id: string; title: string; status?: 'open' | 'done' }[]> = {};
  if (milestonesRes.status === 'fulfilled') {
    for (const m of milestonesRes.value.milestones) {
      (projectMilestones[m.project_id] ??= []).push({ id: m.id, title: m.title, status: m.status });
    }
  }

  if (!task) {
    return (
      <div className="px-5 lg:px-8 pt-8">
        <h1 className="font-serif text-[40px] font-medium tracking-[-0.022em] text-ink">—</h1>
        <p className="mt-4 font-sans text-[13px] text-ink-3">{errorMessage ?? 'Task not found.'}</p>
      </div>
    );
  }

  // Waiting aging day-count (Addendum 08): today − waiting_since, in app tz.
  const waitDays = task.waiting_since
    ? Math.max(0, Math.round((Date.parse(today) - Date.parse(task.waiting_since)) / 86_400_000))
    : null;

  const overdue = task.status === 'open' && task.due_date != null && task.due_date < today;

  // Header state chip — status first, then due pressure.
  const state: { s: 'over' | 'due' | 'ok' | 'quiet'; label: string } =
    task.status === 'done' ? { s: 'quiet', label: 'Done' }
    : task.status === 'waiting' ? { s: 'due', label: waitDays != null ? `Waiting · ${waitDays}d` : 'Waiting' }
    : overdue ? { s: 'over', label: 'Overdue' }
    : task.due_date === today ? { s: 'due', label: 'Due today' }
    : { s: 'ok', label: 'Open' };

  const doneSubtasks = subtasks.filter((s) => s.status === 'done').length;
  const milestoneTitle = task.milestone_id && task.project_id
    ? projectMilestones[task.project_id]?.find((m) => m.id === task!.milestone_id)?.title ?? null
    : null;
  const reminder = task.reminder_offsets?.length ? Math.min(...task.reminder_offsets) : null;

  return (
    <div>
      {/* Ancestor context lives in the header trail (Topbar / MobileCrumbs)
          now — no in-page back link. */}
      <SetCrumbs trail={buildTaskTrail(task)} />

      <DetailHeader
        titleClass="text-[33px]"
        crumb={
          <>
            <Link href="/tasks" className="hover:text-ink-2 transition-colors">Task</Link>
            {task.source !== 'manual' && (<><CrumbDot /><span>{SOURCE_LABEL[task.source] ?? `via ${task.source}`}</span></>)}
            {task.recurrence_rule && (<><CrumbDot /><span>Repeats</span></>)}
          </>
        }
        name={task.title}
        state={<Pill state={state.s}>{state.label}</Pill>}
        actions={
          <>
            <PinButton targetType="task" targetId={task.id} path={`/tasks/${task.id}`} />
            <EditDrawer title="Edit task">
            <TaskForm
              initial={{
                id: task.id,
                title: task.title,
                notes: task.notes ?? '',
                due_date: task.due_date ?? '',
                due_time: task.due_time ?? '',
                priority: task.priority,
                // Selection encodes "where this task lives": project takes
                // precedence (it implies the domain too); else direct domain;
                // else Inbox as a safe fallback (shouldn't normally happen
                // post-migration since domain_id is NOT NULL).
                selection: task.project_id
                  ? `project:${task.project_id}`
                  : task.domain_id
                    ? `domain:${task.domain_id}`
                    : `domain:${INBOX_DOMAIN_ID}`,
                milestone_id: task.milestone_id ?? '',
                content_item_id: task.content_item_id ?? '',
                // Surface the first reminder offset in the single-select UI.
                // Multi-offset reminders (set via voice) keep all offsets but
                // we show the smallest one as the "primary" in the form.
                remind_minutes: reminder ?? '',
                recurrence_rule: task.recurrence_rule ?? '',
              }}
              domains={domains}
              projects={projects}
              contentItems={contentItems}
              projectMilestones={projectMilestones}
            />
          </EditDrawer>
          </>
        }
        below={
          // Status controls — complete / reopen / waiting (Addendum 08),
          // riding inside the header band under the title.
          <div className="mt-4 flex flex-wrap items-center gap-3">
            {task.status === 'done' ? (
              <>
                <span className="font-mono text-[10px] uppercase tracking-wider text-ink-3">✓ Completed</span>
                <StatusButton taskId={task.id} status="open" label="Reopen" ghost />
              </>
            ) : task.status === 'waiting' ? (
              <>
                <span className="font-mono text-[10px] uppercase tracking-wider text-ink-2">
                  ⏸ Waiting{task.waiting_on ? ` on ${task.waiting_on}` : ''}
                  {waitDays != null && <span className="text-ink-3"> · {waitDays}d</span>}
                </span>
                <StatusButton taskId={task.id} status="open" label="Back to open" ghost />
                <StatusButton taskId={task.id} status="done" label="Complete" />
              </>
            ) : (
              <>
                <StatusButton
                  taskId={task.id}
                  status="done"
                  label={task.recurrence_rule ? 'Complete · rolls to next' : 'Mark complete'}
                />
                <form action={setTaskStatusAction} className="flex items-center gap-1.5">
                  <input type="hidden" name="taskId" value={task.id} />
                  <input type="hidden" name="status" value="waiting" />
                  <input
                    name="waiting_on"
                    placeholder="waiting on…"
                    className="w-40 bg-transparent border-b border-line focus:border-accent focus:outline-none py-1 font-sans text-[13px] text-ink placeholder:text-ink-3/60"
                  />
                  <button
                    type="submit"
                    className="h-[34px] px-3 rounded border border-line-strong bg-bg text-ink-2 hover:border-ink-3 hover:text-ink font-mono text-[10px] font-semibold uppercase tracking-[0.07em] transition-colors"
                  >
                    Mark waiting
                  </button>
                </form>
              </>
            )}
          </div>
        }
      />

      <StatStrip>
        <Stat
          label="Due"
          value={task.due_date ? fmtShort(task.due_date, tz) : '—'}
          unit={task.due_time ? task.due_time.slice(0, 5) : undefined}
          tone={overdue ? 'accent' : undefined}
          sub={overdue ? 'past due' : task.recurrence_rule ? `repeats · ${task.recurrence_rule}` : task.due_date ? undefined : 'no due date'}
        />
        <Stat label="Priority" value={`P${task.priority}`} sub={task.priority === 1 ? 'highest' : undefined} />
        <Stat label="Where">
          <div className="font-serif text-[19px] leading-tight tracking-[-0.01em] text-ink truncate">
            {task.project ? (
              <Link href={`/projects/${task.project.id}`} className="hover:text-accent transition-colors">
                {task.project.name}
              </Link>
            ) : task.domain ? (
              <Link href={`/domains/${task.domain.id}`} className="hover:text-accent transition-colors">
                {task.domain.name}
              </Link>
            ) : (
              '—'
            )}
          </div>
          {task.project && task.domain && (
            <div className="mt-1.5 font-mono text-[10px] tracking-[0.02em] text-ink-4">{task.domain.name}</div>
          )}
        </Stat>
        {task.status === 'done' && task.completed_at ? (
          <Stat label="Completed" value={fmtShort(task.completed_at, tz)} />
        ) : subtasks.length > 0 ? (
          <Stat label="Subtasks" value={`${doneSubtasks}/${subtasks.length}`} sub="done" />
        ) : (
          <Stat label="Created" value={fmtShort(task.created_at, tz)} />
        )}
      </StatStrip>

      <DetailBody
        main={
          <>
            <DetailSection label="Notes" className="mt-0">
              {task.notes ? (
                <p className="font-sans text-[14px] text-ink leading-relaxed whitespace-pre-wrap">{task.notes}</p>
              ) : (
                <p className="font-sans text-[13px] text-ink-3 italic py-1">No notes — add some via Edit.</p>
              )}
            </DetailSection>

            {/* Subtasks ledger (fork) — only on tasks that aren't subtasks
                themselves; hierarchy is one level deep by design. */}
            {!task.parent_task_id && (
              <div className="mt-8">
                <SubtasksSection parent={task} subtasks={subtasks} />
              </div>
            )}
          </>
        }
        rail={
          <RailBlock label="Details">
            {task.domain && <KV k="Domain" v={task.domain.is_system ? 'Inbox' : task.domain.name} />}
            {task.project && <KV k="Project" v={task.project.name} />}
            {milestoneTitle && <KV k="Milestone" v={milestoneTitle} />}
            {task.content_item && <KV k="Content" v={task.content_item.title} />}
            {task.parent_task && <KV k="Parent task" v={task.parent_task.title} />}
            {task.waiting_on && <KV k="Waiting on" v={task.waiting_on} />}
            {reminder != null && <KV k="Reminder" v={fmtReminder(reminder)} />}
            {task.recurrence_rule && <KV k="Repeats" v={task.recurrence_rule} />}
            <KV k="Source" v={task.source} />
            <KV k="Created" v={fmtShort(task.created_at, tz)} />
            {task.completed_at && <KV k="Completed" v={fmtShort(task.completed_at, tz)} />}
          </RailBlock>
        }
      />
    </div>
  );
}

// Small status-change button (Addendum 08) — a form posting setTaskStatusAction,
// styled to sit with the header band's action buttons.
function StatusButton({
  taskId, status, label, ghost,
}: {
  taskId: string;
  status: 'open' | 'waiting' | 'done';
  label: string;
  ghost?: boolean;
}) {
  return (
    <form action={setTaskStatusAction}>
      <input type="hidden" name="taskId" value={taskId} />
      <input type="hidden" name="status" value={status} />
      <button
        type="submit"
        className={
          ghost
            ? 'h-[34px] px-3 rounded border border-line-strong bg-bg text-ink-2 hover:border-ink-3 hover:text-ink font-mono text-[10px] font-semibold uppercase tracking-[0.07em] transition-colors'
            : 'h-[34px] px-4 rounded bg-ink border border-ink text-bg hover:bg-ink-2 font-mono text-[10px] font-semibold uppercase tracking-[0.07em] transition-colors'
        }
      >
        {label}
      </button>
    </form>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="font-mono text-[10px] uppercase tracking-[0.04em] text-ink-3 shrink-0">{k}</span>
      <span className="font-sans text-[13.5px] text-ink text-right min-w-0 break-words">{v}</span>
    </div>
  );
}

function fmtShort(iso: string, tz: string): string {
  const d = iso.length === 10 ? new Date(`${iso}T12:00:00Z`) : new Date(iso);
  return d.toLocaleDateString('en-US', { timeZone: tz, month: 'short', day: 'numeric' });
}

function fmtReminder(minutes: number): string {
  if (minutes % 1440 === 0) { const d = minutes / 1440; return `${d} day${d === 1 ? '' : 's'} before`; }
  if (minutes % 60 === 0) { const h = minutes / 60; return `${h} hr before`; }
  return `${minutes} min before`;
}
