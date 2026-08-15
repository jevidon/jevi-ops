import type { FastifyPluginAsync } from 'fastify';
import { and, asc, count, desc, eq } from 'drizzle-orm';
import {
  CreateProjectSchema,
  UpdateProjectSchema,
  CreateMilestoneSchema,
  UpdateMilestoneSchema,
  CreateProjectChecklistItemSchema,
  UpdateProjectChecklistItemSchema,
} from '@jevi-ops/shared/schemas';
import { getAppTz } from '../lib/app-settings.js';
import { getDb } from '../lib/db.js';
import { clearAttentionForSource } from '../lib/attention.js';
import {
  activity_log,
  conversations,
  milestones,
  people,
  project_checklist_items,
  project_contacts,
  projects,
  tasks,
} from '../db/schema.js';

export const projectRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.requireAuth);

  app.get('/api/projects', async () => {
    // Eager-load milestones + domain so the list page can render without a
    // second query.
    const rows = await getDb().query.projects.findMany({
      with: {
        milestones: true,
        domain: { columns: { id: true, name: true } },
      },
      orderBy: desc(projects.created_at),
    });
    return { projects: rows };
  });

  // Project detail — used by /projects/[id] page.
  app.get<{ Params: { id: string } }>('/api/projects/:id', async (req, reply) => {
    const id = req.params.id;
    const db = getDb();

    const [project, projectMilestones, projectTasks, activity, checklist, contacts, projectConversations] = await Promise.all([
      db.query.projects.findFirst({
        with: {
          domain: { columns: { id: true, name: true } },
          company: { columns: { id: true, name: true } },
          primary_contact: { columns: { id: true, name: true, email: true, role_at_company: true } },
        },
        where: eq(projects.id, id),
      }),
      db.query.milestones.findMany({
        where: eq(milestones.project_id, id),
        orderBy: asc(milestones.position),
      }),
      db.query.tasks.findMany({
        where: eq(tasks.project_id, id),
        orderBy: desc(tasks.created_at),
        limit: 500,
      }),
      db.query.activity_log.findMany({
        where: eq(activity_log.project_id, id),
        orderBy: desc(activity_log.logged_at),
        limit: 200,
      }),
      db.query.project_checklist_items.findMany({
        where: eq(project_checklist_items.project_id, id),
        orderBy: asc(project_checklist_items.position),
      }),
      // CRM port (0041/0042): additional contacts + project conversations.
      db.query.project_contacts.findMany({
        where: eq(project_contacts.project_id, id),
        with: { person: { columns: { id: true, name: true, email: true, role_at_company: true } } },
        orderBy: asc(project_contacts.created_at),
      }),
      db.query.conversations.findMany({
        where: eq(conversations.project_id, id),
        with: {
          company: { columns: { id: true, name: true } },
          person: { columns: { id: true, name: true } },
        },
        orderBy: desc(conversations.occurred_at),
        limit: 100,
      }),
    ]);

    if (!project) return reply.code(404).send({ error: 'not_found' });

    // Roll up this-month / last-month hours from activity_log. Calendar
    // months in the app TZ; cheap to compute from the already-fetched
    // activity rows so we don't issue a second query.
    const tz = await getAppTz();
    const todayParts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(new Date());
    const gP = (t: string) => todayParts.find((p) => p.type === t)?.value ?? '';
    const thisYear = Number(gP('year'));
    const thisMonth = Number(gP('month'));
    const thisMonthStart = new Date(Date.UTC(thisYear, thisMonth - 1, 1)).toISOString();
    const lastMonthStart = new Date(Date.UTC(
      thisMonth === 1 ? thisYear - 1 : thisYear,
      thisMonth === 1 ? 11 : thisMonth - 2,
      1,
    )).toISOString();
    const lastMonthEnd = thisMonthStart;

    let hoursThisMonth = 0;
    let hoursLastMonth = 0;
    for (const a of activity) {
      const h = Number(a.hours_logged ?? 0);
      // 'update' entries don't carry hours; skip even if hours_logged
      // somehow got populated.
      if (a.kind === 'update' || h <= 0) continue;
      if (a.logged_at >= thisMonthStart) hoursThisMonth += h;
      else if (a.logged_at >= lastMonthStart && a.logged_at < lastMonthEnd) hoursLastMonth += h;
    }

    return {
      project,
      milestones: projectMilestones,
      tasks: projectTasks,
      activity,
      checklist,
      contacts,
      conversations: projectConversations,
      hours_this_month: Number(hoursThisMonth.toFixed(2)),
      hours_last_month: Number(hoursLastMonth.toFixed(2)),
    };
  });

  // ─── Additional contacts (CRM port) ─────────────────────────────────

  app.post<{ Params: { id: string } }>('/api/projects/:id/contacts', async (req, reply) => {
    const body = req.body as { person_id?: string; role?: string | null } | null;
    if (!body?.person_id) {
      return reply.code(400).send({ error: 'invalid_payload', details: { person_id: ['required'] } });
    }
    const [row] = await getDb()
      .insert(project_contacts)
      .values({ project_id: req.params.id, person_id: body.person_id, role: body.role ?? null })
      .onConflictDoNothing()
      .returning();
    if (!row) return reply.code(409).send({ error: 'already_linked' });
    const person = await getDb().query.people.findFirst({
      columns: { id: true, name: true, email: true, role_at_company: true },
      where: eq(people.id, row.person_id),
    });
    return reply.code(201).send({ ...row, person: person ?? null });
  });

  app.delete<{ Params: { id: string; contactId: string } }>(
    '/api/projects/:id/contacts/:contactId',
    async (req, reply) => {
      await getDb()
        .delete(project_contacts)
        .where(and(
          eq(project_contacts.id, req.params.contactId),
          eq(project_contacts.project_id, req.params.id),
        ));
      return reply.code(204).send();
    },
  );

  app.post('/api/projects', async (req, reply) => {
    const parsed = CreateProjectSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'invalid_payload',
        details: parsed.error.flatten().fieldErrors,
      });
    }
    const [row] = await getDb().insert(projects).values(parsed.data).returning();
    if (!row) throw app.httpErrors.internalServerError('insert_returned_no_row');
    return reply.code(201).send(row);
  });

  app.patch<{ Params: { id: string } }>('/api/projects/:id', async (req, reply) => {
    const parsed = UpdateProjectSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'invalid_payload',
        details: parsed.error.flatten().fieldErrors,
      });
    }
    const update: Partial<typeof projects.$inferInsert> = { ...parsed.data };
    // Status flips stamp / clear completed_at so analytics never see a
    // stale finish on a project that's back in flight. Mirrors the
    // tasks PATCH handler. Archived keeps completed_at if it was set
    // (an archived row was usually done first).
    if (parsed.data.status === 'done') {
      update.completed_at = new Date().toISOString();
    } else if (parsed.data.status === 'active' || parsed.data.status === 'paused') {
      update.completed_at = null;
    }
    const [row] = await getDb()
      .update(projects)
      .set(update)
      .where(eq(projects.id, req.params.id))
      .returning();
    if (!row) return reply.code(404).send({ error: 'not_found' });
    return row;
  });

  app.delete<{ Params: { id: string } }>('/api/projects/:id', async (req, reply) => {
    // tasks.project_id has ON DELETE SET NULL so child tasks are preserved
    // and just unlinked. Milestones cascade-delete via their FK. Activity
    // log entries lose their project_id but rows stick around.
    await getDb().delete(projects).where(eq(projects.id, req.params.id));
    return reply.code(204).send();
  });

  // ─── Milestones ──────────────────────────────────────────────────────
  //
  // Nested under /api/projects/:id so the project_id stays in the path
  // and the body only ever carries the editable fields. Position defaults
  // to "end of list" when omitted; status flips stamp/clear completed_at
  // so the UI doesn't have to manage that field separately.

  // Flat list of every milestone across projects — the v2 task form/detail
  // fetch this once (projectsApi.milestones.listAll) instead of an N+1 per
  // project. Ordered so a client can group by project_id then board order.
  app.get('/api/milestones', async () => {
    const rows = await getDb().query.milestones.findMany({
      columns: { id: true, project_id: true, title: true, status: true, weight: true, position: true },
      orderBy: [asc(milestones.project_id), asc(milestones.position)],
    });
    return { milestones: rows };
  });

  app.post<{ Params: { id: string } }>(
    '/api/projects/:id/milestones',
    async (req, reply) => {
      const parsed = CreateMilestoneSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid_payload', details: parsed.error.flatten().fieldErrors });
      }
      const db = getDb();
      // Default position = current count, i.e. append at end.
      let position = parsed.data.position;
      if (position == null) {
        const [row] = await db
          .select({ n: count() })
          .from(milestones)
          .where(eq(milestones.project_id, req.params.id));
        position = row?.n ?? 0;
      }
      const [row] = await db
        .insert(milestones)
        .values({
          project_id: req.params.id,
          title: parsed.data.title,
          weight: parsed.data.weight ?? 1,
          position,
        })
        .returning();
      if (!row) throw app.httpErrors.internalServerError('insert_returned_no_row');
      return reply.code(201).send(row);
    },
  );

  app.patch<{ Params: { id: string; milestoneId: string } }>(
    '/api/projects/:id/milestones/:milestoneId',
    async (req, reply) => {
      const parsed = UpdateMilestoneSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid_payload', details: parsed.error.flatten().fieldErrors });
      }
      if (Object.keys(parsed.data).length === 0) {
        return reply.code(400).send({ error: 'empty_payload' });
      }
      const update: Partial<typeof milestones.$inferInsert> = { ...parsed.data };
      // Stamp/clear completed_at when the status flips, so the UI never
      // has to manage that field directly.
      if (parsed.data.status === 'done') update.completed_at = new Date().toISOString();
      if (parsed.data.status === 'open') update.completed_at = null;
      const [row] = await getDb()
        .update(milestones)
        .set(update)
        .where(and(eq(milestones.id, req.params.milestoneId), eq(milestones.project_id, req.params.id)))
        .returning();
      if (!row) return reply.code(404).send({ error: 'not_found' });
      return row;
    },
  );

  app.delete<{ Params: { id: string; milestoneId: string } }>(
    '/api/projects/:id/milestones/:milestoneId',
    async (req, reply) => {
      await getDb()
        .delete(milestones)
        .where(and(eq(milestones.id, req.params.milestoneId), eq(milestones.project_id, req.params.id)));
      return reply.code(204).send();
    },
  );

  // ─── Project checklist items ─────────────────────────────────────────
  //
  // Same shape + behavior as content_checklist_items: append-by-default
  // positioning, status flip stamps done_at. Lighter-weight than tasks
  // (no due date, no project_id link) and not weighted (so they don't
  // affect project %).

  app.post<{ Params: { id: string } }>(
    '/api/projects/:id/checklist',
    async (req, reply) => {
      const parsed = CreateProjectChecklistItemSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid_payload', details: parsed.error.flatten().fieldErrors });
      }
      const db = getDb();
      let position = parsed.data.position;
      if (position == null) {
        const [row] = await db
          .select({ n: count() })
          .from(project_checklist_items)
          .where(eq(project_checklist_items.project_id, req.params.id));
        position = row?.n ?? 0;
      }
      const [row] = await db
        .insert(project_checklist_items)
        .values({
          project_id: req.params.id,
          title: parsed.data.title,
          position,
          recurrence_rule: parsed.data.recurrence_rule ?? null,
        })
        .returning();
      if (!row) throw app.httpErrors.internalServerError('insert_returned_no_row');
      return reply.code(201).send(row);
    },
  );

  app.patch<{ Params: { id: string; itemId: string } }>(
    '/api/projects/:id/checklist/:itemId',
    async (req, reply) => {
      const parsed = UpdateProjectChecklistItemSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid_payload', details: parsed.error.flatten().fieldErrors });
      }
      const update: Partial<typeof project_checklist_items.$inferInsert> = { ...parsed.data };
      if (parsed.data.done === true) update.done_at = new Date().toISOString();
      if (parsed.data.done === false) update.done_at = null;
      const [row] = await getDb()
        .update(project_checklist_items)
        .set(update)
        .where(and(
          eq(project_checklist_items.id, req.params.itemId),
          eq(project_checklist_items.project_id, req.params.id),
        ))
        .returning();
      if (!row) return reply.code(404).send({ error: 'not_found' });
      return row;
    },
  );

  app.delete<{ Params: { id: string; itemId: string } }>(
    '/api/projects/:id/checklist/:itemId',
    async (req, reply) => {
      await getDb()
        .delete(project_checklist_items)
        .where(and(
          eq(project_checklist_items.id, req.params.itemId),
          eq(project_checklist_items.project_id, req.params.id),
        ));
      return reply.code(204).send();
    },
  );

  // ─── Activity log (manual time tracking) ─────────────────────────────
  //
  // Mirrors what the voice executor's logActivity does: insert a row
  // into activity_log, then bump projects.hours_logged so the rollup
  // stays in sync. The source field separates this path ('manual') from
  // 'voice' so we can tell entries apart on the activity feed.
  //
  // Race note: read-then-update on projects.hours_logged is fine because
  // this is a single-user system. If it ever becomes multi-writer, swap
  // for an atomic UPDATE ... SET x = x + delta.

  app.post<{ Params: { id: string }; Body: { entry?: string; hours?: number; logged_at?: string; kind?: string } }>(
    '/api/projects/:id/activity',
    async (req, reply) => {
      const entry = String(req.body?.entry ?? '').trim();
      if (!entry) {
        return reply.code(400).send({ error: 'invalid_payload', details: { entry: ['required'] } });
      }
      const kind = req.body?.kind === 'update' ? 'update' : 'work';
      const rawHours = req.body?.hours;
      // Update entries don't carry hours by definition. Silently drop any
      // hours the client sent rather than 400 — the form might leave the
      // field populated when toggling kinds.
      const hours =
        kind === 'work' && typeof rawHours === 'number' && Number.isFinite(rawHours) && rawHours >= 0
          ? rawHours
          : null;

      const db = getDb();
      const insert: typeof activity_log.$inferInsert = {
        project_id: req.params.id,
        entry,
        source: 'manual',
        kind,
      };
      if (hours !== null) insert.hours_logged = hours;
      if (req.body?.logged_at) insert.logged_at = req.body.logged_at;

      const [row] = await db.insert(activity_log).values(insert).returning();
      if (!row) throw app.httpErrors.internalServerError('insert_returned_no_row');

      // Logging activity clears the project's "stalled" attention item
      // live. Best-effort.
      try {
        await clearAttentionForSource(db, 'project', req.params.id, ['project_stalled']);
      } catch { /* best-effort */ }

      if (hours !== null && hours > 0) {
        try {
          const project = await db.query.projects.findFirst({
            columns: { hours_logged: true },
            where: eq(projects.id, req.params.id),
          });
          const current = Number(project?.hours_logged ?? 0);
          await db.update(projects).set({ hours_logged: current + hours }).where(eq(projects.id, req.params.id));
        } catch (err) {
          req.log.warn(
            { err: err instanceof Error ? err.message : String(err), projectId: req.params.id, hours },
            'activity log row landed but project hours_logged bump failed',
          );
        }
      }

      return reply.code(201).send(row);
    },
  );

  app.patch<{
    Params: { id: string; entryId: string };
    Body: { entry?: string; hours?: number | null; logged_at?: string; kind?: string };
  }>(
    '/api/projects/:id/activity/:entryId',
    async (req, reply) => {
      const db = getDb();
      // Read the existing row to compute the hours delta. If the user
      // changes 1.5h → 2.0h, projects.hours_logged must move +0.5; if
      // they clear hours entirely, it must roll back the old amount.
      const existing = await db.query.activity_log.findFirst({
        columns: { hours_logged: true },
        where: and(eq(activity_log.id, req.params.entryId), eq(activity_log.project_id, req.params.id)),
      });
      if (!existing) return reply.code(404).send({ error: 'not_found' });

      const update: Partial<typeof activity_log.$inferInsert> = {};
      if (typeof req.body?.entry === 'string') {
        const trimmed = req.body.entry.trim();
        if (!trimmed) {
          return reply.code(400).send({ error: 'invalid_payload', details: { entry: ['required'] } });
        }
        update.entry = trimmed;
      }
      // hours: undefined → no change. null → clear (treat as 0). number → set.
      let newHours: number | null | undefined;
      if (req.body && 'hours' in req.body) {
        const raw = req.body.hours;
        if (raw === null) {
          newHours = null;
          update.hours_logged = null;
        } else if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) {
          newHours = raw;
          update.hours_logged = raw;
        } else {
          return reply.code(400).send({ error: 'invalid_payload', details: { hours: ['must be a non-negative number or null'] } });
        }
      }
      if (req.body?.logged_at) {
        update.logged_at = req.body.logged_at;
      }
      if (req.body?.kind === 'work' || req.body?.kind === 'update') {
        update.kind = req.body.kind;
        // Switching to update implies clearing hours; mirror the create
        // path's "hours don't belong on updates" rule. Roll back the
        // contribution to the project total.
        if (req.body.kind === 'update' && existing.hours_logged) {
          newHours = null;
          update.hours_logged = null;
        }
      }
      if (Object.keys(update).length === 0) {
        return reply.code(400).send({ error: 'empty_payload' });
      }

      const [row] = await db
        .update(activity_log)
        .set(update)
        .where(and(eq(activity_log.id, req.params.entryId), eq(activity_log.project_id, req.params.id)))
        .returning();
      if (!row) return reply.code(404).send({ error: 'not_found' });

      // Apply the hours delta to projects.hours_logged. Only runs when
      // the user actually touched the hours field (newHours !== undefined).
      if (newHours !== undefined) {
        const oldHours = Number(existing.hours_logged ?? 0);
        const effectiveNew = newHours ?? 0;
        const delta = effectiveNew - oldHours;
        if (delta !== 0) {
          try {
            const project = await db.query.projects.findFirst({
              columns: { hours_logged: true },
              where: eq(projects.id, req.params.id),
            });
            const current = Number(project?.hours_logged ?? 0);
            const next = Math.max(0, current + delta);
            await db.update(projects).set({ hours_logged: next }).where(eq(projects.id, req.params.id));
          } catch (err) {
            req.log.warn(
              { err: err instanceof Error ? err.message : String(err), projectId: req.params.id, delta },
              'activity row updated but project hours_logged bump failed',
            );
          }
        }
      }

      return row;
    },
  );

  app.delete<{ Params: { id: string; entryId: string } }>(
    '/api/projects/:id/activity/:entryId',
    async (req, reply) => {
      const db = getDb();
      // Roll back the hours_logged contribution when an entry is deleted
      // so the rollup stays honest. Read the entry first, decrement only
      // if it had hours.
      const existing = await db.query.activity_log.findFirst({
        columns: { hours_logged: true },
        where: and(eq(activity_log.id, req.params.entryId), eq(activity_log.project_id, req.params.id)),
      });
      if (!existing) return reply.code(404).send({ error: 'not_found' });

      const hours = Number(existing.hours_logged ?? 0);
      await db
        .delete(activity_log)
        .where(and(eq(activity_log.id, req.params.entryId), eq(activity_log.project_id, req.params.id)));

      if (hours > 0) {
        const project = await db.query.projects.findFirst({
          columns: { hours_logged: true },
          where: eq(projects.id, req.params.id),
        });
        const current = Number(project?.hours_logged ?? 0);
        const next = Math.max(0, current - hours);
        await db.update(projects).set({ hours_logged: next }).where(eq(projects.id, req.params.id));
      }

      return reply.code(204).send();
    },
  );
};
