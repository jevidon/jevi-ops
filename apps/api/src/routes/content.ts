import type { FastifyPluginAsync } from 'fastify';
import {
  CreateContentItemSchema, UpdateContentItemSchema,
} from '@jerad-ops/shared/schemas';

// Content items CRUD — videos, articles, podcasts, etc. Joins domain on
// fetch so the UI can show the channel name + color without a second
// request. RLS handled by the request-scoped supabase client.

export const contentRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.requireAuth);

  app.get<{ Querystring: { status?: string; domain_id?: string; type?: string; limit?: string } }>(
    '/api/content',
    async (req) => {
      const limit = Math.min(parseInt(req.query.limit ?? '500', 10) || 500, 2000);
      let q = req.supabase!
        .from('content_items')
        .select('*, domain:stewardship_domains(id, name)')
        .order('updated_at', { ascending: false })
        .limit(limit);
      if (req.query.status) q = q.eq('status', req.query.status);
      if (req.query.domain_id) q = q.eq('domain_id', req.query.domain_id);
      if (req.query.type) q = q.eq('type', req.query.type);
      const { data, error } = await q;
      if (error) throw app.httpErrors.internalServerError(error.message);
      return { items: data ?? [] };
    },
  );

  app.get<{ Params: { id: string } }>('/api/content/:id', async (req, reply) => {
    const { data, error } = await req.supabase!
      .from('content_items')
      .select('*, domain:stewardship_domains(id, name)')
      .eq('id', req.params.id)
      .maybeSingle();
    if (error) throw app.httpErrors.internalServerError(error.message);
    if (!data) return reply.code(404).send({ error: 'not_found' });
    return data;
  });

  app.post('/api/content', async (req, reply) => {
    const parsed = CreateContentItemSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_payload', details: parsed.error.flatten().fieldErrors });
    }
    const { data, error } = await req.supabase!
      .from('content_items')
      .insert(parsed.data)
      .select('*')
      .single();
    if (error) throw app.httpErrors.internalServerError(error.message);
    return reply.code(201).send(data);
  });

  app.patch<{ Params: { id: string } }>('/api/content/:id', async (req, reply) => {
    const parsed = UpdateContentItemSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_payload', details: parsed.error.flatten().fieldErrors });
    }
    if (Object.keys(parsed.data).length === 0) {
      return reply.code(400).send({ error: 'empty_payload' });
    }
    // Bump updated_at since the DB doesn't auto-do that here.
    const { data, error } = await req.supabase!
      .from('content_items')
      .update({ ...parsed.data, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .select('*')
      .single();
    if (error) throw app.httpErrors.internalServerError(error.message);
    return data;
  });

  app.delete<{ Params: { id: string } }>('/api/content/:id', async (req, reply) => {
    // parent_id has ON DELETE SET NULL so derivative chains aren't cascaded.
    const { error } = await req.supabase!.from('content_items').delete().eq('id', req.params.id);
    if (error) throw app.httpErrors.internalServerError(error.message);
    return reply.code(204).send();
  });
};
