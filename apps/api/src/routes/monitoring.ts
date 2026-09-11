import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z, ZodError } from 'zod';
import { MonitoringPolicyInputSchema } from '@jevi-ops/shared';
import { getDb } from '../lib/db.js';
import { CommandError } from '../lib/command-error.js';
import { requireOwnerSession } from '../lib/owner-session.js';
import { createMonitoringPolicy, listMonitoringPolicies, monitoringPolicyDetail, readMonitoringNotification, runMonitoringSweep, signalMonitoringReview, updateMonitoringPolicy } from '../lib/monitoring.js';
const id = (value: unknown) => z.string().uuid().parse(value);
const actor = (req: FastifyRequest) => `session:${req.user!.email}`;
async function respond(reply: FastifyReply, action: () => Promise<unknown>) { try { return await action(); } catch (error) { if (error instanceof ZodError) return reply.code(400).send({ error: 'invalid_payload', details: error.flatten() }); if (error instanceof CommandError) return reply.code(error.status).send({ error: error.code, message: error.message }); throw error; } }
export const monitoringRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.requireAuth); app.addHook('preHandler', requireOwnerSession);
  app.get<{ Querystring: { asset_id?: string } }>('/api/monitoring/policies', (req, reply) => respond(reply, async () => ({ policies: await listMonitoringPolicies(getDb(), req.query.asset_id ? id(req.query.asset_id) : undefined) })));
  app.post('/api/monitoring/policies', (req, reply) => respond(reply, async () => reply.code(201).send({ policy: await createMonitoringPolicy(getDb(), MonitoringPolicyInputSchema.parse(req.body), actor(req)) })));
  app.get<{ Params: { id: string } }>('/api/monitoring/policies/:id', (req, reply) => respond(reply, () => monitoringPolicyDetail(getDb(), id(req.params.id))));
  app.patch<{ Params: { id: string } }>('/api/monitoring/policies/:id', (req, reply) => respond(reply, async () => ({ policy: await updateMonitoringPolicy(getDb(), id(req.params.id), req.body, actor(req)) })));
  app.post<{ Params: { id: string } }>('/api/monitoring/policies/:id/signals', (req, reply) => respond(reply, async () => ({ signal: await signalMonitoringReview(getDb(), id(req.params.id), req.body, actor(req)) })));
  app.post<{ Params: { id: string } }>('/api/monitoring/notifications/:id/read', (req, reply) => respond(reply, async () => ({ notification: await readMonitoringNotification(getDb(), id(req.params.id)) })));
  app.post('/api/monitoring/process', (_req, reply) => respond(reply, () => runMonitoringSweep(getDb())));
};
