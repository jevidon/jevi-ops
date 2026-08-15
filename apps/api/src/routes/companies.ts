import type { FastifyPluginAsync } from 'fastify';
import { asc, desc, eq, inArray } from 'drizzle-orm';
import { CreateCompanySchema, UpdateCompanySchema } from '@jevi-ops/shared/schemas';
import { getDb } from '../lib/db.js';
import { companies, conversations, people, projects, tasks } from '../db/schema.js';

// Companies (CRM port, migration 0041). List carries synthesized
// contact/project counts for the card grid; detail is the company page's
// whole payload: contacts, projects, conversation timeline, and an
// open-task rollup reached through the company's projects (tasks carry
// no company_id).

const OPEN_TASKS_CAP = 20;

export const companyRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.requireAuth);

  app.get<{ Querystring: { relationship_type?: string; active?: string } }>(
    '/api/companies',
    async (req) => {
      const db = getDb();
      // Companies lists are small — fetch once, filter in JS.
      const rows = await db.query.companies.findMany({
        with: {
          domain: { columns: { id: true, name: true } },
          contacts: { columns: { id: true } },
          projects: { columns: { id: true, status: true } },
        },
        orderBy: asc(companies.name),
      });
      const filtered = rows.filter((c) =>
        (!req.query.relationship_type || c.relationship_type === req.query.relationship_type)
        && (req.query.active !== 'true' || c.active));
      return {
        companies: filtered.map((c) => ({
          ...c,
          contact_count: c.contacts?.length ?? 0,
          active_project_count: (c.projects ?? []).filter((p) => p.status === 'active').length,
          contacts: undefined,
          projects: undefined,
        })),
      };
    },
  );

  app.get<{ Params: { id: string } }>('/api/companies/:id', async (req, reply) => {
    const id = req.params.id;
    const db = getDb();
    const [company, contacts, companyProjects, companyConversations] = await Promise.all([
      db.query.companies.findFirst({
        where: eq(companies.id, id),
        with: { domain: { columns: { id: true, name: true } } },
      }),
      db.query.people.findMany({
        columns: {
          id: true, name: true, email: true, phone: true,
          role_at_company: true, is_primary_contact: true,
        },
        where: eq(people.company_id, id),
        orderBy: asc(people.name),
      }),
      db.query.projects.findMany({
        columns: { id: true, name: true, status: true, color: true },
        where: eq(projects.company_id, id),
        orderBy: desc(projects.created_at),
      }),
      db.query.conversations.findMany({
        where: eq(conversations.company_id, id),
        with: {
          person: { columns: { id: true, name: true } },
          project: { columns: { id: true, name: true, color: true } },
        },
        orderBy: desc(conversations.occurred_at),
        limit: 100,
      }),
    ]);
    if (!company) return reply.code(404).send({ error: 'not_found' });

    // Open tasks across the company's projects: capped list + exact total.
    const projectIds = companyProjects.map((p) => p.id);
    let openTasks: Array<Record<string, unknown>> = [];
    let openTasksCount = 0;
    if (projectIds.length > 0) {
      const rows = await db.query.tasks.findMany({
        columns: { id: true, title: true, due_date: true, status: true, project_id: true },
        where: inArray(tasks.project_id, projectIds),
        with: { project: { columns: { id: true, name: true, color: true } } },
      });
      const open = rows.filter((t) => t.status !== 'done');
      openTasksCount = open.length;
      openTasks = open
        .sort((a, b) => (a.due_date ?? '9999-99-99').localeCompare(b.due_date ?? '9999-99-99'))
        .slice(0, OPEN_TASKS_CAP);
    }

    return {
      company,
      contacts,
      projects: companyProjects,
      conversations: companyConversations,
      open_tasks: openTasks,
      open_tasks_count: openTasksCount,
    };
  });

  app.post('/api/companies', async (req, reply) => {
    const parsed = CreateCompanySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_payload', details: parsed.error.flatten().fieldErrors });
    }
    const [row] = await getDb().insert(companies).values(parsed.data).returning();
    if (!row) throw app.httpErrors.internalServerError('insert_returned_no_row');
    return reply.code(201).send(row);
  });

  app.patch<{ Params: { id: string } }>('/api/companies/:id', async (req, reply) => {
    const parsed = UpdateCompanySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_payload', details: parsed.error.flatten().fieldErrors });
    }
    if (Object.keys(parsed.data).length === 0) {
      return reply.code(400).send({ error: 'empty_payload' });
    }
    const [row] = await getDb()
      .update(companies)
      .set({ ...parsed.data, updated_at: new Date().toISOString() })
      .where(eq(companies.id, req.params.id))
      .returning();
    if (!row) return reply.code(404).send({ error: 'not_found' });
    return row;
  });

  app.delete<{ Params: { id: string } }>('/api/companies/:id', async (req, reply) => {
    // people.company_id / projects.company_id / conversations.company_id
    // are all ON DELETE SET NULL — deleting an org never deletes its people
    // or history.
    await getDb().delete(companies).where(eq(companies.id, req.params.id));
    return reply.code(204).send();
  });
};
