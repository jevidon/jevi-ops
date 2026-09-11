import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { CompleteOnboardingSchema, OnboardingRevisionSchema, SaveOnboardingStepSchema, StartOnboardingSchema } from '@jevi-ops/shared/schemas';
import { requireOwnerSession } from '../lib/owner-session.js';
import { CommandError } from '../lib/command-error.js';
import { ReadingRejected } from '../lib/meter-readings.js';
import { SourceError } from '../lib/private-sources.js';
import { getDb } from '../lib/db.js';
import { auth_user } from '../db/schema.js';
import { getCoreSetupContext, interpretCoreStructure } from '../lib/core-onboarding.js';
import {
  completeOnboardingSession, getInstallationSetup, getOnboardingModule, getOnboardingSession,
  listOnboardingModules, listOnboardingOperationReceipts, listOnboardingSessions, OnboardingError,
  previewOnboardingSession, saveOnboardingStep, startOnboardingSession, transitionOnboardingSession,
} from '../lib/onboarding.js';

const Id = z.string().uuid();
function failure(error: unknown, reply: FastifyReply) {
  if (error instanceof CommandError) return reply.code(error.status).send({ error: error.code, message: error.message, ...error.details });
  if (error instanceof SourceError) return reply.code(error.status).send({ error: error.code, message: error.message });
  if (error instanceof ReadingRejected) return reply.code(409).send({ error: error.code, message: error.message });
  if (error instanceof OnboardingError) return reply.code(error.status).send({ error: error.code, ...error.details });
  if (error instanceof z.ZodError) return reply.code(400).send({ error: 'invalid_payload',
    details: error.issues.map((issue) => ({ path: issue.path, message: issue.message })) });
  throw error;
}

export const onboardingRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.requireAuth);
  app.addHook('preHandler', requireOwnerSession);
  app.addHook('preHandler', async (req, reply) => {
    const [owner] = await getDb().select({ id: auth_user.id }).from(auth_user).where(eq(auth_user.id, req.user!.id));
    if (!owner) return reply.code(403).send({ error: 'owner_session_required' });
  });

  app.get('/api/onboarding/modules', async () => ({ modules: await listOnboardingModules() }));
  app.get('/api/onboarding/installation', async (_req, reply) => {
    try { return await getInstallationSetup(); } catch (err) { return failure(err, reply); }
  });
  app.get('/api/onboarding/sessions', async (req) => ({ sessions: await listOnboardingSessions(req.user!.id) }));
  app.get<{ Params: { id: string } }>('/api/onboarding/sessions/:id/core-context', async (req, reply) => {
    try { return await getCoreSetupContext(Id.parse(req.params.id), req.user!.id); }
    catch (err) { return failure(err, reply); }
  });
  app.post('/api/onboarding/core/interpret-structure', async (req, reply) => {
    try { return await interpretCoreStructure(z.object({ text: z.string().min(1).max(4000) }).strict().parse(req.body).text); }
    catch (err) { return failure(err, reply); }
  });
  app.post('/api/onboarding/sessions', async (req, reply) => {
    try { return await startOnboardingSession(StartOnboardingSchema.parse(req.body), req.user!.id); }
    catch (err) { return failure(err, reply); }
  });
  app.get<{ Params: { id: string } }>('/api/onboarding/sessions/:id', async (req, reply) => {
    try {
      const session = await getOnboardingSession(Id.parse(req.params.id), req.user!.id);
      const module = getOnboardingModule(session.module_id);
      return { session, module: module.definition,
        warning: session.module_version !== module.definition.version ? { code: 'module_version_changed', can_migrate: Boolean(module.migrateDraft) } : null };
    } catch (err) { return failure(err, reply); }
  });
  app.get<{ Params: { id: string } }>('/api/onboarding/sessions/:id/receipts', async (req, reply) => {
    try { return { receipts: await listOnboardingOperationReceipts(Id.parse(req.params.id), req.user!.id) }; }
    catch (err) { return failure(err, reply); }
  });
  app.patch<{ Params: { id: string; stepId: string } }>('/api/onboarding/sessions/:id/steps/:stepId', async (req, reply) => {
    try { return await saveOnboardingStep(Id.parse(req.params.id), req.params.stepId, SaveOnboardingStepSchema.parse(req.body), req.user!.id); }
    catch (err) { return failure(err, reply); }
  });
  for (const action of ['defer', 'resume', 'abandon'] as const) {
    app.post<{ Params: { id: string } }>(`/api/onboarding/sessions/:id/${action}`, async (req, reply) => {
      try { return await transitionOnboardingSession(Id.parse(req.params.id), action, OnboardingRevisionSchema.parse(req.body).expected_revision, req.user!.id); }
      catch (err) { return failure(err, reply); }
    });
  }
  app.post<{ Params: { id: string } }>('/api/onboarding/sessions/:id/preview', async (req, reply) => {
    try { return await previewOnboardingSession(Id.parse(req.params.id), OnboardingRevisionSchema.parse(req.body).expected_revision, req.user!.id); }
    catch (err) { return failure(err, reply); }
  });
  app.post<{ Params: { id: string } }>('/api/onboarding/sessions/:id/complete', async (req, reply) => {
    try { return await completeOnboardingSession(Id.parse(req.params.id), CompleteOnboardingSchema.parse(req.body), req.user!.id); }
    catch (err) { return failure(err, reply); }
  });
  app.post<{ Params: { id: string; actionId: string } }>('/api/onboarding/sessions/:id/actions/:actionId/preview', async (req, reply) => {
    try { return await previewOnboardingSession(Id.parse(req.params.id), OnboardingRevisionSchema.parse(req.body).expected_revision, req.user!.id, req.params.actionId); }
    catch (err) { return failure(err, reply); }
  });
  app.post<{ Params: { id: string; actionId: string } }>('/api/onboarding/sessions/:id/actions/:actionId/apply', async (req, reply) => {
    try { return await completeOnboardingSession(Id.parse(req.params.id), CompleteOnboardingSchema.parse(req.body), req.user!.id, req.params.actionId); }
    catch (err) { return failure(err, reply); }
  });
};
