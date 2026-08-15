import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ScreenHeader } from '@/components/ScreenHeader';
import { tasksApi, projectsApi, contentApi, domainsApi, ApiError } from '@/lib/api';
import { getAppTimezone } from '@/lib/app-settings';
import { todayIsoDate } from '@/lib/today';
import type { Task } from '@jevi-ops/shared';
import { INBOX_DOMAIN_ID } from '@jevi-ops/shared';
import { TaskForm } from '../task-form';
import { SubtasksSection } from './subtasks-section';
import { setTaskStatusAction } from './actions';

// /tasks/[id] — task detail + edit. Lets you change everything voice would
// normally set (title, notes, due, priority, project, content_item) plus delete.

export default async function TaskDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const tz = await getAppTimezone();

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
      <div>
        <ScreenHeader eyebrow="Task" title="—" />
        <div className="hairline" />
        <div className="px-5 lg:px-0 mt-6 font-sans text-[13px] text-ink-3">
          {errorMessage ?? 'Task not found.'}
        </div>
      </div>
    );
  }

  const meta = [
    task.status === 'done' ? 'Done' : task.status === 'waiting' ? 'Waiting' : 'Open',
    task.source && task.source !== 'manual' ? `via ${task.source}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  // Waiting aging day-count (Addendum 08): today − waiting_since, in app tz.
  const waitDays = task.waiting_since
    ? Math.max(0, Math.round(
        (Date.parse(todayIsoDate(tz)) - Date.parse(task.waiting_since)) / 86_400_000,
      ))
    : null;

  return (
    <div>
      <div className="px-5 lg:px-0 pt-4 pb-1 font-mono text-[10px] uppercase tracking-wider text-ink-3">
        <Link href="/tasks" className="hover:text-ink-2 transition-colors">
          ← Tasks
        </Link>
      </div>

      <ScreenHeader
        eyebrow={meta}
        title={task.title}
        meta={`Created ${new Date(task.created_at).toLocaleDateString('en-US', { timeZone: tz, month: 'short', day: 'numeric' })}`}
      />
      <div className="hairline mb-4" />

      {/* Status control — complete / reopen / waiting (Addendum 08). */}
      <div className="px-5 lg:px-0 mb-5 flex flex-wrap items-center gap-3">
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
                className="px-3 py-1.5 border border-line text-ink-2 hover:border-ink-2 hover:text-ink font-mono text-[10px] uppercase tracking-wider transition-colors"
              >
                Mark waiting
              </button>
            </form>
          </>
        )}
      </div>

      <div className="px-5 lg:px-0 max-w-xl">
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
            remind_minutes: task.reminder_offsets?.length
              ? Math.min(...task.reminder_offsets)
              : '',
            recurrence_rule: task.recurrence_rule ?? '',
          }}
          domains={domains}
          projects={projects}
          contentItems={contentItems}
          projectMilestones={projectMilestones}
        />

        {/* Subtasks ledger (fork) — only on tasks that aren't subtasks
            themselves; hierarchy is one level deep by design. */}
        {!task.parent_task_id && (
          <div className="mt-10">
            <SubtasksSection parent={task} subtasks={subtasks} />
          </div>
        )}
      </div>
    </div>
  );
}

// Small status-change button (Addendum 08) — a form posting setTaskStatusAction.
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
            ? 'px-3 py-1.5 border border-line text-ink-2 hover:border-ink-2 hover:text-ink font-mono text-[10px] uppercase tracking-wider transition-colors'
            : 'px-4 py-2 bg-ink text-bg font-mono text-[11px] uppercase tracking-wider hover:bg-ink-2 transition-colors'
        }
      >
        {label}
      </button>
    </form>
  );
}
