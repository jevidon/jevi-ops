import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

// Notifications feed — audit log of voice actions and (later) autonomous
// moves. Schema lives in migration 0001. Status transitions: unread → read,
// or unread/read → dismissed. Dismissed stays visible under a separate tab
// but doesn't count toward the badge.

const StatusFilterSchema = z.enum(['unread', 'read', 'dismissed', 'all']);
const PatchSchema = z.object({
  status: z.enum(['unread', 'read', 'dismissed']),
});

export const notificationRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.requireAuth);

  app.get<{ Querystring: { status?: string; limit?: string } }>(
    '/api/notifications',
    async (req, reply) => {
      const statusParam = StatusFilterSchema.safeParse(req.query.status ?? 'all');
      const status = statusParam.success ? statusParam.data : 'all';
      const limit = Math.min(parseInt(req.query.limit ?? '50', 10) || 50, 200);

      let q = req.supabase!
        .from('notifications')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);
      if (status !== 'all') q = q.eq('status', status);

      const { data, error } = await q;
      if (error) throw app.httpErrors.internalServerError(error.message);
      return { notifications: data ?? [] };
    },
  );

  app.get('/api/notifications/count', async (req) => {
    const { count, error } = await req.supabase!
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'unread');
    if (error) throw app.httpErrors.internalServerError(error.message);
    return { unread: count ?? 0 };
  });

  app.patch<{ Params: { id: string } }>('/api/notifications/:id', async (req, reply) => {
    const parsed = PatchSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'invalid_payload',
        details: parsed.error.flatten().fieldErrors,
      });
    }
    const { data, error } = await req.supabase!
      .from('notifications')
      .update({ status: parsed.data.status })
      .eq('id', req.params.id)
      .select('*')
      .single();
    if (error) throw app.httpErrors.internalServerError(error.message);
    return data;
  });

  app.post('/api/notifications/mark-all-read', async (req) => {
    const { count, error } = await req.supabase!
      .from('notifications')
      .update({ status: 'read' }, { count: 'exact' })
      .eq('status', 'unread');
    if (error) throw app.httpErrors.internalServerError(error.message);
    return { marked_read: count ?? 0 };
  });
};
