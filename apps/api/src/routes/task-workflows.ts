import type { FastifyPluginAsync } from 'fastify';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { BUILTIN_WORKFLOW_PRESETS, ConfigureTaskWorkflowSchema, CreateWorkflowPresetSchema, effectiveWorkflowStatus } from '@jevi-ops/shared';
import { getDb } from '../lib/db.js';
import { projects, stewardship_domains, tasks, task_workflow_presets } from '../db/schema.js';

export const taskWorkflowRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.requireAuth);

  app.get('/api/task-workflows', async () => {
    const db = getDb();
    const [projectRows, domainRows, presets] = await Promise.all([
      db.select({ id: projects.id, definition: projects.task_workflow, revision: projects.workflow_revision }).from(projects),
      db.select({ id: stewardship_domains.id, definition: stewardship_domains.task_workflow, revision: stewardship_domains.workflow_revision }).from(stewardship_domains),
      db.select().from(task_workflow_presets).orderBy(task_workflow_presets.name),
    ]);
    return { scopes: [...projectRows.map(r => ({ ...r, scope: 'project' })), ...domainRows.map(r => ({ ...r, scope: 'domain' }))], presets: [...BUILTIN_WORKFLOW_PRESETS, ...presets] };
  });

  app.put<{ Params: { scope: string; id: string } }>('/api/task-workflows/:scope/:id', async (req, reply) => {
    const parsed = ConfigureTaskWorkflowSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_workflow', message: parsed.error.issues.map(i => i.message).join(' ') });
    if (!['project', 'domain'].includes(req.params.scope)) return reply.code(400).send({ error: 'invalid_scope' });
    const table = req.params.scope === 'project' ? projects : stewardship_domains;
    const { definition, expected_revision } = parsed.data;
    const result = await getDb().transaction(async tx => {
      // Configuration changes are rare. Briefly serialize with ALL task writers,
      // including older clients, so occupancy validation and migration are atomic.
      await tx.execute(sql`lock table tasks in share row exclusive mode`);
      const [scope] = await tx.select().from(table).where(eq(table.id, req.params.id)).for('update');
      if (!scope) return { code: 404, body: { error: 'not_found' } };
      if (scope.workflow_revision !== expected_revision) return { code: 409, body: { error: 'workflow_changed', message: 'Settings changed. Refresh before saving again.' } };
      const condition = req.params.scope === 'project'
        ? eq(tasks.project_id, scope.id)
        : and(isNull(tasks.project_id), eq(tasks.domain_id, scope.id));
      const entries = await tx.select({ status: tasks.status, workflow_status_id: tasks.workflow_status_id }).from(tasks).where(condition);
      if (definition && scope.task_workflow) {
        for (const entry of entries) {
          const current = effectiveWorkflowStatus(entry, scope.task_workflow);
          if (!current) continue;
          const next = definition.statuses.find(s => s.id === current.id);
          if (!next || next.category !== current.category) return { code: 409, body: { error: 'status_in_use', message: `Move tasks out of “${current.label}” before removing it or changing its meaning.` } };
        }
      }
      await tx.update(table).set({ task_workflow: definition, workflow_revision: expected_revision + 1 }).where(eq(table.id, scope.id));
      // Materialize defaults on activation; preserve every task's category,
      // completion timestamps, recurrence and existing selection on edits.
      await tx.update(tasks).set({ workflow_status_id: definition && scope.task_workflow ? sql`${tasks.workflow_status_id}` : null }).where(condition);
      return { code: 200, body: { id: scope.id, scope: req.params.scope, definition, revision: expected_revision + 1 } };
    });
    return reply.code(result.code).send(result.body);
  });

  app.post('/api/task-workflow-presets', async (req, reply) => {
    const parsed = CreateWorkflowPresetSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_preset' });
    const [preset] = await getDb().insert(task_workflow_presets).values(parsed.data).returning();
    return reply.code(201).send(preset);
  });
  app.delete<{ Params: { id: string } }>('/api/task-workflow-presets/:id', async (req, reply) => {
    const [preset] = await getDb().delete(task_workflow_presets).where(eq(task_workflow_presets.id, req.params.id)).returning();
    return reply.code(preset ? 204 : 404).send(preset ? undefined : { error: 'not_found' });
  });
};
