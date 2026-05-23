import Link from 'next/link';
import { ScreenHeader } from '@/components/ScreenHeader';
import { projectsApi, contentApi, ApiError } from '@/lib/api';
import { TaskForm } from '../task-form';

// /tasks/new — full-editor task creation. The /today page still has the
// quick "+ Add task" inline (title only); this page is for when you want
// to set due date, priority, project, and content_item up front.

export default async function NewTaskPage({
  searchParams,
}: {
  searchParams: Promise<{ project_id?: string; content_item_id?: string }>;
}) {
  const { project_id: preProject, content_item_id: preContent } = await searchParams;

  let projects: { id: string; name: string }[] = [];
  let contentItems: { id: string; title: string }[] = [];

  const [projectsRes, contentRes] = await Promise.allSettled([
    projectsApi.list(),
    contentApi.list(),
  ]);

  if (projectsRes.status === 'fulfilled') {
    projects = projectsRes.value.projects
      .filter((p) => p.status === 'active')
      .map((p) => ({ id: p.id, name: p.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  if (contentRes.status === 'fulfilled') {
    contentItems = contentRes.value.items
      .filter((c) => c.status !== 'done' && c.status !== 'published')
      .map((c) => ({ id: c.id, title: c.title }))
      .sort((a, b) => a.title.localeCompare(b.title));
  }

  // If we got here via a deep link from a content item, include that even
  // if it's already published/done — the user clearly wants this link.
  if (preContent && !contentItems.find((c) => c.id === preContent)) {
    try {
      const c = await contentApi.get(preContent);
      contentItems.unshift({ id: c.id, title: c.title });
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
    }
  }

  return (
    <div>
      <div className="px-5 lg:px-0 pt-4 pb-1 font-mono text-[10px] uppercase tracking-wider text-ink-3">
        <Link href="/tasks" className="hover:text-ink-2 transition-colors">
          ← Tasks
        </Link>
      </div>

      <ScreenHeader eyebrow="Capture" title="New task" meta="Full editor" />
      <div className="hairline mb-4" />

      <div className="px-5 lg:px-0 max-w-xl">
        <TaskForm
          initial={{
            title: '',
            notes: '',
            due_date: '',
            due_time: '',
            priority: 4,
            project_id: preProject ?? '',
            content_item_id: preContent ?? '',
          }}
          projects={projects}
          contentItems={contentItems}
        />
      </div>
    </div>
  );
}
