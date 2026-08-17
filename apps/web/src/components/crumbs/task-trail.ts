import type { Task } from '@jevi-ops/shared';
import type { Crumb } from './crumbs';

// Pure trail builder for task detail pages (no 'use client' — callable from
// server components). Trails are ANCESTORS ONLY: no Work root and no current
// item — the page's own header already names it, and short trails keep the
// mobile crumb line from scrolling. Rules:
//   - The domain crumb always comes from task.domain — the denormalized
//     column is authoritative and always present; task.project.domain isn't
//     embedded and a project can be domain-orphaned.
//   - Inbox tasks (domain.is_system) show the Inbox domain as their ancestor.
//   - Hierarchy is one level deep by design, so at most one parent-task hop.
export function buildTaskTrail(task: Task): Crumb[] {
  const trail: Crumb[] = [];
  if (task.domain?.is_system) {
    trail.push({ label: 'Inbox', href: `/domains/${task.domain_id}` });
  } else {
    if (task.domain) trail.push({ label: task.domain.name, href: `/domains/${task.domain.id}` });
    if (task.project) trail.push({ label: task.project.name, href: `/projects/${task.project.id}` });
  }
  if (task.parent_task) {
    trail.push({ label: task.parent_task.title, href: `/tasks/${task.parent_task.id}` });
  }
  return trail;
}
