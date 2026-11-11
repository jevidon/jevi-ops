import { randomUUID } from 'node:crypto';
import type { TaskTemplateEntry } from '@jevi-ops/shared';
import { tasks } from '../db/schema.js';
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
