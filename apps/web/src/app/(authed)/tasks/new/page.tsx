import Link from 'next/link';
import { ScreenHeader } from '@/components/ScreenHeader';
import { projectsApi, contentApi, domainsApi, ApiError } from '@/lib/api';
import { INBOX_DOMAIN_ID } from '@jevi-ops/shared';
import { TaskForm } from '../task-form';

// /tasks/new — full-editor task creation. The /today page still has the
// quick "+ Add task" inline (title only); this page is for when you want
// to set due date, priority, domain/project, and content_item up front.

export default async function NewTaskPage({
  searchParams,
}: {
  searchParams: Promise<{ project_id?: string; domain_id?: string; content_item_id?: string }>;
}) {
  const { project_id: preProject, domain_id: preDomain, content_item_id: preContent } = await searchParams;

  let projects: { id: string; name: string; domain_id: string | null }[] = [];
  let domains: { id: string; name: string; is_system?: boolean }[] = [];
  let contentItems: { id: string; title: string }[] = [];

  const [projectsRes, domainsRes, contentRes, milestonesRes] = await Promise.allSettled([
    projectsApi.list(),
    domainsApi.list(),
    contentApi.list(),
    projectsApi.milestones.listAll(),
  ]);

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

  // Milestones grouped by project — for the task form's milestone picker.
  const projectMilestones: Record<string, { id: string; title: string }[]> = {};
  if (milestonesRes.status === 'fulfilled') {
    for (const m of milestonesRes.value.milestones) {
      (projectMilestones[m.project_id] ??= []).push({ id: m.id, title: m.title });
    }
  }

  // Pre-select: explicit project takes precedence; then explicit domain;
  // otherwise leave blank so the picker shows Inbox at the top and the
  // server defaults the routing.
  const initialSelection = preProject
    ? `project:${preProject}`
    : preDomain
      ? `domain:${preDomain}`
      : `domain:${INBOX_DOMAIN_ID}`;

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
            selection: initialSelection,
            milestone_id: '',
            content_item_id: preContent ?? '',
            // Default to "At due time" (offset 0). The cron only fires
            // when a due_time is actually set, so this is a no-op for
            // timeless tasks. User can pick "No reminder" to opt out.
            remind_minutes: 0,
            recurrence_rule: '',
          }}
          domains={domains}
          projects={projects}
          contentItems={contentItems}
          projectMilestones={projectMilestones}
        />
      </div>
    </div>
  );
}
