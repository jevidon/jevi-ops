import type { FastifyPluginAsync } from 'fastify';
import {
  CreatePersonSchema, UpdatePersonSchema,
  CreatePersonFactSchema, UpdatePersonFactSchema,
  CreatePersonInteractionSchema, UpdatePersonInteractionSchema,
} from '@jerad-ops/shared/schemas';

// People CRM. Three tables share the same auth scope:
//   people, person_facts, person_interactions.
// Facts + interactions are nested under /api/people/:id so the FK stays
// in the URL path and the body only ever carries editable fields.
//
// RLS handled by the request-scoped supabase client (single-user system,
// authenticated-only policy).

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
      let q = req.supabase!
        .from('people')
        .select('*, interactions:person_interactions(id), facts:person_facts(id)')
        .order('name', { ascending: true })
        .limit(limit);
      if (req.query.relationship_type) {
        q = q.eq('relationship_type', req.query.relationship_type);
      }
      const { data, error } = await q;
      if (error) throw app.httpErrors.internalServerError(error.message);
      type Row = {
        interactions?: { id: string }[];
        facts?: { id: string }[];
        [k: string]: unknown;
      };
      const people = ((data ?? []) as Row[]).map((p) => ({
        ...p,
        interaction_count: p.interactions?.length ?? 0,
        fact_count: p.facts?.length ?? 0,
        interactions: undefined,
        facts: undefined,
      }));
      return { people };
    },
  );

  app.get<{ Params: { id: string } }>('/api/people/:id', async (req, reply) => {
    const id = req.params.id;
    const sb = req.supabase!;
    // Person + facts + interactions + related notes/projects.
    // Projects link via projects.client_id (only meaningful for clients
    // but the relation is uniform across all relationship_types).
    const [personRes, factsRes, interactionsRes, notesRes, projectsRes] = await Promise.all([
      sb.from('people').select('*').eq('id', id).maybeSingle(),
      sb.from('person_facts').select('*').eq('person_id', id).order('date_relevant', { ascending: true, nullsFirst: false }),
      sb.from('person_interactions').select('*').eq('person_id', id).order('occurred_at', { ascending: false }).limit(200),
      sb.from('notes').select('id, title, body, source_type, created_at').eq('related_person_id', id).order('created_at', { ascending: false }).limit(50),
      sb.from('projects').select('id, name, status, color').eq('client_id', id).order('created_at', { ascending: false }),
    ]);
    if (personRes.error) throw app.httpErrors.internalServerError(personRes.error.message);
    if (!personRes.data) return reply.code(404).send({ error: 'not_found' });
    if (factsRes.error) throw app.httpErrors.internalServerError(factsRes.error.message);
    if (interactionsRes.error) throw app.httpErrors.internalServerError(interactionsRes.error.message);
    if (notesRes.error) throw app.httpErrors.internalServerError(notesRes.error.message);
    if (projectsRes.error) throw app.httpErrors.internalServerError(projectsRes.error.message);
    return {
      person: personRes.data,
      facts: factsRes.data ?? [],
      interactions: interactionsRes.data ?? [],
      notes: notesRes.data ?? [],
      projects: projectsRes.data ?? [],
    };
  });

  app.post('/api/people', async (req, reply) => {
    const parsed = CreatePersonSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_payload', details: parsed.error.flatten().fieldErrors });
    }
    const { data, error } = await req.supabase!.from('people').insert(parsed.data).select('*').single();
    if (error) throw app.httpErrors.internalServerError(error.message);
    return reply.code(201).send(data);
  });

  app.patch<{ Params: { id: string } }>('/api/people/:id', async (req, reply) => {
    const parsed = UpdatePersonSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_payload', details: parsed.error.flatten().fieldErrors });
    }
    if (Object.keys(parsed.data).length === 0) {
      return reply.code(400).send({ error: 'empty_payload' });
    }
    const { data, error } = await req.supabase!
      .from('people')
      .update({ ...parsed.data, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .select('*')
      .single();
    if (error) throw app.httpErrors.internalServerError(error.message);
    return data;
  });

  app.delete<{ Params: { id: string } }>('/api/people/:id', async (req, reply) => {
    // facts + interactions cascade-delete via their FKs.
    // notes.related_person_id is ON DELETE SET NULL (preserves notes).
    // projects.client_id is also ON DELETE SET NULL.
    const { error } = await req.supabase!.from('people').delete().eq('id', req.params.id);
    if (error) throw app.httpErrors.internalServerError(error.message);
    return reply.code(204).send();
  });

  // ─── Facts ──────────────────────────────────────────────────────────

  app.post<{ Params: { id: string } }>('/api/people/:id/facts', async (req, reply) => {
    const parsed = CreatePersonFactSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_payload', details: parsed.error.flatten().fieldErrors });
    }
    const { data, error } = await req.supabase!
      .from('person_facts')
      .insert({ ...parsed.data, person_id: req.params.id })
      .select('*')
      .single();
    if (error) throw app.httpErrors.internalServerError(error.message);
    return reply.code(201).send(data);
  });

  app.patch<{ Params: { id: string; factId: string } }>(
    '/api/people/:id/facts/:factId',
    async (req, reply) => {
      const parsed = UpdatePersonFactSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid_payload', details: parsed.error.flatten().fieldErrors });
      }
      const { data, error } = await req.supabase!
        .from('person_facts')
        .update(parsed.data)
        .eq('id', req.params.factId)
        .eq('person_id', req.params.id)
        .select('*')
        .single();
      if (error) throw app.httpErrors.internalServerError(error.message);
      return data;
    },
  );

  app.delete<{ Params: { id: string; factId: string } }>(
    '/api/people/:id/facts/:factId',
    async (req, reply) => {
      const { error } = await req.supabase!
        .from('person_facts')
        .delete()
        .eq('id', req.params.factId)
        .eq('person_id', req.params.id);
      if (error) throw app.httpErrors.internalServerError(error.message);
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
      const insert: Record<string, unknown> = {
        person_id: req.params.id,
        interaction_type: parsed.data.interaction_type,
        notes: parsed.data.notes,
      };
      if (parsed.data.occurred_at) insert.occurred_at = parsed.data.occurred_at;
      const { data, error } = await req.supabase!
        .from('person_interactions')
        .insert(insert)
        .select('*')
        .single();
      if (error) throw app.httpErrors.internalServerError(error.message);
      return reply.code(201).send(data);
    },
  );

  app.patch<{ Params: { id: string; interactionId: string } }>(
    '/api/people/:id/interactions/:interactionId',
    async (req, reply) => {
      const parsed = UpdatePersonInteractionSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid_payload', details: parsed.error.flatten().fieldErrors });
      }
      const { data, error } = await req.supabase!
        .from('person_interactions')
        .update(parsed.data)
        .eq('id', req.params.interactionId)
        .eq('person_id', req.params.id)
        .select('*')
        .single();
      if (error) throw app.httpErrors.internalServerError(error.message);
      return data;
    },
  );

  app.delete<{ Params: { id: string; interactionId: string } }>(
    '/api/people/:id/interactions/:interactionId',
    async (req, reply) => {
      const { error } = await req.supabase!
        .from('person_interactions')
        .delete()
        .eq('id', req.params.interactionId)
        .eq('person_id', req.params.id);
      if (error) throw app.httpErrors.internalServerError(error.message);
      return reply.code(204).send();
    },
  );
};
