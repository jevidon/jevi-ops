import type { FastifyPluginAsync } from 'fastify';
import { randomUUID } from 'node:crypto';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { INBOX_DOMAIN_ID, ProjectFromTemplateSchema, TaskTemplateInputSchema, UpdateTaskTemplateSchema } from '@jevi-ops/shared';
import { projects, stewardship_domains, task_templates, tasks } from '../db/schema.js';
import { getDb } from '../lib/db.js';

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

  app.post('/api/task-templates', async (req, reply) => {
    const parsed = TaskTemplateInputSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_payload', details: parsed.error.flatten().fieldErrors });
    const [template] = await getDb().insert(task_templates).values(parsed.data).returning();
    return reply.code(201).send(template);
  });

  app.post<{ Params: { id: string } }>('/api/projects/:id/task-template', async (req, reply) => {
    const parsed = TaskTemplateInputSchema.pick({ name: true }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_payload' });
    const result = await getDb().transaction(async tx => {
      const [project] = await tx.select({ id: projects.id }).from(projects).where(eq(projects.id, req.params.id));
      if (!project) return { error: 'not_found' } as const;
      // Read the entire source, including completed tasks, independently of
      // the detail page's filtering and 500-row display limit. Never truncate.
      const source = await tx.select().from(tasks).where(eq(tasks.project_id, project.id))
        .orderBy(asc(tasks.created_at), asc(tasks.id)).limit(201);
      if (!source.length) return { error: 'empty_project' } as const;
      if (source.length > 200) return { error: 'too_many_tasks' } as const;
      const keys = new Map(source.map(task => [task.id, randomUUID()]));
      const values = TaskTemplateInputSchema.safeParse({ name: parsed.data.name, entries: source.map(task => ({
        key: keys.get(task.id)!, title: task.title, notes: task.notes,
        // A parent outside this project is not copied or linked into it.
        parent_key: task.parent_task_id ? keys.get(task.parent_task_id) ?? null : null,
      })) });
      if (!values.success) return { error: 'invalid_source_tasks' } as const;
      const [template] = await tx.insert(task_templates).values(values.data).returning();
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
      const [current] = await getDb().select({ id: task_templates.id }).from(task_templates).where(eq(task_templates.id, req.params.id));
      return reply.code(current ? 409 : 404).send({ error: current ? 'template_changed' : 'not_found' });
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
      const ids = new Map(template.entries.map(entry => [entry.key, randomUUID()]));
      await tx.insert(tasks).values(template.entries.map(entry => ({
        id: ids.get(entry.key)!, title: entry.title, notes: entry.notes,
        parent_task_id: entry.parent_key ? ids.get(entry.parent_key)! : null,
        project_id: project.id, domain_id: domainId, status: 'open', source: 'manual',
      })));
      return { project };
    });
    if ('error' in result) return reply.code(result.error === 'not_found' ? 404 : 400).send(result);
    return reply.code(201).send(result.project);
  });
};
