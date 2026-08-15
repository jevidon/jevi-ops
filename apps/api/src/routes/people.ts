import type { FastifyPluginAsync } from 'fastify';
import { and, asc, desc, eq, max, sql } from 'drizzle-orm';
import {
  CreatePersonSchema, UpdatePersonSchema,
  CreatePersonFactSchema, UpdatePersonFactSchema,
} from '@jevi-ops/shared/schemas';
import { getDb } from '../lib/db.js';
import { conversations, notes, people, person_facts, projects } from '../db/schema.js';

// People. Facts are nested under /api/people/:id so the FK stays in the
// URL path and the body only ever carries editable fields.
//
// CRM port (0041/0042): the interaction log is the unified conversations
// table now — person_interactions is a read-only archive with no routes.
// The list synthesises last_interaction_at (max conversations.occurred_at)
// for the v2 silence pill; detail returns the conversations timeline.

export const peopleRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.requireAuth);

  // ─── People ──────────────────────────────────────────────────────────

  app.get<{ Querystring: { relationship_type?: string; limit?: string } }>(
    '/api/people',
    async (req) => {
      const limit = Math.min(parseInt(req.query.limit ?? '500', 10) || 500, 2000);
      const db = getDb();
      // Eager-counts of conversations + facts for list density, plus the
      // joined company row. last_interaction_at is synthesised via one
      // grouped query (people has no such column).
      const [rows, lastByPerson] = await Promise.all([
        db.query.people.findMany({
          with: {
            conversations: { columns: { id: true } },
            facts: { columns: { id: true } },
            company_ref: { columns: { id: true, name: true, relationship_type: true } },
          },
          where: req.query.relationship_type
            ? eq(people.relationship_type, req.query.relationship_type)
            : undefined,
          orderBy: asc(people.name),
          limit,
        }),
        db.select({ person_id: conversations.person_id, last: max(conversations.occurred_at) })
          .from(conversations)
          .groupBy(conversations.person_id),
      ]);
      const lastMap = new Map(lastByPerson.map((r) => [r.person_id, r.last]));
      const peopleRows = rows.map((p) => ({
        ...p,
        interaction_count: p.conversations?.length ?? 0,
        fact_count: p.facts?.length ?? 0,
        last_interaction_at: lastMap.get(p.id) ?? null,
        conversations: undefined,
        facts: undefined,
      }));
      return { people: peopleRows };
    },
  );

  app.get<{ Params: { id: string } }>('/api/people/:id', async (req, reply) => {
    const id = req.params.id;
    const db = getDb();
    // Person (+company) + facts + conversations + related notes/projects.
    const [person, facts, personConversations, personNotes, clientProjects] = await Promise.all([
      db.query.people.findFirst({
        where: eq(people.id, id),
        with: { company_ref: { columns: { id: true, name: true, relationship_type: true } } },
      }),
      db.query.person_facts.findMany({
        where: eq(person_facts.person_id, id),
        orderBy: sql`${person_facts.date_relevant} asc nulls last`,
      }),
      db.query.conversations.findMany({
        where: eq(conversations.person_id, id),
        with: {
          company: { columns: { id: true, name: true } },
          project: { columns: { id: true, name: true, color: true } },
        },
        orderBy: desc(conversations.occurred_at),
        limit: 200,
      }),
      db.query.notes.findMany({
        columns: { id: true, title: true, body: true, source_type: true, created_at: true },
        where: eq(notes.related_person_id, id),
        orderBy: desc(notes.created_at),
        limit: 50,
      }),
      db.query.projects.findMany({
        columns: { id: true, name: true, status: true, color: true },
        where: eq(projects.primary_contact_id, id),
        orderBy: desc(projects.created_at),
      }),
    ]);
    if (!person) return reply.code(404).send({ error: 'not_found' });
    return {
      person,
      facts,
      conversations: personConversations,
      notes: personNotes,
      projects: clientProjects,
    };
  });

  app.post('/api/people', async (req, reply) => {
    const parsed = CreatePersonSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_payload', details: parsed.error.flatten().fieldErrors });
    }
    const [row] = await getDb().insert(people).values(parsed.data).returning();
    if (!row) throw app.httpErrors.internalServerError('insert_returned_no_row');
    return reply.code(201).send(row);
  });

  app.patch<{ Params: { id: string } }>('/api/people/:id', async (req, reply) => {
    const parsed = UpdatePersonSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_payload', details: parsed.error.flatten().fieldErrors });
    }
    if (Object.keys(parsed.data).length === 0) {
      return reply.code(400).send({ error: 'empty_payload' });
    }
    const [row] = await getDb()
      .update(people)
      .set({ ...parsed.data, updated_at: new Date().toISOString() })
      .where(eq(people.id, req.params.id))
      .returning();
    if (!row) return reply.code(404).send({ error: 'not_found' });
    return row;
  });

  app.delete<{ Params: { id: string } }>('/api/people/:id', async (req, reply) => {
    // facts + interactions cascade-delete via their FKs.
    // notes.related_person_id is ON DELETE SET NULL (preserves notes).
    // projects.client_id is also ON DELETE SET NULL.
    await getDb().delete(people).where(eq(people.id, req.params.id));
    return reply.code(204).send();
  });

  // ─── Facts ──────────────────────────────────────────────────────────

  app.post<{ Params: { id: string } }>('/api/people/:id/facts', async (req, reply) => {
    const parsed = CreatePersonFactSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_payload', details: parsed.error.flatten().fieldErrors });
    }
    const [row] = await getDb()
      .insert(person_facts)
      .values({ ...parsed.data, person_id: req.params.id })
      .returning();
    if (!row) throw app.httpErrors.internalServerError('insert_returned_no_row');
    return reply.code(201).send(row);
  });

  app.patch<{ Params: { id: string; factId: string } }>(
    '/api/people/:id/facts/:factId',
    async (req, reply) => {
      const parsed = UpdatePersonFactSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid_payload', details: parsed.error.flatten().fieldErrors });
      }
      const [row] = await getDb()
        .update(person_facts)
        .set(parsed.data)
        .where(and(eq(person_facts.id, req.params.factId), eq(person_facts.person_id, req.params.id)))
        .returning();
      if (!row) return reply.code(404).send({ error: 'not_found' });
      return row;
    },
  );

  app.delete<{ Params: { id: string; factId: string } }>(
    '/api/people/:id/facts/:factId',
    async (req, reply) => {
      await getDb()
        .delete(person_facts)
        .where(and(eq(person_facts.id, req.params.factId), eq(person_facts.person_id, req.params.id)));
      return reply.code(204).send();
    },
  );

};
