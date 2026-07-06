import type { FastifyPluginAsync } from 'fastify';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import {
  CreatePersonSchema, UpdatePersonSchema,
  CreatePersonFactSchema, UpdatePersonFactSchema,
  CreatePersonInteractionSchema, UpdatePersonInteractionSchema,
} from '@jevi-ops/shared/schemas';
import { getDb } from '../lib/db.js';
import { notes, people, person_facts, person_interactions, projects } from '../db/schema.js';

// People CRM. Three tables share the same auth scope:
//   people, person_facts, person_interactions.
// Facts + interactions are nested under /api/people/:id so the FK stays
// in the URL path and the body only ever carries editable fields.

export const peopleRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.requireAuth);

  // ─── People ──────────────────────────────────────────────────────────

  app.get<{ Querystring: { relationship_type?: string; limit?: string } }>(
    '/api/people',
    async (req) => {
      const limit = Math.min(parseInt(req.query.limit ?? '500', 10) || 500, 2000);
      // Eager-counts of interactions + facts so the list view can show
      // density at a glance without an N+1. Same trick we use on books
      // for quote_count.
      const rows = await getDb().query.people.findMany({
        with: {
          interactions: { columns: { id: true } },
          facts: { columns: { id: true } },
        },
        where: req.query.relationship_type
          ? eq(people.relationship_type, req.query.relationship_type)
          : undefined,
        orderBy: asc(people.name),
        limit,
      });
      const peopleRows = rows.map((p) => ({
        ...p,
        interaction_count: p.interactions?.length ?? 0,
        fact_count: p.facts?.length ?? 0,
        interactions: undefined,
        facts: undefined,
      }));
      return { people: peopleRows };
    },
  );

  app.get<{ Params: { id: string } }>('/api/people/:id', async (req, reply) => {
    const id = req.params.id;
    const db = getDb();
    // Person + facts + interactions + related notes/projects.
    // Projects link via projects.client_id (only meaningful for clients
    // but the relation is uniform across all relationship_types).
    const [person, facts, interactions, personNotes, clientProjects] = await Promise.all([
      db.query.people.findFirst({ where: eq(people.id, id) }),
      db.query.person_facts.findMany({
        where: eq(person_facts.person_id, id),
        orderBy: sql`${person_facts.date_relevant} asc nulls last`,
      }),
      db.query.person_interactions.findMany({
        where: eq(person_interactions.person_id, id),
        orderBy: desc(person_interactions.occurred_at),
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
        where: eq(projects.client_id, id),
        orderBy: desc(projects.created_at),
      }),
    ]);
    if (!person) return reply.code(404).send({ error: 'not_found' });
    return {
      person,
      facts,
      interactions,
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

  // ─── Interactions ───────────────────────────────────────────────────

  app.post<{ Params: { id: string } }>(
    '/api/people/:id/interactions',
    async (req, reply) => {
      const parsed = CreatePersonInteractionSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid_payload', details: parsed.error.flatten().fieldErrors });
      }
      const insert: typeof person_interactions.$inferInsert = {
        person_id: req.params.id,
        interaction_type: parsed.data.interaction_type,
        notes: parsed.data.notes,
      };
      if (parsed.data.occurred_at) insert.occurred_at = parsed.data.occurred_at;
      const [row] = await getDb().insert(person_interactions).values(insert).returning();
      if (!row) throw app.httpErrors.internalServerError('insert_returned_no_row');
      return reply.code(201).send(row);
    },
  );

  app.patch<{ Params: { id: string; interactionId: string } }>(
    '/api/people/:id/interactions/:interactionId',
    async (req, reply) => {
      const parsed = UpdatePersonInteractionSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid_payload', details: parsed.error.flatten().fieldErrors });
      }
      // occurred_at is NOT NULL with a default — a null in the patch means
      // "leave it alone", so strip it rather than writing null.
      const { occurred_at, ...restPatch } = parsed.data;
      const update: Partial<typeof person_interactions.$inferInsert> = { ...restPatch };
      if (typeof occurred_at === 'string') update.occurred_at = occurred_at;
      const [row] = await getDb()
        .update(person_interactions)
        .set(update)
        .where(and(
          eq(person_interactions.id, req.params.interactionId),
          eq(person_interactions.person_id, req.params.id),
        ))
        .returning();
      if (!row) return reply.code(404).send({ error: 'not_found' });
      return row;
    },
  );

  app.delete<{ Params: { id: string; interactionId: string } }>(
    '/api/people/:id/interactions/:interactionId',
    async (req, reply) => {
      await getDb()
        .delete(person_interactions)
        .where(and(
          eq(person_interactions.id, req.params.interactionId),
          eq(person_interactions.person_id, req.params.id),
        ));
      return reply.code(204).send();
    },
  );
};
