import { randomUUID } from 'node:crypto';
import { asc, desc, eq } from 'drizzle-orm';
import { TaskTemplateInputSchema, type TaskTemplateEntry } from '@jevi-ops/shared';
import { projects, tasks } from '../db/schema.js';
import type { getDb } from './db.js';

type Tx = Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0];

/**
 * Copy a template's entries into a project as fresh tasks, inside the
 * caller's transaction so the project and its tasks land together or not at
 * all. Shared by both ways of starting a project from a template.
 *
 * Every task starts as an ordinary open task: no completion, dates,
 * reminders, recurrence, waiting state or workflow status, and no live link
 * back to the template.
 */
export async function copyTemplateTasks(tx: Tx, entries: TaskTemplateEntry[], target: { projectId: string; domainId: string }): Promise<void> {
  const ids = new Map(entries.map(entry => [entry.key, randomUUID()]));
  const createdAt = Date.now();
  await tx.insert(tasks).values(entries.map((entry, index) => ({
    id: ids.get(entry.key)!, title: entry.title, notes: entry.notes,
    // Project detail sorts newest first, so earlier entries get later stamps.
    // Distinct stamps also keep an unrelated task edit from reshuffling
    // entries that would otherwise tie.
    created_at: new Date(createdAt - index).toISOString(),
    parent_task_id: entry.parent_key ? ids.get(entry.parent_key)! : null,
    project_id: target.projectId, domain_id: target.domainId, status: 'open', source: 'manual',
  })));
}

export type ProjectSnapshot =
  | { entries: TaskTemplateEntry[] }
  | { error: 'not_found' | 'empty_project' | 'too_many_tasks' | 'invalid_source_tasks' };

/**
 * A project's tasks as template entries, under fresh keys. Shared by "save
 * this project as a template" and the read-only snapshot used to update an
 * existing template, so both see exactly the same list.
 *
 * Reads the whole project, completed tasks included, independently of the
 * detail page's filtering and its 500-row display limit, in the order the
 * project page shows. Never truncates: more than 200 tasks is an error.
 */
export async function snapshotProjectEntries(tx: Tx, projectId: string): Promise<ProjectSnapshot> {
  const [project] = await tx.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId));
  if (!project) return { error: 'not_found' };
  const source = await tx.select().from(tasks).where(eq(tasks.project_id, project.id))
    .orderBy(desc(tasks.created_at), asc(tasks.id)).limit(201);
  if (!source.length) return { error: 'empty_project' };
  if (source.length > 200) return { error: 'too_many_tasks' };
  const keys = new Map(source.map(task => [task.id, randomUUID()]));
  const entries = TaskTemplateInputSchema.shape.entries.safeParse(source.map(task => ({
    key: keys.get(task.id)!, title: task.title, notes: task.notes,
    // A parent outside this project is not copied or linked into it.
    parent_key: task.parent_task_id ? keys.get(task.parent_task_id) ?? null : null,
  })));
  return entries.success ? { entries: entries.data } : { error: 'invalid_source_tasks' };
}
