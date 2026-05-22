import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

// /api/observations — read + dismiss the system's observation cards.
// All operations go through the user-scoped Supabase client (RLS applies).

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

      let q = req.supabase!
        .from('observations')
        .select('*, domain:stewardship_domains(id, name), project:projects(id, name, color)')
        .order('surfaced_at', { ascending: false })
        .limit(limit);
      if (active) q = q.is('dismissed_at', null);

      const { data, error } = await q;
      if (error) throw app.httpErrors.internalServerError(error.message);
      return { observations: data ?? [] };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/observations/:id/dismiss',
    async (req, reply) => {
      const { data, error } = await req.supabase!
        .from('observations')
        .update({ dismissed_at: new Date().toISOString() })
        .eq('id', req.params.id)
        .select('*')
        .single();
      if (error) throw app.httpErrors.internalServerError(error.message);
      if (!data) return reply.code(404).send({ error: 'not_found' });
      return data;
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/observations/:id/acted',
    async (req, reply) => {
      const { data, error } = await req.supabase!
        .from('observations')
        .update({ acted_on: true })
        .eq('id', req.params.id)
        .select('*')
        .single();
      if (error) throw app.httpErrors.internalServerError(error.message);
      if (!data) return reply.code(404).send({ error: 'not_found' });
      return data;
    },
  );
};
