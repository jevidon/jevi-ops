import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ScreenHeader } from '@/components/ScreenHeader';
import { tasksApi, projectsApi, contentApi, domainsApi, ApiError } from '@/lib/api';
import { getAppTimezone } from '@/lib/app-settings';
import type { Task } from '@jevi-ops/shared';
import { INBOX_DOMAIN_ID } from '@jevi-ops/shared';
import { TaskForm } from '../task-form';

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

  const [taskRes, projectsRes, domainsRes, contentRes] = await Promise.allSettled([
    tasksApi.get(id),
    projectsApi.list(),
    domainsApi.list(),
    contentApi.list(),
  ]);

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
    task.status === 'done' ? 'Done' : 'Open',
    task.source && task.source !== 'manual' ? `via ${task.source}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

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
        />
      </div>
    </div>
  );
}
