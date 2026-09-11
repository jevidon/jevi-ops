import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError, z } from 'zod';
import { eq, desc } from 'drizzle-orm';
import { KnowledgeChangeSchema, KnowledgeFollowupSchema, ResponsibilityVersionInputSchema } from '@jevi-ops/shared';
import { responsibility_rule_versions, responsibility_rule_sources } from '../db/knowledge-schema.js';
import { getDb } from '../lib/db.js';
import { getAppSettings } from '../lib/app-settings.js';
import { todayInTz } from '../lib/tz.js';
import { requireOwnerSession } from '../lib/owner-session.js';
import { CommandError } from '../lib/command-error.js';
import {
  applyKnowledgeChange, assessmentHistory, cancelKnowledgeTransition, createKnowledgeFollowup,
  createResponsibilityRule, listResponsibilityRules, previewKnowledgeChange, processKnowledgeTransitions,
  reviseResponsibilityRule, transitionAudit, vehicleKnowledge,
} from '../lib/knowledge.js';

function actor(req: FastifyRequest) { return `session:${req.user!.email}`; }
const id = (value: unknown) => z.string().uuid().parse(value);
async function ctx() { const settings = await getAppSettings(); return { today: todayInTz(settings.timezone), staleDays: settings.meter_stale_days }; }
async function respond(reply: FastifyReply, fn: () => Promise<unknown>) {
  try { return await fn(); }
  catch (error) {
    if (error instanceof ZodError) return reply.code(400).send({ error: 'invalid_payload', details: error.flatten() });
    if (error instanceof CommandError) return reply.code(error.status).send({ error: error.code, message: error.message, ...error.details });
    throw error;
  }
}

export const knowledgeRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.requireAuth);
  app.addHook('preHandler', requireOwnerSession);

  app.get('/api/responsibilities', async () => ({ rules: await listResponsibilityRules(getDb()) }));
  app.post('/api/responsibilities', async (req, reply) => respond(reply, async () => {
    const version = await createResponsibilityRule(getDb(), ResponsibilityVersionInputSchema.parse(req.body), actor(req));
    return reply.code(201).send({ version });
  }));
  app.post<{ Params: { id: string } }>('/api/responsibilities/:id/versions', async (req, reply) => respond(reply, async () => {
    const version = await reviseResponsibilityRule(getDb(), id(req.params.id), req.body, actor(req));
    return reply.code(201).send({ version });
  }));
  app.get<{ Params: { id: string } }>('/api/responsibilities/:id/versions', async (req, reply) => respond(reply, async () => {
    const versions = await getDb().select().from(responsibility_rule_versions).where(eq(responsibility_rule_versions.rule_id, id(req.params.id))).orderBy(desc(responsibility_rule_versions.version));
    return { versions: await Promise.all(versions.map(async (version) => ({ ...version, source_ids: (await getDb().select({ id: responsibility_rule_sources.source_id }).from(responsibility_rule_sources).where(eq(responsibility_rule_sources.rule_version_id, version.id))).map((row) => row.id) }))) };
  }));
  app.get<{ Params: { id: string } }>('/api/assets/:id/knowledge', async (req, reply) => respond(reply, () => vehicleKnowledge(getDb(), id(req.params.id))));
  app.post('/api/knowledge/preview', async (req, reply) => respond(reply, async () => {
    const preview = await previewKnowledgeChange(getDb(), KnowledgeChangeSchema.parse(req.body), actor(req));
    return reply.code(201).send({ preview });
  }));
  app.post('/api/knowledge/accept', async (req, reply) => respond(reply, async () => ({ receipt: await applyKnowledgeChange(getDb(), req.body, actor(req), await ctx()) })));
  app.get<{ Params: { id: string } }>('/api/knowledge/assessments/:id/history', async (req, reply) => respond(reply, async () => ({ history: await assessmentHistory(getDb(), id(req.params.id)) })));
  app.post<{ Params: { id: string } }>('/api/knowledge/assessments/:id/follow-up', async (req, reply) => respond(reply, async () => {
    const data = KnowledgeFollowupSchema.parse(req.body ?? {});
    return { task: await createKnowledgeFollowup(getDb(), id(req.params.id), actor(req), data.title) };
  }));
  app.get<{ Params: { id: string } }>('/api/knowledge/transitions/:id/history', async (req, reply) => respond(reply, async () => ({ history: await transitionAudit(getDb(), id(req.params.id)) })));
  app.post<{ Params: { id: string } }>('/api/knowledge/transitions/:id/cancel', async (req, reply) => respond(reply, async () => ({ transition: await cancelKnowledgeTransition(getDb(), id(req.params.id), req.body, actor(req)) })));
  app.post('/api/knowledge/transitions/process', async (req, reply) => respond(reply, async () => processKnowledgeTransitions(getDb(), await ctx())));
};
