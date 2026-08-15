import type { FastifyPluginAsync } from 'fastify';
import { getDb } from '../lib/db.js';
import { buildWork } from '../lib/work.js';

// GET /api/work — the Work page's computed payload (see lib/work.ts).
// Read-only; every value is derived server-side so the page renders,
// never curates.

export const workRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.requireAuth);

  app.get('/api/work', async () => {
    return buildWork(getDb());
  });
};
