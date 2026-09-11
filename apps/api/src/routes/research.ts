import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z, ZodError } from 'zod';
import { ResearchJobInputSchema, ResearchClaimSchema, type ResearchWorkerScope } from '@jevi-ops/shared';
import { getDb } from '../lib/db.js';
import { requireOwnerSession } from '../lib/owner-session.js';
import { getAppSettings } from '../lib/app-settings.js';
import { todayInTz } from '../lib/tz.js';
import { CommandError } from '../lib/command-error.js';
import { AssetContextError } from '../lib/asset-context.js';
import { DocConflict, DocVersionRequired } from '../lib/docs.js';
import {
  approveResearchProposal, cancelResearchJob, claimResearchJob, createResearchWorker, failResearchJob,
  heartbeatResearchJob, listResearchJobs, listResearchProposals, listResearchWorkers, previewResearchProposal,
  recordResearchWorkerHealth, rejectResearchProposal, requestResearch, researchJobContext, researchJobStatus,
  submitResearchResult, updateResearchWorker,
} from '../lib/research.js';

const id = (value: unknown) => z.string().uuid().parse(value);
const actor = (req: FastifyRequest) => `session:${req.user!.email}`;
async function context() { const settings = await getAppSettings(); return { today: todayInTz(settings.timezone), staleDays: settings.meter_stale_days }; }
async function respond(reply: FastifyReply, fn: () => Promise<unknown>) {
  try { return await fn(); }
  catch (error) {
    if (error instanceof ZodError) return reply.code(400).send({ error: 'invalid_payload', details: error.flatten() });
    if (error instanceof CommandError) return reply.code(error.status).send({ error: error.code, message: error.message, ...error.details });
    if (error instanceof AssetContextError) return reply.code(error.status).send({ error: error.message });
    if (error instanceof DocConflict) return reply.code(409).send({ error: 'doc_conflict', ...error.current });
    if (error instanceof DocVersionRequired) return reply.code(400).send({ error: 'doc_version_required' });
    throw error;
  }
}
export const researchRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.requireAuth);
  const owner = { preHandler: requireOwnerSession };
  const worker = (scope: ResearchWorkerScope) => ({ config: { researchScope: scope }, preHandler: async (req: FastifyRequest, reply: FastifyReply) => {
    if (req.permissionProfile !== 'research_worker' || !req.workerId) return reply.code(403).send({ error: 'research_worker_required' });
  } });
  app.get('/api/research/workers', owner, async () => ({ workers: await listResearchWorkers(getDb()) }));
  app.post('/api/research/workers', owner, (req, reply) => respond(reply, async () => reply.code(201).send({ worker: await createResearchWorker(getDb(), req.body) })));
  app.patch<{ Params: { id: string } }>('/api/research/workers/:id', owner, (req, reply) => respond(reply, async () => ({ worker: await updateResearchWorker(getDb(), id(req.params.id), req.body) })));
  app.get<{ Querystring: { asset_id?: string } }>('/api/research/jobs', owner, (req, reply) => respond(reply, async () => ({ jobs: await listResearchJobs(getDb(), req.query.asset_id ? id(req.query.asset_id) : undefined) })));
  app.post('/api/research/jobs', owner, (req, reply) => respond(reply, async () => reply.code(201).send({ job: await requestResearch(getDb(), ResearchJobInputSchema.parse(req.body), actor(req)) })));
  app.get<{ Params: { id: string } }>('/api/research/jobs/:id', owner, (req, reply) => respond(reply, () => researchJobStatus(getDb(), id(req.params.id))));
  app.post<{ Params: { id: string } }>('/api/research/jobs/:id/cancel', owner, (req, reply) => respond(reply, async () => ({ job: await cancelResearchJob(getDb(), id(req.params.id), actor(req)) })));
  app.get<{ Querystring: { asset_id?: string } }>('/api/research/proposals', owner, (req, reply) => respond(reply, async () => ({ proposals: await listResearchProposals(getDb(), req.query.asset_id ? id(req.query.asset_id) : undefined) })));
  app.post<{ Params: { id: string } }>('/api/research/proposals/:id/preview', owner, (req, reply) => respond(reply, async () => ({ proposal: await previewResearchProposal(getDb(), id(req.params.id), actor(req), await context()) })));
  app.post<{ Params: { id: string } }>('/api/research/proposals/:id/approve', owner, (req, reply) => respond(reply, async () => ({ receipt: await approveResearchProposal(getDb(), id(req.params.id), req.body, actor(req), await context()) })));
  app.post<{ Params: { id: string } }>('/api/research/proposals/:id/reject', owner, (req, reply) => respond(reply, async () => ({ proposal: await rejectResearchProposal(getDb(), id(req.params.id), req.body, actor(req)) })));

  app.post('/api/research/health', worker('research:health'), (req, reply) => respond(reply, () => recordResearchWorkerHealth(getDb(), req.workerId!, req.body)));
  app.post('/api/research/claim', worker('research:claim'), (req, reply) => respond(reply, async () => { ResearchClaimSchema.parse(req.body ?? {}); return claimResearchJob(getDb(), req.workerId!); }));
  app.post<{ Params: { id: string }; Querystring: { offset?: string } }>('/api/research/jobs/:id/context', worker('research:context'), (req, reply) => respond(reply, () => researchJobContext(getDb(), id(req.params.id), req.workerId!, req.body, z.coerce.number().int().min(0).max(100_000).parse(req.query.offset ?? 0))));
  app.post<{ Params: { id: string } }>('/api/research/jobs/:id/heartbeat', worker('research:heartbeat'), (req, reply) => respond(reply, () => heartbeatResearchJob(getDb(), id(req.params.id), req.workerId!, req.body)));
  app.post<{ Params: { id: string } }>('/api/research/jobs/:id/result', { ...worker('research:result'), bodyLimit: 2_500_000 }, (req, reply) => respond(reply, () => submitResearchResult(getDb(), id(req.params.id), req.workerId!, req.body)));
  app.post<{ Params: { id: string } }>('/api/research/jobs/:id/failure', worker('research:result'), (req, reply) => respond(reply, () => failResearchJob(getDb(), id(req.params.id), req.workerId!, req.body)));
  app.get<{ Params: { id: string } }>('/api/research/jobs/:id/status', worker('research:status'), (req, reply) => respond(reply, () => researchJobStatus(getDb(), id(req.params.id), req.workerId!)));
};
