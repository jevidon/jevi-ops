import type { FastifyPluginAsync } from 'fastify';
import { asc, eq } from 'drizzle-orm';
import { UpdateDomainSchema } from '@jevi-ops/shared/schemas';
import { getDb } from '../lib/db.js';
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
    return row;
  });

  // Regenerate the domain's board illustration. The LLM composes under
  // the locked engraved-style contract and the result is sanitized before
  // it touches the row; if the model is unconfigured/unreachable or its
  // output fails validation, the procedural motif stands in. Either way
  // this endpoint always writes a fresh illustration — the client can
  // read `illustration.source` off the returned row to tell which.
  // Deliberately NOT part of PATCH: clients never supply raw SVG.
  app.post<{ Params: { id: string } }>('/api/domains/:id/illustration', async (req, reply) => {
    const db = getDb();
    const existing = await db.query.stewardship_domains.findFirst({
      columns: { id: true, name: true, description: true, is_system: true },
      where: eq(stewardship_domains.id, req.params.id),
    });
    if (!existing) return reply.code(404).send({ error: 'not_found' });
    if (existing.is_system === true) {
      return reply.code(400).send({ error: 'system_domain_protected' });
    }

    const { svg, source } = await composeDomainIllustration({
      name: existing.name,
      description: existing.description ?? null,
    });
    const illustration: DomainIllustration = {
      svg,
      style: 'engraved',
      source,
      generated_at: new Date().toISOString(),
    };

    const [row] = await db
      .update(stewardship_domains)
      .set({ illustration })
      .where(eq(stewardship_domains.id, req.params.id))
      .returning();
    if (!row) return reply.code(404).send({ error: 'not_found' });
    return row;
  });

  // DELETE is not exposed today. If it ever ships, the is_system check
  // must reject system-domain deletes here as well.
};
