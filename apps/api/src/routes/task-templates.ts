import type { FastifyPluginAsync } from 'fastify';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { INBOX_DOMAIN_ID, ProjectFromTemplateSchema, TaskTemplateInputSchema, UpdateTaskTemplateSchema } from '@jevi-ops/shared';
import { projects, stewardship_domains, task_templates } from '../db/schema.js';
import { getDb } from '../lib/db.js';
import { copyTemplateTasks, snapshotProjectEntries } from '../lib/task-template-copy.js';

export const taskTemplateRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.requireAuth);
  app.addHook('preHandler', async (req, reply) => {
    const { id } = req.params as { id?: string };
    if (id !== undefined && !z.string().uuid().safeParse(id).success) {
      return reply.code(400).send({ error: 'invalid_id' });
    }
  });

  app.get('/api/task-templates', async () => ({
    templates: await getDb().select().from(task_templates).orderBy(asc(task_templates.name), asc(task_templates.id)),
  }));

  app.get<{ Params: { id: string } }>('/api/task-templates/:id', async (req, reply) => {
    const [template] = await getDb().select().from(task_templates).where(eq(task_templates.id, req.params.id));
    if (!template) return reply.code(404).send({ error: 'not_found' });
    return template;
  });

  app.delete<{ Params: { id: string } }>('/api/task-templates/:id', async (req, reply) => {
    const [removed] = await getDb().delete(task_templates).where(eq(task_templates.id, req.params.id)).returning({ id: task_templates.id });
    if (!removed) return reply.code(404).send({ error: 'not_found' });
    return reply.code(204).send();
  });

  app.post('/api/task-templates', async (req, reply) => {
    const parsed = TaskTemplateInputSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_payload', details: parsed.error.flatten().fieldErrors });
    const [template] = await getDb().insert(task_templates).values(parsed.data).returning();
    return reply.code(201).send(template);
  });

  // The project's tasks as template entries, without saving anything. The web
  // compares this with an existing template to preview an update.
  app.get<{ Params: { id: string } }>('/api/projects/:id/task-template-snapshot', async (req, reply) => {
    const result = await getDb().transaction(tx => snapshotProjectEntries(tx, req.params.id), { isolationLevel: 'repeatable read' });
    if ('error' in result) return reply.code(result.error === 'not_found' ? 404 : 400).send(result);
    return result;
  });

  app.post<{ Params: { id: string } }>('/api/projects/:id/task-template', async (req, reply) => {
    const parsed = TaskTemplateInputSchema.pick({ name: true }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_payload' });
    const result = await getDb().transaction(async tx => {
      const snapshot = await snapshotProjectEntries(tx, req.params.id);
      if ('error' in snapshot) return snapshot;
      const [template] = await tx.insert(task_templates).values({ name: parsed.data.name, entries: snapshot.entries }).returning();
      return { template };
    }, { isolationLevel: 'repeatable read' });
    if ('error' in result) return reply.code(result.error === 'not_found' ? 404 : 400).send(result);
    return reply.code(201).send(result.template);
  });

  app.put<{ Params: { id: string } }>('/api/task-templates/:id', async (req, reply) => {
    const parsed = UpdateTaskTemplateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_payload', details: parsed.error.flatten().fieldErrors });
    const { expected_revision, ...values } = parsed.data;
    const [template] = await getDb().update(task_templates).set({
      ...values, revision: expected_revision + 1, updated_at: new Date().toISOString(),
    }).where(and(eq(task_templates.id, req.params.id), eq(task_templates.revision, expected_revision))).returning();
    if (!template) {
      const [current] = await getDb().select({ revision: task_templates.revision }).from(task_templates).where(eq(task_templates.id, req.params.id));
      return current
        ? reply.code(409).send({ error: 'template_changed', current_revision: current.revision })
        : reply.code(404).send({ error: 'not_found' });
    }
    return template;
  });

  app.post<{ Params: { id: string } }>('/api/task-templates/:id/projects', async (req, reply) => {
    const parsed = ProjectFromTemplateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_payload', details: parsed.error.flatten().fieldErrors });
    const domainId = parsed.data.domain_id ?? INBOX_DOMAIN_ID;
    const result = await getDb().transaction(async (tx) => {
      // One snapshot of the list: a concurrent template edit can never mix
      // old and new tasks. No project/task keeps a live link to the template.
      const [template] = await tx.select().from(task_templates).where(eq(task_templates.id, req.params.id));
      if (!template) return { error: 'not_found' } as const;
      const [domain] = await tx.select({ id: stewardship_domains.id }).from(stewardship_domains).where(eq(stewardship_domains.id, domainId));
      if (!domain) return { error: 'domain_not_found' } as const;
      const [project] = await tx.insert(projects).values({ name: parsed.data.name, domain_id: domainId, kind: 'project', status: 'active' }).returning();
      if (!project) throw new Error('insert_returned_no_row');
      // New ordinary project => default checkbox workflow; never inherit
      // completion, dates, recurrence, or a domain's direct-task workflow.
      await copyTemplateTasks(tx, template.entries, { projectId: project.id, domainId });
      return { project };
    });
    if ('error' in result) return reply.code(result.error === 'not_found' ? 404 : 400).send(result);
    return reply.code(201).send(result.project);
  });
};
