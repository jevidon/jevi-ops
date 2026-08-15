import type { FastifyPluginAsync } from 'fastify';
import { and, desc, eq, type SQL } from 'drizzle-orm';
import { CreateTaskSchema, UpdateTaskSchema } from '@jevi-ops/shared/schemas';
import { INBOX_DOMAIN_ID, isRecurrencePattern, nextDueDate } from '@jevi-ops/shared';
import { getAppTz } from '../lib/app-settings.js';
import { todayInTz } from '../lib/tz.js';
import { getDb, type Db } from '../lib/db.js';
import { clearAttentionForSource } from '../lib/attention.js';
import { milestones, projects, tasks } from '../db/schema.js';

// Tasks CRUD. Auth-gated.

// Shared embed shape for list + detail — linked project + content_item +
// domain metadata so views can render context without an N+1 lookup.
const TASK_EMBEDS = {
  project: { columns: { id: true, name: true, color: true } },
  content_item: { columns: { id: true, title: true, type: true, status: true } },
  domain: { columns: { id: true, name: true, is_system: true } },
} as const;

// ─── Domain routing helper (Addendum 03) ───────────────────────────────
//
// Every task must end up with a domain_id. Three input shapes:
//   1. Client sets project_id only            → domain_id = project.domain_id
//   2. Client sets domain_id only             → domain_id as given
//   3. Client sets both                       → must match; 400 if mismatched
//   4. Client sets neither                    → default to Inbox
//
// The server is the source of truth even when the client sends both —
// project.domain_id wins on conflict-with-mismatch (returned as an error,
// not silently corrected, so a buggy client surfaces immediately).
async function resolveTaskDomain(
  db: Db,
  body: { project_id?: string | null; domain_id?: string | null },
): Promise<{ ok: true; domain_id: string } | { ok: false; error: string }> {
  let projectDomainId: string | null = null;
  if (body.project_id) {
    const project = await db.query.projects.findFirst({
      columns: { domain_id: true },
      where: eq(projects.id, body.project_id),
    });
    if (!project) return { ok: false, error: 'project_not_found' };
    projectDomainId = project.domain_id ?? null;
  }

  if (body.project_id && body.domain_id) {
    // Both supplied: project wins if they conflict, but surface the
    // mismatch so the caller knows their intent didn't match the DB.
    if (projectDomainId && projectDomainId !== body.domain_id) {
      return { ok: false, error: 'domain_project_mismatch' };
    }
    // If project has no domain_id (orphan project) but caller supplied one,
    // we use the caller's value — orphan projects shouldn't block creation.
    return { ok: true, domain_id: projectDomainId ?? body.domain_id };
  }

  if (body.project_id) {
    // Project supplied, no explicit domain. Inherit from project, falling
    // back to Inbox if the project itself is domain-orphaned (rare).
    return { ok: true, domain_id: projectDomainId ?? INBOX_DOMAIN_ID };
  }

  if (body.domain_id) {
    return { ok: true, domain_id: body.domain_id };
  }

  // Frictionless capture: no domain, no project → Inbox.
  return { ok: true, domain_id: INBOX_DOMAIN_ID };
}

// ─── Milestone link validation (migration 0034) ─────────────────────────
//
// A task may point at one of ITS OWN project's milestones (for the "group by
// milestone" drill-in). This enforces that ownership: returns the milestone id
// only when it belongs to `projectId`, else null ("General"). A projectless
// task can never hold a milestone. Best-effort — any lookup failure parks the
// task under General rather than blocking the save.
async function resolveMilestone(
  db: Db,
  milestoneId: string,
  projectId: string | null,
): Promise<string | null> {
  if (!projectId) return null;
  const row = await db.query.milestones.findFirst({
    columns: { project_id: true },
    where: eq(milestones.id, milestoneId),
  });
  return row && row.project_id === projectId ? milestoneId : null;
}

export const taskRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.requireAuth);

  app.get<{ Querystring: { content_item_id?: string; project_id?: string; status?: string; domain_id?: string; parent_task_id?: string } }>(
    '/api/tasks',
    async (req) => {
      const db = getDb();
      const conds: SQL[] = [];
      if (req.query.content_item_id) conds.push(eq(tasks.content_item_id, req.query.content_item_id));
      if (req.query.project_id) conds.push(eq(tasks.project_id, req.query.project_id));
      if (req.query.status) conds.push(eq(tasks.status, req.query.status));
      if (req.query.domain_id) conds.push(eq(tasks.domain_id, req.query.domain_id));
      if (req.query.parent_task_id) conds.push(eq(tasks.parent_task_id, req.query.parent_task_id));
      const rows = await db.query.tasks.findMany({
        with: TASK_EMBEDS,
        where: conds.length ? and(...conds) : undefined,
        orderBy: desc(tasks.created_at),
        limit: 500,
      });
      return { tasks: rows };
    },
  );

  app.get<{ Params: { id: string } }>('/api/tasks/:id', async (req, reply) => {
    const row = await getDb().query.tasks.findFirst({
      with: TASK_EMBEDS,
      where: eq(tasks.id, req.params.id),
    });
    if (!row) return reply.code(404).send({ error: 'not_found' });
    return row;
  });

  app.post('/api/tasks', async (req, reply) => {
    const parsed = CreateTaskSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'invalid_payload',
        details: parsed.error.flatten().fieldErrors,
      });
    }
    const db = getDb();
    const resolved = await resolveTaskDomain(db, {
      project_id: parsed.data.project_id ?? null,
      domain_id: parsed.data.domain_id ?? null,
    });
    if (!resolved.ok) {
      return reply.code(400).send({ error: resolved.error });
    }
    const insert = { ...parsed.data, domain_id: resolved.domain_id };
    // Only a milestone that belongs to this task's project survives (0034).
    if (parsed.data.milestone_id) {
      insert.milestone_id = await resolveMilestone(
        db,
        parsed.data.milestone_id,
        parsed.data.project_id ?? null,
      );
    }
    const [row] = await db.insert(tasks).values(insert).returning();
    if (!row) throw app.httpErrors.internalServerError('insert_returned_no_row');
    return reply.code(201).send(row);
  });

  app.patch<{ Params: { id: string } }>('/api/tasks/:id', async (req, reply) => {
    const parsed = UpdateTaskSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'invalid_payload',
        details: parsed.error.flatten().fieldErrors,
      });
    }
    const db = getDb();
    // domain_id is excluded from the spread: the Zod schema allows null (as
    // "recompute for me") but the column is NOT NULL — the resolver below
    // sets the definitive value whenever the patch touches routing.
    const { domain_id: _ignoredDomainId, ...patchRest } = parsed.data;
    const update: Partial<typeof tasks.$inferInsert> = { ...patchRest };
    let rolledOver = false;

    // Re-resolve domain routing when project_id or domain_id is being
    // changed. Skip when neither key is in the patch — most PATCHes are
    // status flips, title edits, etc. and shouldn't pay for a project
    // lookup. When project_id is being touched (set or cleared), we have
    // to recompute because the old domain_id might no longer be right.
    if ('project_id' in parsed.data || 'domain_id' in parsed.data || 'milestone_id' in parsed.data) {
      // Pull the existing row so we know the current project/domain/milestone
      // when the patch only changes one of them.
      const existing = await db.query.tasks.findFirst({
        columns: { project_id: true, domain_id: true, milestone_id: true },
        where: eq(tasks.id, req.params.id),
      });
      if (!existing) return reply.code(404).send({ error: 'not_found' });

      const nextProjectId = 'project_id' in parsed.data
        ? (parsed.data.project_id ?? null)
        : existing.project_id;

      // Domain routing only re-resolves when project/domain actually change —
      // a milestone-only patch keeps the existing domain.
      if ('project_id' in parsed.data || 'domain_id' in parsed.data) {
        const nextDomainId = 'domain_id' in parsed.data
          ? (parsed.data.domain_id ?? null)
          : null; // explicit override only — don't keep the old domain when the project is changing
        const resolved = await resolveTaskDomain(db, {
          project_id: nextProjectId,
          domain_id: nextDomainId,
        });
        if (!resolved.ok) {
          return reply.code(400).send({ error: resolved.error });
        }
        update.domain_id = resolved.domain_id;
      }

      // Milestone link: re-validate against the effective project (0034). A
      // project change re-checks the existing link even when the patch didn't
      // touch milestone_id — a milestone from the old project is parked under
      // General rather than silently pointing across projects.
      const candidateMilestoneId = 'milestone_id' in parsed.data
        ? (parsed.data.milestone_id ?? null)
        : existing.milestone_id;
      update.milestone_id = candidateMilestoneId
        ? await resolveMilestone(db, candidateMilestoneId, nextProjectId)
        : null;
    }

    if (parsed.data.status === 'done') {
      // Recurring tasks roll forward instead of marking done. Read the
      // existing recurrence_rule from the DB (don't trust the client to
      // send it on a plain "check it off" call). If the rule is one we
      // know how to advance, swap the done → open and bump due_date.
      // Reminders dedup (reminders_sent) clears so the next occurrence
      // can fire reminders again.
      const existing = await db.query.tasks.findFirst({
        columns: { recurrence_rule: true, due_date: true },
        where: eq(tasks.id, req.params.id),
      });

      const ruleRaw = existing?.recurrence_rule;
      if (ruleRaw && isRecurrencePattern(ruleRaw)) {
        const todayIso = new Date().toISOString().slice(0, 10);
        const next = nextDueDate({
          currentDue: existing?.due_date ?? null,
          rule: ruleRaw,
          todayIso,
        });
        update.status = 'open';
        update.completed_at = null;
        update.due_date = next;
        update.reminders_sent = {};
        // top3_for_date is intentionally cleared too — today's instance
        // is "done", so it shouldn't keep starring tomorrow's spawn.
        update.top3_for_date = null;
        rolledOver = true;
      } else {
        update.completed_at = new Date().toISOString();
      }
      // Completing (or rolling over) leaves the waiting state (0038).
      update.waiting_on = null;
      update.waiting_since = null;
    } else if (parsed.data.status === 'open') {
      // Reopening — clear completion timestamp so analytics don't see a
      // stale "completed at" on a row that's actually open. Reopen never
      // lands in waiting, so clear the waiting fields too.
      update.completed_at = null;
      update.waiting_on = null;
      update.waiting_since = null;
    } else if (parsed.data.status === 'waiting') {
      // Entering waiting (blocked on someone else): stamp the aging anchor if
      // the client didn't provide one. Must be the APP-TZ local date — every
      // consumer (attention rule, /work bucketing, all the UI day-counts)
      // diffs against todayInTz(tz), so a UTC stamp would read a day off for
      // evening waits in a behind-UTC zone. waiting_on flows through from the
      // patch.
      if (!('waiting_since' in parsed.data) || !parsed.data.waiting_since) {
        update.waiting_since = todayInTz(await getAppTz());
      }
    }
    const [row] = await db.update(tasks).set(update).where(eq(tasks.id, req.params.id)).returning();
    if (!row) return reply.code(404).send({ error: 'not_found' });

    // Live-reconcile this task's Attention items so a status/date change
    // shows immediately instead of waiting for the 5am cron. Each managed
    // rule is checked against the task's NEW state; only rules that no
    // longer apply are deleted (keyed by rule_type so, e.g., editing a
    // still-waiting task's note doesn't clobber its live task_waiting_aging
    // item). Best-effort — never block the task update.
    try {
      const tz = await getAppTz();
      const todayYmd = todayInTz(tz);
      const plus3Ymd = new Date(new Date(`${todayYmd}T12:00:00Z`).getTime() + 3 * 86_400_000)
        .toISOString().slice(0, 10);
      const stillDueSoon = row.status === 'open' && row.due_date != null && row.due_date <= plus3Ymd;

      // task_waiting_aging lives only while the task is waiting ≥7 days; any
      // other state (or a fresh block) clears it until the cron recomputes.
      const waitDays = row.status === 'waiting' && row.waiting_since
        ? Math.round((Date.parse(`${todayYmd}T00:00:00Z`) - Date.parse(`${row.waiting_since}T00:00:00Z`)) / 86_400_000)
        : -1;
      const stillWaitingAging = row.status === 'waiting' && waitDays >= 7;

      const staleRules: string[] = [];
      if (!stillDueSoon) staleRules.push('task_due_soon');
      if (!stillWaitingAging) staleRules.push('task_waiting_aging');
      if (staleRules.length > 0) {
        await clearAttentionForSource(db, 'task', req.params.id, staleRules);
      }
    } catch (err) {
      req.log.warn({ err, taskId: req.params.id }, 'attention reconcile after task update failed');
    }

    // Surface the rollover so the client can show a "Next: <date>" hint
    // if it wants to. Adds one field; existing consumers ignore it.
    return { ...row, recurred: rolledOver };
  });

  app.delete<{ Params: { id: string } }>('/api/tasks/:id', async (req, reply) => {
    const db = getDb();
    await db.delete(tasks).where(eq(tasks.id, req.params.id));
    // Clear any Attention item for the now-gone task (source_id is a plain
    // uuid, no FK cascade). Best-effort.
    try {
      await clearAttentionForSource(db, 'task', req.params.id, ['task_due_soon', 'task_waiting_aging']);
    } catch { /* best-effort */ }
    return reply.code(204).send();
  });
};
