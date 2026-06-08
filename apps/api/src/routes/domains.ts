import type { FastifyPluginAsync } from 'fastify';
import { UpdateDomainSchema } from '@jerad-ops/shared/schemas';

// Domain CRUD. Single-user system, so we surface every active domain on
// list. Editing happens via the /domains/[id] detail page on the web side.

export const domainRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.requireAuth);

  app.get('/api/domains', async (req) => {
    const { data, error } = await req.supabase!
      .from('stewardship_domains')
      .select('*')
      .eq('active', true)
      .order('name', { ascending: true });
    if (error) throw app.httpErrors.internalServerError(error.message);
    return { domains: data ?? [] };
  });

  app.get<{ Params: { id: string } }>('/api/domains/:id', async (req, reply) => {
    const { data, error } = await req.supabase!
      .from('stewardship_domains')
      .select('*')
      .eq('id', req.params.id)
      .maybeSingle();
    if (error) throw app.httpErrors.internalServerError(error.message);
    if (!data) return reply.code(404).send({ error: 'not_found' });
    return data;
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

    // System-domain protection (Addendum 03). Read is_system before the
    // update so we can reject identity-changing patches (name, active) on
    // Inbox and any future system domains. Description and failure_patterns
    // remain editable — those don't break the system contract.
    const { data: existing, error: readErr } = await req.supabase!
      .from('stewardship_domains')
      .select('is_system')
      .eq('id', req.params.id)
      .maybeSingle();
    if (readErr) throw app.httpErrors.internalServerError(readErr.message);
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

    const { data, error } = await req.supabase!
      .from('stewardship_domains')
      .update(parsed.data)
      .eq('id', req.params.id)
      .select('*')
      .single();
    if (error) throw app.httpErrors.internalServerError(error.message);
    return data;
  });

  // DELETE is not exposed today. If it ever ships, the is_system check
  // must reject system-domain deletes here as well.
};
