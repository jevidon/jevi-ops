import type { FastifyPluginAsync } from 'fastify';
import { CreateProjectSchema, UpdateProjectSchema } from '@jerad-ops/shared/schemas';

export const projectRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.requireAuth);

  app.get('/api/projects', async (req) => {
    // Eager-load milestones and the most-recent-activity timestamp per
    // project so the list page can sort by recency without a second query.
    const { data, error } = await req.supabase!
      .from('projects')
      .select('*, milestones(*), domain:stewardship_domains(id, name)')
      .order('created_at', { ascending: false });
    if (error) throw app.httpErrors.internalServerError(error.message);
    return { projects: data ?? [] };
  });

  // Project detail — used by /projects/[id] page.
  app.get<{ Params: { id: string } }>('/api/projects/:id', async (req, reply) => {
    const id = req.params.id;
    const sb = req.supabase!;

    const [projectRes, milestonesRes, tasksRes, activityRes] = await Promise.all([
      sb
        .from('projects')
        .select('*, domain:stewardship_domains(id, name)')
        .eq('id', id)
        .maybeSingle(),
      sb.from('milestones').select('*').eq('project_id', id).order('position', { ascending: true }),
      sb.from('tasks').select('*').eq('project_id', id).order('created_at', { ascending: false }).limit(500),
      sb.from('activity_log').select('*').eq('project_id', id).order('logged_at', { ascending: false }).limit(200),
    ]);

    if (projectRes.error) throw app.httpErrors.internalServerError(projectRes.error.message);
    if (!projectRes.data) return reply.code(404).send({ error: 'not_found' });
    if (milestonesRes.error) throw app.httpErrors.internalServerError(milestonesRes.error.message);
    if (tasksRes.error) throw app.httpErrors.internalServerError(tasksRes.error.message);
    if (activityRes.error) throw app.httpErrors.internalServerError(activityRes.error.message);

    return {
      project: projectRes.data,
      milestones: milestonesRes.data ?? [],
      tasks: tasksRes.data ?? [],
      activity: activityRes.data ?? [],
    };
  });

  app.post('/api/projects', async (req, reply) => {
    const parsed = CreateProjectSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'invalid_payload',
        details: parsed.error.flatten().fieldErrors,
      });
    }
    const { data, error } = await req.supabase!
      .from('projects')
      .insert(parsed.data)
      .select('*')
      .single();
    if (error) throw app.httpErrors.internalServerError(error.message);
    return reply.code(201).send(data);
  });

  app.patch<{ Params: { id: string } }>('/api/projects/:id', async (req, reply) => {
    const parsed = UpdateProjectSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'invalid_payload',
        details: parsed.error.flatten().fieldErrors,
      });
    }
    const update: Record<string, unknown> = { ...parsed.data };
    if (parsed.data.status === 'done') update.completed_at = new Date().toISOString();
    const { data, error } = await req.supabase!
      .from('projects')
      .update(update)
      .eq('id', req.params.id)
      .select('*')
      .single();
    if (error) throw app.httpErrors.internalServerError(error.message);
    return data;
  });

  app.delete<{ Params: { id: string } }>('/api/projects/:id', async (req, reply) => {
    // tasks.project_id has ON DELETE SET NULL so child tasks are preserved
    // and just unlinked. Milestones cascade-delete via their FK. Activity
    // log entries lose their project_id but rows stick around.
    const { error } = await req.supabase!
      .from('projects')
      .delete()
      .eq('id', req.params.id);
    if (error) throw app.httpErrors.internalServerError(error.message);
    return reply.code(204).send();
  });
};
