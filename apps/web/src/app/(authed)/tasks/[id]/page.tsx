import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ScreenHeader } from '@/components/ScreenHeader';
import { tasksApi, projectsApi, ApiError } from '@/lib/api';
import type { Task } from '@jerad-ops/shared';
import { EditTaskForm } from './edit-form';

// /tasks/[id] — task detail + edit. Lets you change everything voice would
// normally set (title, notes, due, priority, project) plus delete.

export default async function TaskDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let task: Task | null = null;
  let errorMessage: string | null = null;
  let projects: { id: string; name: string }[] = [];

  // Fetch task + projects list (for the project selector) in parallel.
  const [taskRes, projectsRes] = await Promise.allSettled([
    tasksApi.get(id),
    projectsApi.list(),
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
      .map((p) => ({ id: p.id, name: p.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
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
        <Link href="/today" className="hover:text-ink-2 transition-colors">
          ← Today
        </Link>
      </div>

      <ScreenHeader
        eyebrow={meta}
        title={task.title}
        meta={`Created ${new Date(task.created_at).toLocaleDateString('en-US', { timeZone: 'America/Denver', month: 'short', day: 'numeric' })}`}
      />
      <div className="hairline mb-4" />

      <div className="px-5 lg:px-0 max-w-xl">
        <EditTaskForm
          initial={{
            id: task.id,
            title: task.title,
            notes: task.notes ?? '',
            due_date: task.due_date ?? '',
            due_time: task.due_time ?? '',
            priority: task.priority,
            project_id: task.project_id ?? '',
          }}
          projects={projects}
        />
      </div>
    </div>
  );
}
