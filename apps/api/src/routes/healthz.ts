import type { FastifyPluginAsync } from 'fastify';
import { getDb, isDatabaseConfigured, sqlClient } from '../lib/db.js';
import { isAuthConfigured } from '../lib/jwt.js';
import { isLlmConfigured } from '../lib/llm.js';
import { isSttConfigured } from '../lib/stt.js';

// /healthz + /readyz — infrastructure health endpoints. Named with the
// trailing 'z' so they don't collide with the new /api/health/* personal
// health record routes (apps/api/src/routes/health.ts).

export const healthzRoutes: FastifyPluginAsync = async (app) => {
  app.get('/healthz', async () => {
    return {
      status: 'ok',
      time: new Date().toISOString(),
      database_configured: isDatabaseConfigured(),
      auth_configured: isAuthConfigured(),
      llm_configured: await isLlmConfigured(),
      stt_configured: await isSttConfigured(),
    };
  });

  app.get('/readyz', async (_req, reply) => {
    if (!isDatabaseConfigured()) {
      return reply.code(503).send({
        status: 'not_ready',
        reason: 'database_not_configured',
      });
    }
    // Real readiness: round-trip the database.
    try {
      getDb();
      await sqlClient()`select 1`;
    } catch (err) {
      return reply.code(503).send({
        status: 'not_ready',
        reason: 'database_unreachable',
        message: err instanceof Error ? err.message : 'unknown',
      });
    }
    return { status: 'ready' };
  });
};
