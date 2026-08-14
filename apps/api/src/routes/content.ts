import type { FastifyPluginAsync } from 'fastify';
import { and, asc, count, desc, eq, type SQL } from 'drizzle-orm';
import {
  CreateContentItemSchema, UpdateContentItemSchema,
  CreateContentChecklistItemSchema, UpdateContentChecklistItemSchema,
} from '@jevi-ops/shared/schemas';
import {
  defaultChecklistItemsFor,
  targetStatusForTitle,
  maxStatus,
} from '../lib/content-checklist-templates.js';
import type { ContentItemType, ContentItemStatus } from '@jevi-ops/shared';
import { getDb } from '../lib/db.js';
import { clearAttentionForSource } from '../lib/attention.js';
import { content_checklist_items, content_items } from '../db/schema.js';

// Content items CRUD — videos, articles, podcasts, etc. Joins domain on
// fetch so the UI can show the channel name + color without a second
// request.

export const contentRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.requireAuth);

  app.get<{ Querystring: { status?: string; domain_id?: string; type?: string; limit?: string } }>(
    '/api/content',
    async (req) => {
      const limit = Math.min(parseInt(req.query.limit ?? '500', 10) || 500, 2000);
      const conds: SQL[] = [];
      if (req.query.status) conds.push(eq(content_items.status, req.query.status));
      if (req.query.domain_id) conds.push(eq(content_items.domain_id, req.query.domain_id));
      if (req.query.type) conds.push(eq(content_items.type, req.query.type));
      const items = await getDb().query.content_items.findMany({
        with: { domain: { columns: { id: true, name: true } } },
        where: conds.length ? and(...conds) : undefined,
        orderBy: desc(content_items.updated_at),
        limit,
      });
      return { items };
    },
  );

  app.get<{ Params: { id: string } }>('/api/content/:id', async (req, reply) => {
    const db = getDb();
    const [item, checklist] = await Promise.all([
      db.query.content_items.findFirst({
        with: { domain: { columns: { id: true, name: true } } },
        where: eq(content_items.id, req.params.id),
      }),
      db.query.content_checklist_items.findMany({
        where: eq(content_checklist_items.content_item_id, req.params.id),
        orderBy: asc(content_checklist_items.position),
      }),
    ]);
    if (!item) return reply.code(404).send({ error: 'not_found' });
    return { ...item, checklist };
  });

  app.post('/api/content', async (req, reply) => {
    const parsed = CreateContentItemSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_payload', details: parsed.error.flatten().fieldErrors });
    }
    // Item + its default checklist land together or not at all.
    const row = await getDb().transaction(async (tx) => {
      const [item] = await tx.insert(content_items).values(parsed.data).returning();
      if (!item) throw new Error('insert_returned_no_row');
      const type = (item.type ?? parsed.data.type ?? 'video') as ContentItemType;
      const defaults = defaultChecklistItemsFor(type);
      if (defaults.length > 0) {
        await tx.insert(content_checklist_items).values(
          defaults.map((title, idx) => ({
            content_item_id: item.id,
            position: idx,
            title,
          })),
        );
      }
      return item;
    });
    return reply.code(201).send(row);
  });

  app.patch<{ Params: { id: string } }>('/api/content/:id', async (req, reply) => {
    const parsed = UpdateContentItemSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_payload', details: parsed.error.flatten().fieldErrors });
    }
    if (Object.keys(parsed.data).length === 0) {
      return reply.code(400).send({ error: 'empty_payload' });
    }
    const db = getDb();
    const update: Partial<typeof content_items.$inferInsert> = {
      ...parsed.data,
      updated_at: new Date().toISOString(),
    };

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
      const existing = await db.query.content_items.findFirst({
        columns: { published_at: true },
        where: eq(content_items.id, req.params.id),
      });
      if (!existing?.published_at) {
        update.published_at = new Date().toISOString();
      }
    }

    const [row] = await db
      .update(content_items)
      .set(update)
      .where(eq(content_items.id, req.params.id))
      .returning();
    if (!row) return reply.code(404).send({ error: 'not_found' });

    // Moving out of 'editing' clears the stuck-in-editing attention item
    // live. Best-effort.
    if (incomingStatus && incomingStatus !== 'editing') {
      try {
        await clearAttentionForSource(db, 'content', req.params.id, ['content_stuck_in_editing']);
      } catch { /* best-effort */ }
    }
    return row;
  });

  app.delete<{ Params: { id: string } }>('/api/content/:id', async (req, reply) => {
    // parent_id has ON DELETE SET NULL so derivative chains aren't cascaded.
    // checklist items cascade-delete via FK on content_checklist_items.
    await getDb().delete(content_items).where(eq(content_items.id, req.params.id));
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
      const db = getDb();
      // If no position given, append. Cheapest way: count existing.
      let position = parsed.data.position;
      if (position == null) {
        const [row] = await db
          .select({ n: count() })
          .from(content_checklist_items)
          .where(eq(content_checklist_items.content_item_id, req.params.id));
        position = row?.n ?? 0;
      }
      const [row] = await db
        .insert(content_checklist_items)
        .values({
          content_item_id: req.params.id,
          title: parsed.data.title,
          position,
        })
        .returning();
      if (!row) throw app.httpErrors.internalServerError('insert_returned_no_row');
      return reply.code(201).send(row);
    },
  );

  app.patch<{ Params: { id: string; itemId: string } }>(
    '/api/content/:id/checklist/:itemId',
    async (req, reply) => {
      const parsed = UpdateContentChecklistItemSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid_payload', details: parsed.error.flatten().fieldErrors });
      }
      const db = getDb();
      const update: Partial<typeof content_checklist_items.$inferInsert> = { ...parsed.data };
      // Stamp done_at when flipping true; clear it when flipping false.
      if (parsed.data.done === true) update.done_at = new Date().toISOString();
      if (parsed.data.done === false) update.done_at = null;
      const [row] = await db
        .update(content_checklist_items)
        .set(update)
        .where(and(
          eq(content_checklist_items.id, req.params.itemId),
          eq(content_checklist_items.content_item_id, req.params.id),
        ))
        .returning();
      if (!row) return reply.code(404).send({ error: 'not_found' });

      // Auto-progress the parent content_item's status when a known
      // checklist title gets checked off. Forward-only: never regress on
      // an uncheck or out-of-order check. Failures here are non-fatal —
      // the checklist update already succeeded.
      if (parsed.data.done === true) {
        const target = targetStatusForTitle(row.title);
        if (target) {
          try {
            const item = await db.query.content_items.findFirst({
              columns: { status: true },
              where: eq(content_items.id, req.params.id),
            });
            if (item) {
              const current = item.status as ContentItemStatus;
              const next = maxStatus(current, target);
              if (next !== current) {
                await db
                  .update(content_items)
                  .set({ status: next, updated_at: new Date().toISOString() })
                  .where(eq(content_items.id, req.params.id));
              }
            }
          } catch (err) {
            req.log.warn(
              { err: err instanceof Error ? err.message : String(err), contentId: req.params.id, target },
              'status auto-progression failed',
            );
          }
        }
      }

      return row;
    },
  );

  app.delete<{ Params: { id: string; itemId: string } }>(
    '/api/content/:id/checklist/:itemId',
    async (req, reply) => {
      await getDb()
        .delete(content_checklist_items)
        .where(and(
          eq(content_checklist_items.id, req.params.itemId),
          eq(content_checklist_items.content_item_id, req.params.id),
        ));
      return reply.code(204).send();
    },
  );

  // Seed defaults for an existing content_item that doesn't have any
  // checklist yet (e.g., items created before this feature shipped).
  // No-ops if the item already has any checklist rows.
  app.post<{ Params: { id: string } }>(
    '/api/content/:id/checklist/seed-defaults',
    async (req, reply) => {
      const db = getDb();
      const item = await db.query.content_items.findFirst({
        columns: { id: true, type: true },
        where: eq(content_items.id, req.params.id),
      });
      if (!item) return reply.code(404).send({ error: 'not_found' });
      const [existing] = await db
        .select({ n: count() })
        .from(content_checklist_items)
        .where(eq(content_checklist_items.content_item_id, req.params.id));
      if ((existing?.n ?? 0) > 0) {
        return reply.code(200).send({ inserted: 0, reason: 'already_has_items' });
      }
      const defaults = defaultChecklistItemsFor(item.type as ContentItemType);
      const rows = defaults.map((title, idx) => ({
        content_item_id: req.params.id,
        position: idx,
        title,
      }));
      await db.insert(content_checklist_items).values(rows);
      return reply.code(201).send({ inserted: rows.length });
    },
  );
};
