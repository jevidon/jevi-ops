import type { FastifyPluginAsync } from 'fastify';
import { readFile } from 'node:fs/promises';
import { requireOwnerSession } from '../lib/owner-session.js';

export const researchSetupRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.requireAuth);
  app.addHook('preHandler', requireOwnerSession);
  app.get('/api/research/setup-package', async (_req, reply) => {
    try {
      const runtime = JSON.parse(await readFile(new URL('../../../../workers/hermes/runtime.json', import.meta.url), 'utf8')) as { adapter_version: string };
      return { adapter: 'jevi-hermes', adapter_version: runtime.adapter_version, capabilities: ['external_fetch'], allowed_task_types: ['vehicle_question', 'responsibility_review', 'source_verification'] };
    } catch { return reply.code(503).send({ error: 'worker_package_unavailable' }); }
  });
  app.get('/api/research/setup-guide', async (_req, reply) => {
    try {
      const guide = await readFile(new URL('../../../../workers/hermes/README.md', import.meta.url), 'utf8');
      return reply.header('Content-Type', 'text/markdown; charset=utf-8').header('Cache-Control', 'private, no-store').send(guide);
    } catch { return reply.code(503).send({ error: 'worker_guide_unavailable' }); }
  });
};
