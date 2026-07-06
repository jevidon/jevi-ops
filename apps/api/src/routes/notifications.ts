import type { FastifyPluginAsync } from 'fastify';
import { count, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '../lib/db.js';
import { notifications } from '../db/schema.js';

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
    async (req) => {
      const statusParam = StatusFilterSchema.safeParse(req.query.status ?? 'all');
      const status = statusParam.success ? statusParam.data : 'all';
      const limit = Math.min(parseInt(req.query.limit ?? '50', 10) || 50, 200);

      const rows = await getDb().query.notifications.findMany({
        where: status !== 'all' ? eq(notifications.status, status) : undefined,
        orderBy: desc(notifications.created_at),
        limit,
      });
      return { notifications: rows };
    },
  );

  app.get('/api/notifications/count', async () => {
    const [row] = await getDb()
      .select({ n: count() })
      .from(notifications)
      .where(eq(notifications.status, 'unread'));
    return { unread: row?.n ?? 0 };
  });

  app.patch<{ Params: { id: string } }>('/api/notifications/:id', async (req, reply) => {
    const parsed = PatchSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'invalid_payload',
        details: parsed.error.flatten().fieldErrors,
      });
    }
    const [row] = await getDb()
      .update(notifications)
      .set({ status: parsed.data.status })
      .where(eq(notifications.id, req.params.id))
      .returning();
    if (!row) return reply.code(404).send({ error: 'not_found' });
    return row;
  });

  app.post('/api/notifications/mark-all-read', async () => {
    const marked = await getDb()
      .update(notifications)
      .set({ status: 'read' })
      .where(eq(notifications.status, 'unread'))
      .returning({ id: notifications.id });
    return { marked_read: marked.length };
  });
};
