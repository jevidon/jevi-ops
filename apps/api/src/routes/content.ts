import type { FastifyPluginAsync } from 'fastify';
import {
  CreateContentItemSchema, UpdateContentItemSchema,
  CreateContentChecklistItemSchema, UpdateContentChecklistItemSchema,
} from '@jerad-ops/shared/schemas';
import {
  defaultChecklistItemsFor,
  targetStatusForTitle,
  maxStatus,
} from '../lib/content-checklist-templates.js';
import type { ContentItemType, ContentItemStatus } from '@jerad-ops/shared';

// Content items CRUD — videos, articles, podcasts, etc. Joins domain on
// fetch so the UI can show the channel name + color without a second
// request. RLS handled by the request-scoped supabase client.

export const contentRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.requireAuth);

  app.get<{ Querystring: { status?: string; domain_id?: string; type?: string; limit?: string } }>(
    '/api/content',
    async (req) => {
      const limit = Math.min(parseInt(req.query.limit ?? '500', 10) || 500, 2000);
      let q = req.supabase!
        .from('content_items')
        .select('*, domain:stewardship_domains(id, name)')
        .order('updated_at', { ascending: false })
        .limit(limit);
      if (req.query.status) q = q.eq('status', req.query.status);
      if (req.query.domain_id) q = q.eq('domain_id', req.query.domain_id);
      if (req.query.type) q = q.eq('type', req.query.type);
      const { data, error } = await q;
      if (error) throw app.httpErrors.internalServerError(error.message);
      return { items: data ?? [] };
    },
  );

  app.get<{ Params: { id: string } }>('/api/content/:id', async (req, reply) => {
    const [itemRes, checklistRes] = await Promise.all([
      req.supabase!
        .from('content_items')
        .select('*, domain:stewardship_domains(id, name)')
        .eq('id', req.params.id)
        .maybeSingle(),
      req.supabase!
        .from('content_checklist_items')
        .select('*')
        .eq('content_item_id', req.params.id)
        .order('position', { ascending: true }),
    ]);
    if (itemRes.error) throw app.httpErrors.internalServerError(itemRes.error.message);
    if (!itemRes.data) return reply.code(404).send({ error: 'not_found' });
    if (checklistRes.error) throw app.httpErrors.internalServerError(checklistRes.error.message);
    return { ...itemRes.data, checklist: checklistRes.data ?? [] };
  });

  app.post('/api/content', async (req, reply) => {
    const parsed = CreateContentItemSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_payload', details: parsed.error.flatten().fieldErrors });
    }
    const { data, error } = await req.supabase!
      .from('content_items')
      .insert(parsed.data)
      .select('*')
      .single();
    if (error) throw app.httpErrors.internalServerError(error.message);

    // Seed the default checklist for this content type. Best-effort —
    // a failure here shouldn't fail the whole create. Logged for audit.
    const type = (data.type ?? parsed.data.type ?? 'video') as ContentItemType;
    const defaults = defaultChecklistItemsFor(type);
    if (defaults.length > 0) {
      const rows = defaults.map((title, idx) => ({
        content_item_id: data.id,
        position: idx,
        title,
      }));
      const { error: chkErr } = await req.supabase!.from('content_checklist_items').insert(rows);
      if (chkErr) req.log.warn({ err: chkErr.message, contentId: data.id }, 'default checklist insert failed');
    }

    return reply.code(201).send(data);
  });

  app.patch<{ Params: { id: string } }>('/api/content/:id', async (req, reply) => {
    const parsed = UpdateContentItemSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_payload', details: parsed.error.flatten().fieldErrors });
    }
    if (Object.keys(parsed.data).length === 0) {
      return reply.code(400).send({ error: 'empty_payload' });
    }
    const update: Record<string, unknown> = { ...parsed.data, updated_at: new Date().toISOString() };

    // Auto-stamp published_at when the status flips to a shipped state
    // and there's no timestamp yet. The domains pulse board's
    // days_since_publish rule reads MAX(content_items.published_at,
    // domain.last_shipped_at), so without this stamp the row never
    // counts and the domain stays "rule set · no data yet" forever.
    // If the client sends an explicit published_at in this patch we
    // leave it alone — they win over the auto-stamp.
    const SHIPPED_STATUSES = new Set(['published', 'derivatives_pending', 'done']);
    const incomingStatus = typeof parsed.data.status === 'string' ? parsed.data.status : null;
    const incomingPublishedAt =
      'published_at' in parsed.data ? parsed.data.published_at : undefined;
    if (incomingStatus && SHIPPED_STATUSES.has(incomingStatus) && incomingPublishedAt === undefined) {
      const { data: existing } = await req.supabase!
        .from('content_items')
        .select('published_at')
        .eq('id', req.params.id)
        .maybeSingle();
      if (!existing?.published_at) {
        update.published_at = new Date().toISOString();
      }
    }

    const { data, error } = await req.supabase!
      .from('content_items')
      .update(update)
      .eq('id', req.params.id)
      .select('*')
      .single();
    if (error) throw app.httpErrors.internalServerError(error.message);
    return data;
  });

  app.delete<{ Params: { id: string } }>('/api/content/:id', async (req, reply) => {
    // parent_id has ON DELETE SET NULL so derivative chains aren't cascaded.
    // checklist items cascade-delete via FK on content_checklist_items.
    const { error } = await req.supabase!.from('content_items').delete().eq('id', req.params.id);
    if (error) throw app.httpErrors.internalServerError(error.message);
    return reply.code(204).send();
  });

  // ─── Checklist items ────────────────────────────────────────────────

  app.post<{ Params: { id: string } }>(
    '/api/content/:id/checklist',
    async (req, reply) => {
      const parsed = CreateContentChecklistItemSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid_payload', details: parsed.error.flatten().fieldErrors });
      }
      // If no position given, append. Cheapest way: count existing.
      let position = parsed.data.position;
      if (position == null) {
        const { count } = await req.supabase!
          .from('content_checklist_items')
          .select('id', { count: 'exact', head: true })
          .eq('content_item_id', req.params.id);
        position = count ?? 0;
      }
      const { data, error } = await req.supabase!
        .from('content_checklist_items')
        .insert({
          content_item_id: req.params.id,
          title: parsed.data.title,
          position,
        })
        .select('*')
        .single();
      if (error) throw app.httpErrors.internalServerError(error.message);
      return reply.code(201).send(data);
    },
  );

  app.patch<{ Params: { id: string; itemId: string } }>(
    '/api/content/:id/checklist/:itemId',
    async (req, reply) => {
      const parsed = UpdateContentChecklistItemSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid_payload', details: parsed.error.flatten().fieldErrors });
      }
      const update: Record<string, unknown> = { ...parsed.data };
      // Stamp done_at when flipping true; clear it when flipping false.
      if (parsed.data.done === true) update.done_at = new Date().toISOString();
      if (parsed.data.done === false) update.done_at = null;
      const { data, error } = await req.supabase!
        .from('content_checklist_items')
        .update(update)
        .eq('id', req.params.itemId)
        .eq('content_item_id', req.params.id)
        .select('*')
        .single();
      if (error) throw app.httpErrors.internalServerError(error.message);

      // Auto-progress the parent content_item's status when a known
      // checklist title gets checked off. Forward-only: never regress on
      // an uncheck or out-of-order check. Failures here are non-fatal —
      // the checklist update already succeeded.
      if (parsed.data.done === true) {
        const target = targetStatusForTitle(data.title as string);
        if (target) {
          const itemRes = await req.supabase!
            .from('content_items')
            .select('status')
            .eq('id', req.params.id)
            .maybeSingle();
          if (!itemRes.error && itemRes.data) {
            const current = itemRes.data.status as ContentItemStatus;
            const next = maxStatus(current, target);
            if (next !== current) {
              const { error: progErr } = await req.supabase!
                .from('content_items')
                .update({ status: next, updated_at: new Date().toISOString() })
                .eq('id', req.params.id);
              if (progErr) {
                req.log.warn(
                  { err: progErr.message, contentId: req.params.id, target },
                  'status auto-progression failed',
                );
              }
            }
          }
        }
      }

      return data;
    },
  );

  app.delete<{ Params: { id: string; itemId: string } }>(
    '/api/content/:id/checklist/:itemId',
    async (req, reply) => {
      const { error } = await req.supabase!
        .from('content_checklist_items')
        .delete()
        .eq('id', req.params.itemId)
        .eq('content_item_id', req.params.id);
      if (error) throw app.httpErrors.internalServerError(error.message);
      return reply.code(204).send();
    },
  );

  // Seed defaults for an existing content_item that doesn't have any
  // checklist yet (e.g., items created before this feature shipped).
  // No-ops if the item already has any checklist rows.
  app.post<{ Params: { id: string } }>(
    '/api/content/:id/checklist/seed-defaults',
    async (req, reply) => {
      const itemRes = await req.supabase!
        .from('content_items')
        .select('id, type')
        .eq('id', req.params.id)
        .maybeSingle();
      if (itemRes.error) throw app.httpErrors.internalServerError(itemRes.error.message);
      if (!itemRes.data) return reply.code(404).send({ error: 'not_found' });
      const existing = await req.supabase!
        .from('content_checklist_items')
        .select('id', { count: 'exact', head: true })
        .eq('content_item_id', req.params.id);
      if ((existing.count ?? 0) > 0) {
        return reply.code(200).send({ inserted: 0, reason: 'already_has_items' });
      }
      const defaults = defaultChecklistItemsFor(itemRes.data.type as ContentItemType);
      const rows = defaults.map((title, idx) => ({
        content_item_id: req.params.id,
        position: idx,
        title,
      }));
      const { error } = await req.supabase!.from('content_checklist_items').insert(rows);
      if (error) throw app.httpErrors.internalServerError(error.message);
      return reply.code(201).send({ inserted: rows.length });
    },
  );
};
