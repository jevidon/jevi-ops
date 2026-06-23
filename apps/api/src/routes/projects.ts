import type { FastifyPluginAsync } from 'fastify';
import {
  CreateProjectSchema,
  UpdateProjectSchema,
  CreateMilestoneSchema,
  UpdateMilestoneSchema,
  CreateProjectChecklistItemSchema,
  UpdateProjectChecklistItemSchema,
} from '@jerad-ops/shared/schemas';
import { getAppTz } from '../lib/app-settings.js';

export const projectRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.requireAuth);

  app.get('/api/projects', async (req) => {
    // Eager-load milestones and the most-recent-activity timestamp per
    // project so the list page can sort by recency without a second query.
    const { data, error } = await req.supabase!
      .from('projects')
      .select('*, milestones(*), domain:stewardship_domains(id, name)')
      .order('created_at', { ascending: false });
    if (error) throw app.httpErrors.internalServerError(error.message);
    return { projects: data ?? [] };
  });

  // Project detail — used by /projects/[id] page.
  app.get<{ Params: { id: string } }>('/api/projects/:id', async (req, reply) => {
    const id = req.params.id;
    const sb = req.supabase!;

    const [projectRes, milestonesRes, tasksRes, activityRes, checklistRes] = await Promise.all([
      sb
        .from('projects')
        .select('*, domain:stewardship_domains(id, name)')
        .eq('id', id)
        .maybeSingle(),
      sb.from('milestones').select('*').eq('project_id', id).order('position', { ascending: true }),
      sb.from('tasks').select('*').eq('project_id', id).order('created_at', { ascending: false }).limit(500),
      sb.from('activity_log').select('*').eq('project_id', id).order('logged_at', { ascending: false }).limit(200),
      sb.from('project_checklist_items').select('*').eq('project_id', id).order('position', { ascending: true }),
    ]);

    if (projectRes.error) throw app.httpErrors.internalServerError(projectRes.error.message);
    if (!projectRes.data) return reply.code(404).send({ error: 'not_found' });
    if (milestonesRes.error) throw app.httpErrors.internalServerError(milestonesRes.error.message);
    if (tasksRes.error) throw app.httpErrors.internalServerError(tasksRes.error.message);
    if (activityRes.error) throw app.httpErrors.internalServerError(activityRes.error.message);
    if (checklistRes.error) throw app.httpErrors.internalServerError(checklistRes.error.message);

    // Roll up this-month / last-month hours from activity_log. Calendar
    // months in America/Denver; cheap to compute client-side from the
    // already-fetched activity rows so we don't issue a second query.
    type ActivityRow = {
      hours_logged: number | string | null;
      logged_at: string;
      kind?: string | null;
    };
    const activity = (activityRes.data ?? []) as ActivityRow[];
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
      project: projectRes.data,
      milestones: milestonesRes.data ?? [],
      tasks: tasksRes.data ?? [],
      activity: activityRes.data ?? [],
      checklist: checklistRes.data ?? [],
      hours_this_month: Number(hoursThisMonth.toFixed(2)),
      hours_last_month: Number(hoursLastMonth.toFixed(2)),
    };
  });

  app.post('/api/projects', async (req, reply) => {
    const parsed = CreateProjectSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'invalid_payload',
        details: parsed.error.flatten().fieldErrors,
      });
    }
    const { data, error } = await req.supabase!
      .from('projects')
      .insert(parsed.data)
      .select('*')
      .single();
    if (error) throw app.httpErrors.internalServerError(error.message);
    return reply.code(201).send(data);
  });

  app.patch<{ Params: { id: string } }>('/api/projects/:id', async (req, reply) => {
    const parsed = UpdateProjectSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'invalid_payload',
        details: parsed.error.flatten().fieldErrors,
      });
    }
    const update: Record<string, unknown> = { ...parsed.data };
    // Status flips stamp / clear completed_at so analytics never see a
    // stale finish on a project that's back in flight. Mirrors the
    // tasks PATCH handler. Archived keeps completed_at if it was set
    // (an archived row was usually done first).
    if (parsed.data.status === 'done') {
      update.completed_at = new Date().toISOString();
    } else if (parsed.data.status === 'active' || parsed.data.status === 'paused') {
      update.completed_at = null;
    }
    const { data, error } = await req.supabase!
      .from('projects')
      .update(update)
      .eq('id', req.params.id)
      .select('*')
      .single();
    if (error) throw app.httpErrors.internalServerError(error.message);
    return data;
  });

  app.delete<{ Params: { id: string } }>('/api/projects/:id', async (req, reply) => {
    // tasks.project_id has ON DELETE SET NULL so child tasks are preserved
    // and just unlinked. Milestones cascade-delete via their FK. Activity
    // log entries lose their project_id but rows stick around.
    const { error } = await req.supabase!
      .from('projects')
      .delete()
      .eq('id', req.params.id);
    if (error) throw app.httpErrors.internalServerError(error.message);
    return reply.code(204).send();
  });

  // ─── Milestones ──────────────────────────────────────────────────────
  //
  // Nested under /api/projects/:id so the project_id stays in the path
  // and the body only ever carries the editable fields. Position defaults
  // to "end of list" when omitted; status flips stamp/clear completed_at
  // so the UI doesn't have to manage that field separately.

  app.post<{ Params: { id: string } }>(
    '/api/projects/:id/milestones',
    async (req, reply) => {
      const parsed = CreateMilestoneSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid_payload', details: parsed.error.flatten().fieldErrors });
      }
      // Default position = current count, i.e. append at end.
      let position = parsed.data.position;
      if (position == null) {
        const { count } = await req.supabase!
          .from('milestones')
          .select('id', { count: 'exact', head: true })
          .eq('project_id', req.params.id);
        position = count ?? 0;
      }
      const { data, error } = await req.supabase!
        .from('milestones')
        .insert({
          project_id: req.params.id,
          title: parsed.data.title,
          weight: parsed.data.weight ?? 1,
          position,
        })
        .select('*')
        .single();
      if (error) throw app.httpErrors.internalServerError(error.message);
      return reply.code(201).send(data);
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
      const update: Record<string, unknown> = { ...parsed.data };
      // Stamp/clear completed_at when the status flips, so the UI never
      // has to manage that field directly.
      if (parsed.data.status === 'done') update.completed_at = new Date().toISOString();
      if (parsed.data.status === 'open') update.completed_at = null;
      const { data, error } = await req.supabase!
        .from('milestones')
        .update(update)
        .eq('id', req.params.milestoneId)
        .eq('project_id', req.params.id)
        .select('*')
        .single();
      if (error) throw app.httpErrors.internalServerError(error.message);
      return data;
    },
  );

  app.delete<{ Params: { id: string; milestoneId: string } }>(
    '/api/projects/:id/milestones/:milestoneId',
    async (req, reply) => {
      const { error } = await req.supabase!
        .from('milestones')
        .delete()
        .eq('id', req.params.milestoneId)
        .eq('project_id', req.params.id);
      if (error) throw app.httpErrors.internalServerError(error.message);
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
      let position = parsed.data.position;
      if (position == null) {
        const { count } = await req.supabase!
          .from('project_checklist_items')
          .select('id', { count: 'exact', head: true })
          .eq('project_id', req.params.id);
        position = count ?? 0;
      }
      const { data, error } = await req.supabase!
        .from('project_checklist_items')
        .insert({
          project_id: req.params.id,
          title: parsed.data.title,
          position,
          recurrence_rule: parsed.data.recurrence_rule ?? null,
        })
        .select('*')
        .single();
      if (error) throw app.httpErrors.internalServerError(error.message);
      return reply.code(201).send(data);
    },
  );

  app.patch<{ Params: { id: string; itemId: string } }>(
    '/api/projects/:id/checklist/:itemId',
    async (req, reply) => {
      const parsed = UpdateProjectChecklistItemSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid_payload', details: parsed.error.flatten().fieldErrors });
      }
      const update: Record<string, unknown> = { ...parsed.data };
      if (parsed.data.done === true) update.done_at = new Date().toISOString();
      if (parsed.data.done === false) update.done_at = null;
      const { data, error } = await req.supabase!
        .from('project_checklist_items')
        .update(update)
        .eq('id', req.params.itemId)
        .eq('project_id', req.params.id)
        .select('*')
        .single();
      if (error) throw app.httpErrors.internalServerError(error.message);
      return data;
    },
  );

  app.delete<{ Params: { id: string; itemId: string } }>(
    '/api/projects/:id/checklist/:itemId',
    async (req, reply) => {
      const { error } = await req.supabase!
        .from('project_checklist_items')
        .delete()
        .eq('id', req.params.itemId)
        .eq('project_id', req.params.id);
      if (error) throw app.httpErrors.internalServerError(error.message);
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
  // for an atomic RPC.

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

      const insert: Record<string, unknown> = {
        project_id: req.params.id,
        entry,
        source: 'manual',
        kind,
      };
      if (hours !== null) insert.hours_logged = hours;
      if (req.body?.logged_at) insert.logged_at = req.body.logged_at;

      const { data, error } = await req.supabase!
        .from('activity_log')
        .insert(insert)
        .select('*')
        .single();
      if (error) throw app.httpErrors.internalServerError(error.message);

      if (hours !== null && hours > 0) {
        const { data: row, error: readErr } = await req.supabase!
          .from('projects')
          .select('hours_logged')
          .eq('id', req.params.id)
          .single();
        if (!readErr) {
          const current = Number(row?.hours_logged ?? 0);
          const { error: updateErr } = await req.supabase!
            .from('projects')
            .update({ hours_logged: current + hours })
            .eq('id', req.params.id);
          if (updateErr) {
            req.log.warn(
              { err: updateErr.message, projectId: req.params.id, hours },
              'activity log row landed but project hours_logged bump failed',
            );
          }
        }
      }

      return reply.code(201).send(data);
    },
  );

  app.patch<{
    Params: { id: string; entryId: string };
    Body: { entry?: string; hours?: number | null; logged_at?: string; kind?: string };
  }>(
    '/api/projects/:id/activity/:entryId',
    async (req, reply) => {
      // Read the existing row to compute the hours delta. If the user
      // changes 1.5h → 2.0h, projects.hours_logged must move +0.5; if
      // they clear hours entirely, it must roll back the old amount.
      const { data: existing, error: readErr } = await req.supabase!
        .from('activity_log')
        .select('hours_logged')
        .eq('id', req.params.entryId)
        .eq('project_id', req.params.id)
        .maybeSingle();
      if (readErr) throw app.httpErrors.internalServerError(readErr.message);
      if (!existing) return reply.code(404).send({ error: 'not_found' });

      const update: Record<string, unknown> = {};
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

      const { data, error } = await req.supabase!
        .from('activity_log')
        .update(update)
        .eq('id', req.params.entryId)
        .eq('project_id', req.params.id)
        .select('*')
        .single();
      if (error) throw app.httpErrors.internalServerError(error.message);

      // Apply the hours delta to projects.hours_logged. Only runs when
      // the user actually touched the hours field (newHours !== undefined).
      if (newHours !== undefined) {
        const oldHours = Number(existing.hours_logged ?? 0);
        const effectiveNew = newHours ?? 0;
        const delta = effectiveNew - oldHours;
        if (delta !== 0) {
          const { data: row } = await req.supabase!
            .from('projects')
            .select('hours_logged')
            .eq('id', req.params.id)
            .single();
          const current = Number(row?.hours_logged ?? 0);
          const next = Math.max(0, current + delta);
          const { error: bumpErr } = await req.supabase!
            .from('projects')
            .update({ hours_logged: next })
            .eq('id', req.params.id);
          if (bumpErr) {
            req.log.warn(
              { err: bumpErr.message, projectId: req.params.id, delta },
              'activity row updated but project hours_logged bump failed',
            );
          }
        }
      }

      return data;
    },
  );

  app.delete<{ Params: { id: string; entryId: string } }>(
    '/api/projects/:id/activity/:entryId',
    async (req, reply) => {
      // Roll back the hours_logged contribution when an entry is deleted
      // so the rollup stays honest. Read the entry first, decrement only
      // if it had hours.
      const { data: existing, error: readErr } = await req.supabase!
        .from('activity_log')
        .select('hours_logged')
        .eq('id', req.params.entryId)
        .eq('project_id', req.params.id)
        .maybeSingle();
      if (readErr) throw app.httpErrors.internalServerError(readErr.message);
      if (!existing) return reply.code(404).send({ error: 'not_found' });

      const hours = Number(existing.hours_logged ?? 0);
      const { error } = await req.supabase!
        .from('activity_log')
        .delete()
        .eq('id', req.params.entryId)
        .eq('project_id', req.params.id);
      if (error) throw app.httpErrors.internalServerError(error.message);

      if (hours > 0) {
        const { data: row } = await req.supabase!
          .from('projects')
          .select('hours_logged')
          .eq('id', req.params.id)
          .single();
        const current = Number(row?.hours_logged ?? 0);
        const next = Math.max(0, current - hours);
        await req.supabase!.from('projects').update({ hours_logged: next }).eq('id', req.params.id);
      }

      return reply.code(204).send();
    },
  );
};
