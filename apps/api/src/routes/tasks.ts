import type { FastifyPluginAsync } from 'fastify';
import type { SupabaseClient } from '@supabase/supabase-js';
import { CreateTaskSchema, UpdateTaskSchema } from '@jerad-ops/shared/schemas';
import { INBOX_DOMAIN_ID, isRecurrencePattern, nextDueDate } from '@jerad-ops/shared';

// Tasks CRUD. Auth-gated; uses request-scoped Supabase client so RLS applies.

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
  sb: SupabaseClient,
  body: { project_id?: string | null; domain_id?: string | null },
): Promise<{ ok: true; domain_id: string } | { ok: false; error: string }> {
  let projectDomainId: string | null = null;
  if (body.project_id) {
    const { data, error } = await sb
      .from('projects')
      .select('domain_id')
      .eq('id', body.project_id)
      .maybeSingle();
    if (error) return { ok: false, error: `project_lookup_failed:${error.message}` };
    if (!data) return { ok: false, error: 'project_not_found' };
    projectDomainId = (data.domain_id as string | null) ?? null;
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

export const taskRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.requireAuth);

  app.get<{ Querystring: { content_item_id?: string; project_id?: string; status?: string; domain_id?: string } }>(
    '/api/tasks',
    async (req) => {
      const sb = req.supabase!;
      // Include linked project + content_item + domain metadata so list
      // views can render context without an N+1 lookup.
      let q = sb
        .from('tasks')
        .select('*, project:projects(id, name, color), content_item:content_items(id, title, type, status), domain:stewardship_domains(id, name, is_system)')
        .order('created_at', { ascending: false })
        .limit(500);
      if (req.query.content_item_id) q = q.eq('content_item_id', req.query.content_item_id);
      if (req.query.project_id) q = q.eq('project_id', req.query.project_id);
      if (req.query.status) q = q.eq('status', req.query.status);
      if (req.query.domain_id) q = q.eq('domain_id', req.query.domain_id);
      const { data, error } = await q;
      if (error) throw app.httpErrors.internalServerError(error.message);
      return { tasks: data ?? [] };
    },
  );

  app.get<{ Params: { id: string } }>('/api/tasks/:id', async (req, reply) => {
    const { data, error } = await req.supabase!
      .from('tasks')
      .select('*, project:projects(id, name, color), content_item:content_items(id, title, type, status), domain:stewardship_domains(id, name, is_system)')
      .eq('id', req.params.id)
      .maybeSingle();
    if (error) throw app.httpErrors.internalServerError(error.message);
    if (!data) return reply.code(404).send({ error: 'not_found' });
    return data;
  });

  app.post('/api/tasks', async (req, reply) => {
    const parsed = CreateTaskSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'invalid_payload',
        details: parsed.error.flatten().fieldErrors,
      });
    }
    const resolved = await resolveTaskDomain(req.supabase!, {
      project_id: parsed.data.project_id ?? null,
      domain_id: parsed.data.domain_id ?? null,
    });
    if (!resolved.ok) {
      return reply.code(400).send({ error: resolved.error });
    }
    const insert = { ...parsed.data, domain_id: resolved.domain_id };
    const { data, error } = await req.supabase!
      .from('tasks')
      .insert(insert)
      .select('*')
      .single();
    if (error) throw app.httpErrors.internalServerError(error.message);
    return reply.code(201).send(data);
  });

  app.patch<{ Params: { id: string } }>('/api/tasks/:id', async (req, reply) => {
    const parsed = UpdateTaskSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'invalid_payload',
        details: parsed.error.flatten().fieldErrors,
      });
    }
    const update: Record<string, unknown> = { ...parsed.data };
    let rolledOver = false;

    // Re-resolve domain routing when project_id or domain_id is being
    // changed. Skip when neither key is in the patch — most PATCHes are
    // status flips, title edits, etc. and shouldn't pay for a project
    // lookup. When project_id is being touched (set or cleared), we have
    // to recompute because the old domain_id might no longer be right.
    if ('project_id' in parsed.data || 'domain_id' in parsed.data) {
      // Pull the existing row so we know the current project/domain when
      // the patch only changes one of them.
      const { data: existing, error: readErr } = await req.supabase!
        .from('tasks')
        .select('project_id, domain_id')
        .eq('id', req.params.id)
        .maybeSingle();
      if (readErr) throw app.httpErrors.internalServerError(readErr.message);
      if (!existing) return reply.code(404).send({ error: 'not_found' });

      const nextProjectId = 'project_id' in parsed.data
        ? (parsed.data.project_id ?? null)
        : (existing.project_id as string | null);
      const nextDomainId = 'domain_id' in parsed.data
        ? (parsed.data.domain_id ?? null)
        : null; // explicit override only — don't keep the old domain when the project is changing
      const resolved = await resolveTaskDomain(req.supabase!, {
        project_id: nextProjectId,
        domain_id: nextDomainId,
      });
      if (!resolved.ok) {
        return reply.code(400).send({ error: resolved.error });
      }
      update.domain_id = resolved.domain_id;
    }

    if (parsed.data.status === 'done') {
      // Recurring tasks roll forward instead of marking done. Read the
      // existing recurrence_rule from the DB (don't trust the client to
      // send it on a plain "check it off" call). If the rule is one we
      // know how to advance, swap the done → open and bump due_date.
      // Reminders dedup (reminders_sent) clears so the next occurrence
      // can fire reminders again.
      const { data: existing, error: readErr } = await req.supabase!
        .from('tasks')
        .select('recurrence_rule, due_date')
        .eq('id', req.params.id)
        .maybeSingle();
      if (readErr) throw app.httpErrors.internalServerError(readErr.message);

      const ruleRaw = existing?.recurrence_rule as string | null | undefined;
      if (ruleRaw && isRecurrencePattern(ruleRaw)) {
        const todayIso = new Date().toISOString().slice(0, 10);
        const next = nextDueDate({
          currentDue: (existing?.due_date as string | null) ?? null,
          rule: ruleRaw,
          todayIso,
        });
        update.status = 'open';
        update.completed_at = null;
        update.due_date = next;
        update.reminders_sent = [];
        // top3_for_date is intentionally cleared too — today's instance
        // is "done", so it shouldn't keep starring tomorrow's spawn.
        update.top3_for_date = null;
        rolledOver = true;
      } else {
        update.completed_at = new Date().toISOString();
      }
    } else if (parsed.data.status === 'open') {
      // Reopening — clear completion timestamp so analytics don't see a
      // stale "completed at" on a row that's actually open.
      update.completed_at = null;
    }
    const { data, error } = await req.supabase!
      .from('tasks')
      .update(update)
      .eq('id', req.params.id)
      .select('*')
      .single();
    if (error) throw app.httpErrors.internalServerError(error.message);
    // Surface the rollover so the client can show a "Next: <date>" hint
    // if it wants to. Adds one field; existing consumers ignore it.
    return { ...data, recurred: rolledOver };
  });

  app.delete<{ Params: { id: string } }>('/api/tasks/:id', async (req, reply) => {
    const { error } = await req.supabase!.from('tasks').delete().eq('id', req.params.id);
    if (error) throw app.httpErrors.internalServerError(error.message);
    return reply.code(204).send();
  });
};
