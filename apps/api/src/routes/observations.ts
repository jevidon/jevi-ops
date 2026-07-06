import type { FastifyPluginAsync } from 'fastify';
import { desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '../lib/db.js';
import { observations } from '../db/schema.js';

// /api/observations — read + dismiss the system's observation cards.

const ListQuerySchema = z.object({
  active: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
});

export const observationRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.requireAuth);

  app.get<{ Querystring: { active?: string; limit?: string } }>(
    '/api/observations',
    async (req) => {
      const parsed = ListQuerySchema.safeParse(req.query);
      const { active = true, limit = 50 } = parsed.success ? parsed.data : {};

      const rows = await getDb().query.observations.findMany({
        with: {
          domain: { columns: { id: true, name: true } },
          project: { columns: { id: true, name: true, color: true } },
        },
        where: active ? isNull(observations.dismissed_at) : undefined,
        orderBy: desc(observations.surfaced_at),
        limit,
      });
      return { observations: rows };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/observations/:id/dismiss',
    async (req, reply) => {
      const [row] = await getDb()
        .update(observations)
        .set({ dismissed_at: new Date().toISOString() })
        .where(eq(observations.id, req.params.id))
        .returning();
      if (!row) return reply.code(404).send({ error: 'not_found' });
      return row;
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/observations/:id/acted',
    async (req, reply) => {
      const [row] = await getDb()
        .update(observations)
        .set({ acted_on: true })
        .where(eq(observations.id, req.params.id))
        .returning();
      if (!row) return reply.code(404).send({ error: 'not_found' });
      return row;
    },
  );
};
