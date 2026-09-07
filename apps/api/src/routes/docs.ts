import type { FastifyPluginAsync } from 'fastify';
import { DocEntityTypeSchema } from '@jevi-ops/shared';
import { getDb } from '../lib/db.js';
import { listDocRevisions } from '../lib/docs.js';

// The document history (0050). Saving goes through each entity's own
// PATCH (assets, projects, domains) so a doc edit rides with the row it
// belongs to; this route only reads the revisions back.

export const docRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.requireAuth);

  app.get<{ Params: { entity: string; id: string }; Querystring: { limit?: string } }>(
    '/api/docs/:entity/:id/revisions',
    async (req, reply) => {
      const entity = DocEntityTypeSchema.safeParse(req.params.entity);
      if (!entity.success) return reply.code(400).send({ error: 'invalid_entity_type' });
      const limitRaw = Number.parseInt(req.query.limit ?? '', 10);
      const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 100) : 20;
      const revisions = await listDocRevisions(getDb(), entity.data, req.params.id, limit);
      return { revisions };
    },
  );
};
