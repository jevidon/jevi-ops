import type { FastifyPluginAsync } from 'fastify';
import { CreateTaskSchema, UpdateTaskSchema } from '@jerad-ops/shared/schemas';

// Tasks CRUD. Auth-gated; uses request-scoped Supabase client so RLS applies.

export const taskRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.requireAuth);

  app.get<{ Querystring: { content_item_id?: string; project_id?: string; status?: string } }>(
    '/api/tasks',
    async (req) => {
      const sb = req.supabase!;
      // Include linked project + content_item metadata so list views can
      // render context without an N+1 lookup.
      let q = sb
        .from('tasks')
        .select('*, project:projects(id, name, color), content_item:content_items(id, title, type, status)')
        .order('created_at', { ascending: false })
        .limit(500);
      if (req.query.content_item_id) q = q.eq('content_item_id', req.query.content_item_id);
      if (req.query.project_id) q = q.eq('project_id', req.query.project_id);
      if (req.query.status) q = q.eq('status', req.query.status);
      const { data, error } = await q;
      if (error) throw app.httpErrors.internalServerError(error.message);
      return { tasks: data ?? [] };
    },
  );

  app.get<{ Params: { id: string } }>('/api/tasks/:id', async (req, reply) => {
    const { data, error } = await req.supabase!
      .from('tasks')
      .select('*, project:projects(id, name, color), content_item:content_items(id, title, type, status)')
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
    const { data, error } = await req.supabase!
      .from('tasks')
      .insert(parsed.data)
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
    if (parsed.data.status === 'done') {
      update.completed_at = new Date().toISOString();
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
    return data;
  });

  app.delete<{ Params: { id: string } }>('/api/tasks/:id', async (req, reply) => {
    const { error } = await req.supabase!.from('tasks').delete().eq('id', req.params.id);
    if (error) throw app.httpErrors.internalServerError(error.message);
    return reply.code(204).send();
  });
};
