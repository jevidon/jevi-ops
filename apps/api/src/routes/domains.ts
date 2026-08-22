import type { FastifyPluginAsync } from 'fastify';
import { asc, eq } from 'drizzle-orm';
import { CreateDomainSchema, UpdateDomainSchema } from '@jevi-ops/shared/schemas';
import { getDb } from '../lib/db.js';
import { clearAttentionForSource } from '../lib/attention.js';
import { composeDomainIllustration } from '../lib/illustration.js';
import { stewardship_domains, type DomainIllustration } from '../db/schema.js';

// Domain CRUD. Single-user system, so we surface every active domain on
// list. Editing happens via the /domains/[id] detail page on the web side.

export const domainRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.requireAuth);

  app.get('/api/domains', async () => {
    const rows = await getDb().query.stewardship_domains.findMany({
      where: eq(stewardship_domains.active, true),
      orderBy: asc(stewardship_domains.name),
    });
    return { domains: rows };
  });

  app.get<{ Params: { id: string } }>('/api/domains/:id', async (req, reply) => {
    const row = await getDb().query.stewardship_domains.findFirst({
      where: eq(stewardship_domains.id, req.params.id),
    });
    if (!row) return reply.code(404).send({ error: 'not_found' });
    return row;
  });

  // POST /api/domains — create a domain (Capture Portal). Minimal payload;
  // column defaults supply failure_patterns/active/is_system/parked, and the
  // engraved illustration is generated later from the detail page — a new
  // domain renders with the board's fallback art until then.
  app.post('/api/domains', async (req, reply) => {
    const parsed = CreateDomainSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'invalid_payload',
        details: parsed.error.flatten().fieldErrors,
      });
    }
    const [row] = await getDb()
      .insert(stewardship_domains)
      .values({
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        expected_cadence: parsed.data.expected_cadence ?? null,
      })
      .returning();
    if (!row) throw app.httpErrors.internalServerError('insert_returned_no_row');
    return reply.code(201).send(row);
  });

  app.patch<{ Params: { id: string } }>('/api/domains/:id', async (req, reply) => {
    const parsed = UpdateDomainSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'invalid_payload',
        details: parsed.error.flatten().fieldErrors,
      });
    }
    if (Object.keys(parsed.data).length === 0) {
      return reply.code(400).send({ error: 'empty_payload' });
    }

    const db = getDb();

    // System-domain protection (Addendum 03). Read is_system before the
    // update so we can reject identity-changing patches (name, active) on
    // Inbox and any future system domains. Description and failure_patterns
    // remain editable — those don't break the system contract.
    const existing = await db.query.stewardship_domains.findFirst({
      columns: { is_system: true },
      where: eq(stewardship_domains.id, req.params.id),
    });
    if (!existing) return reply.code(404).send({ error: 'not_found' });
    if (existing.is_system === true) {
      const forbidden = ['name', 'active', 'is_system'] as const;
      for (const key of forbidden) {
        if (key in parsed.data) {
          return reply.code(400).send({
            error: 'system_domain_protected',
            details: { field: key, message: `Cannot change ${key} on a system domain.` },
          });
        }
      }
    }

    const [row] = await db
      .update(stewardship_domains)
      .set(parsed.data)
      .where(eq(stewardship_domains.id, req.params.id))
      .returning();
    if (!row) return reply.code(404).send({ error: 'not_found' });

    // Marking a domain shipped (setting last_shipped_at) clears its
    // "nothing shipped recently" attention item live. Best-effort.
    if ('last_shipped_at' in parsed.data && parsed.data.last_shipped_at) {
      try {
        await clearAttentionForSource(db, 'domain', req.params.id, ['domain_stale']);
      } catch { /* best-effort */ }
    }
    return row;
  });

  // ─── Illustration candidate workflow ────────────────────────────────
  //
  // Redrawing never overwrites the saved art. A render lands in
  // illustration_draft (the Candidate); commit copies it to illustration
  // and clears the draft; discard just clears it. All three endpoints
  // are the only writers of either column — they're deliberately NOT
  // part of PATCH, so clients never supply raw SVG (the composer's
  // sanitizer stays the single gate).

  // Shared guard: the domain must exist and not be a system domain.
  async function illustrationTarget(id: string, reply: { code: (n: number) => { send: (b: unknown) => unknown } }) {
    const existing = await getDb().query.stewardship_domains.findFirst({
      columns: { id: true, name: true, description: true, is_system: true, illustration_draft: true },
      where: eq(stewardship_domains.id, id),
    });
    if (!existing) {
      reply.code(404).send({ error: 'not_found' });
      return null;
    }
    if (existing.is_system === true) {
      reply.code(400).send({ error: 'system_domain_protected' });
      return null;
    }
    return existing;
  }

  // Draw a fresh candidate (overwrites any previous candidate; the saved
  // illustration is untouched). LLM compose → sanitize, procedural
  // fallback when the model can't deliver — always yields a drawing.
  app.post<{ Params: { id: string } }>('/api/domains/:id/illustration/draft', async (req, reply) => {
    const target = await illustrationTarget(req.params.id, reply);
    if (!target) return;

    const { svg, source } = await composeDomainIllustration({
      name: target.name,
      description: target.description ?? null,
    });
    const illustration_draft: DomainIllustration = {
      svg,
      style: 'engraved',
      source,
      generated_at: new Date().toISOString(),
    };

    const [row] = await getDb()
      .update(stewardship_domains)
      .set({ illustration_draft })
      .where(eq(stewardship_domains.id, req.params.id))
      .returning();
    if (!row) return reply.code(404).send({ error: 'not_found' });
    return row;
  });

  // Keep the candidate: draft becomes the saved illustration.
  app.post<{ Params: { id: string } }>('/api/domains/:id/illustration/commit', async (req, reply) => {
    const target = await illustrationTarget(req.params.id, reply);
    if (!target) return;
    if (!target.illustration_draft) return reply.code(400).send({ error: 'no_draft' });

    const [row] = await getDb()
      .update(stewardship_domains)
      .set({ illustration: target.illustration_draft, illustration_draft: null })
      .where(eq(stewardship_domains.id, req.params.id))
      .returning();
    if (!row) return reply.code(404).send({ error: 'not_found' });
    return row;
  });

  // Discard the candidate: saved illustration stays as it was.
  app.delete<{ Params: { id: string } }>('/api/domains/:id/illustration/draft', async (req, reply) => {
    const target = await illustrationTarget(req.params.id, reply);
    if (!target) return;

    const [row] = await getDb()
      .update(stewardship_domains)
      .set({ illustration_draft: null })
      .where(eq(stewardship_domains.id, req.params.id))
      .returning();
    if (!row) return reply.code(404).send({ error: 'not_found' });
    return row;
  });

  // DELETE is not exposed today. If it ever ships, the is_system check
  // must reject system-domain deletes here as well.
};
