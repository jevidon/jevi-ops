import type { FastifyPluginAsync } from 'fastify';
import { CreateTaskSchema, UpdateTaskSchema } from '@jerad-ops/shared/schemas';

// Tasks CRUD. Auth-gated; uses request-scoped Supabase client so RLS applies.

export const taskRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.requireAuth);

  app.get('/api/tasks', async (req) => {
    const sb = req.supabase!;
    const { data, error } = await sb
      .from('tasks')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(500);
    if (error) throw app.httpErrors.internalServerError(error.message);
    return { tasks: data ?? [] };
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
