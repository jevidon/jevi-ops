import type { FastifyPluginAsync } from 'fastify';
import { asc, count, desc, eq, isNull, max } from 'drizzle-orm';
import {
  CreateShoppingListSchema, UpdateShoppingListSchema,
  CreateShoppingItemSchema, UpdateShoppingItemSchema,
  FlagShoppingItemSchema, PurchaseShoppingItemSchema, ImportShoppingSchema,
} from '@jevi-ops/shared/schemas';
import { isDueAgain, isRecurrencePattern } from '@jevi-ops/shared';
import { getDb } from '../lib/db.js';
import { shopping_items, shopping_lists, shopping_purchases } from '../db/schema.js';

// Shopping module (migration 0044). Lists are stores/sections; items
// cycle between stocked and needed. Semantics are INVERTED from tasks:
// `needed` checked means "buy this". Two ways an item stops being
// needed —
//   purchase: appends a ledger row + stamps last_purchased_at
//   dismiss:  no ledger row; on rule items it still bumps
//             last_purchased_at so a skip counts as satisfied this
//             cycle (otherwise auto_needed would re-flip instantly)
// Recurrence is derived at read time: an item with a rule reads as
// auto_needed once a full interval elapses since last purchase
// (isDueAgain) — no cron, no reset job.

type ItemRow = typeof shopping_items.$inferSelect;

function decorateItem(item: ItemRow) {
  const rule = item.recurrence_rule;
  const auto_needed =
    isRecurrencePattern(rule) && isDueAgain(item.last_purchased_at, rule);
  return { ...item, auto_needed, effective_needed: item.needed || auto_needed };
}

export const shoppingRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.requireAuth);

  // ─── Read ────────────────────────────────────────────────────────────

  app.get<{ Querystring: { include_archived?: string } }>(
    '/api/shopping',
    async (req) => {
      const includeArchived = req.query.include_archived === 'true';
      const rows = await getDb().query.shopping_lists.findMany({
        with: { items: { orderBy: [asc(shopping_items.position), asc(shopping_items.created_at)] } },
        where: includeArchived ? undefined : isNull(shopping_lists.archived_at),
        orderBy: [asc(shopping_lists.position), asc(shopping_lists.created_at)],
      });
      const lists = rows.map((l) => ({
        ...l,
        items: (l.items ?? [])
          .filter((i) => includeArchived || !i.archived_at)
          .map(decorateItem),
      }));
      return { lists };
    },
  );

  app.get<{ Params: { id: string } }>('/api/shopping/items/:id', async (req, reply) => {
    const db = getDb();
    const [item, purchases] = await Promise.all([
      db.query.shopping_items.findFirst({ where: eq(shopping_items.id, req.params.id) }),
      db.query.shopping_purchases.findMany({
        where: eq(shopping_purchases.item_id, req.params.id),
        orderBy: desc(shopping_purchases.purchased_at),
      }),
    ]);
    if (!item) return reply.code(404).send({ error: 'not_found' });
    return { item: decorateItem(item), purchases };
  });

  // ─── Lists ───────────────────────────────────────────────────────────

  app.post('/api/shopping/lists', async (req, reply) => {
    const parsed = CreateShoppingListSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_payload', details: parsed.error.flatten().fieldErrors });
    }
    const db = getDb();
    // Default position = end of the active set, so new lists append.
    let position = parsed.data.position;
    if (position == null) {
      const [row] = await db.select({ n: count() }).from(shopping_lists)
        .where(isNull(shopping_lists.archived_at));
      position = row?.n ?? 0;
    }
    const [row] = await db.insert(shopping_lists)
      .values({ name: parsed.data.name, position })
      .returning();
    if (!row) throw app.httpErrors.internalServerError('insert_returned_no_row');
    return reply.code(201).send(row);
  });

  app.patch<{ Params: { id: string } }>('/api/shopping/lists/:id', async (req, reply) => {
    const parsed = UpdateShoppingListSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_payload', details: parsed.error.flatten().fieldErrors });
    }
    if (Object.keys(parsed.data).length === 0) {
      return reply.code(400).send({ error: 'empty_payload' });
    }
    const [row] = await getDb().update(shopping_lists)
      .set(parsed.data)
      .where(eq(shopping_lists.id, req.params.id))
      .returning();
    if (!row) return reply.code(404).send({ error: 'not_found' });
    return row;
  });

  app.delete<{ Params: { id: string } }>('/api/shopping/lists/:id', async (req, reply) => {
    // Hard delete cascades to items and their ledgers. The UI nudges
    // toward archive (PATCH archived_at) to preserve purchase history.
    await getDb().delete(shopping_lists).where(eq(shopping_lists.id, req.params.id));
    return reply.code(204).send();
  });

  // ─── Items ───────────────────────────────────────────────────────────

  app.post('/api/shopping/items', async (req, reply) => {
    const parsed = CreateShoppingItemSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_payload', details: parsed.error.flatten().fieldErrors });
    }
    const db = getDb();
    const list = await db.query.shopping_lists.findFirst({
      columns: { id: true },
      where: eq(shopping_lists.id, parsed.data.list_id),
    });
    if (!list) return reply.code(404).send({ error: 'list_not_found' });

    let position = parsed.data.position;
    if (position == null) {
      const [row] = await db.select({ n: count() }).from(shopping_items)
        .where(eq(shopping_items.list_id, parsed.data.list_id));
      position = row?.n ?? 0;
    }
    const insert: typeof shopping_items.$inferInsert = {
      list_id: parsed.data.list_id,
      name: parsed.data.name,
      note: parsed.data.note ?? null,
      recurrence_rule: parsed.data.recurrence_rule ?? null,
      one_off: parsed.data.one_off ?? false,
      position,
    };
    // Add-and-flag in one call ("we're out, and it's not on the list yet").
    // One-time items always arrive needed — they only exist to be bought.
    if (parsed.data.needed || parsed.data.one_off) {
      insert.needed = true;
      insert.needed_at = new Date().toISOString();
    }
    const [row] = await db.insert(shopping_items).values(insert).returning();
    if (!row) throw app.httpErrors.internalServerError('insert_returned_no_row');
    return reply.code(201).send(decorateItem(row));
  });

  app.patch<{ Params: { id: string } }>('/api/shopping/items/:id', async (req, reply) => {
    const parsed = UpdateShoppingItemSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_payload', details: parsed.error.flatten().fieldErrors });
    }
    if (Object.keys(parsed.data).length === 0) {
      return reply.code(400).send({ error: 'empty_payload' });
    }
    const db = getDb();
    const update: Partial<typeof shopping_items.$inferInsert> = { ...parsed.data };
    // one_off and recurrence_rule are mutually exclusive (DB CHECK). For
    // partial updates, resolve against the stored row and let the field
    // the caller actually sent win.
    const existing = await db.query.shopping_items.findFirst({
      columns: { one_off: true, recurrence_rule: true },
      where: eq(shopping_items.id, req.params.id),
    });
    if (!existing) return reply.code(404).send({ error: 'not_found' });
    const finalOneOff = update.one_off ?? existing.one_off;
    const finalRule = 'recurrence_rule' in update ? update.recurrence_rule : existing.recurrence_rule;
    if (finalOneOff && finalRule) {
      if ('one_off' in update) update.recurrence_rule = null;
      else update.one_off = false;
    }
    const [row] = await db.update(shopping_items)
      .set(update)
      .where(eq(shopping_items.id, req.params.id))
      .returning();
    if (!row) return reply.code(404).send({ error: 'not_found' });
    return decorateItem(row);
  });

  app.delete<{ Params: { id: string } }>('/api/shopping/items/:id', async (req, reply) => {
    // Hard delete drops the item's ledger rows (cascade). The UI default
    // is archive; delete is behind a warning.
    await getDb().delete(shopping_items).where(eq(shopping_items.id, req.params.id));
    return reply.code(204).send();
  });

  // ─── Flag / purchase / undo ──────────────────────────────────────────

  app.post<{ Params: { id: string } }>('/api/shopping/items/:id/flag', async (req, reply) => {
    const parsed = FlagShoppingItemSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_payload', details: parsed.error.flatten().fieldErrors });
    }
    const db = getDb();
    const existing = await db.query.shopping_items.findFirst({
      columns: { recurrence_rule: true, one_off: true },
      where: eq(shopping_items.id, req.params.id),
    });
    if (!existing) return reply.code(404).send({ error: 'not_found' });

    const now = new Date().toISOString();
    const update: Partial<typeof shopping_items.$inferInsert> = parsed.data.needed
      ? { needed: true, needed_at: now, archived_at: null }
      : { needed: false, needed_at: null };
    // Dismiss-without-buying on a rule item bumps the recurrence anchor:
    // a skip counts as satisfied this cycle, otherwise auto_needed would
    // re-flip the item the moment it was dismissed.
    if (!parsed.data.needed && existing.recurrence_rule) {
      update.last_purchased_at = now;
    }
    // A dismissed one-time item has no stocked state to return to — it
    // leaves the list entirely (archived, not deleted, so it can be
    // recovered from the archive).
    if (!parsed.data.needed && existing.one_off) {
      update.archived_at = now;
    }
    const [row] = await db.update(shopping_items)
      .set(update)
      .where(eq(shopping_items.id, req.params.id))
      .returning();
    if (!row) return reply.code(404).send({ error: 'not_found' });
    return decorateItem(row);
  });

  app.post<{ Params: { id: string } }>('/api/shopping/items/:id/purchase', async (req, reply) => {
    const parsed = PurchaseShoppingItemSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_payload', details: parsed.error.flatten().fieldErrors });
    }
    const db = getDb();
    const existing = await db.query.shopping_items.findFirst({
      columns: { id: true, one_off: true },
      where: eq(shopping_items.id, req.params.id),
    });
    if (!existing) return reply.code(404).send({ error: 'not_found' });

    const purchasedAt = parsed.data.purchased_at ?? new Date().toISOString();
    const [purchase] = await db.insert(shopping_purchases)
      .values({
        item_id: req.params.id,
        purchased_at: purchasedAt,
        price_cents: parsed.data.price_cents ?? null,
        note: parsed.data.note ?? null,
      })
      .returning();
    if (!purchase) throw app.httpErrors.internalServerError('insert_returned_no_row');

    // One-time items leave the list once bought — archived (after the
    // ledger row above), never deleted, so purchase history survives.
    const [item] = await db.update(shopping_items)
      .set({
        needed: false,
        needed_at: null,
        last_purchased_at: purchasedAt,
        ...(existing.one_off ? { archived_at: purchasedAt } : {}),
      })
      .where(eq(shopping_items.id, req.params.id))
      .returning();
    if (!item) throw app.httpErrors.internalServerError('update_returned_no_row');
    return reply.code(201).send({ purchase, item: decorateItem(item) });
  });

  app.delete<{ Params: { id: string } }>('/api/shopping/purchases/:id', async (req, reply) => {
    // Undo a purchase: drop the ledger row, put the item back to needed,
    // and recompute the recurrence anchor from the remaining ledger.
    const db = getDb();
    const purchase = await db.query.shopping_purchases.findFirst({
      where: eq(shopping_purchases.id, req.params.id),
    });
    if (!purchase) return reply.code(404).send({ error: 'not_found' });

    await db.delete(shopping_purchases).where(eq(shopping_purchases.id, req.params.id));
    const [remaining] = await db
      .select({ latest: max(shopping_purchases.purchased_at) })
      .from(shopping_purchases)
      .where(eq(shopping_purchases.item_id, purchase.item_id));
    // archived_at: null also resurrects a one-off item whose purchase
    // archived it — undo restores it to the list, flagged again.
    const [item] = await db.update(shopping_items)
      .set({
        needed: true,
        needed_at: new Date().toISOString(),
        last_purchased_at: remaining?.latest ?? null,
        archived_at: null,
      })
      .where(eq(shopping_items.id, purchase.item_id))
      .returning();
    if (!item) return reply.code(404).send({ error: 'item_not_found' });
    return { item: decorateItem(item) };
  });

  // ─── Markdown import ─────────────────────────────────────────────────
  //
  // Accepts the wiki page this module replaces: markdown headings name
  // lists, `- [ ]` / `- [x]` rows are items, `[x]` imports as needed.
  // A heading only becomes a list when it has at least one item under
  // it, so a page title like "# Grocery Shopping" above the store
  // sections is skipped naturally. Matching is case-insensitive on both
  // list and item names, so re-pasting the same page is a no-op.

  app.post('/api/shopping/import', async (req, reply) => {
    const parsed = ImportShoppingSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_payload', details: parsed.error.flatten().fieldErrors });
    }
    const db = getDb();
    const existingLists = await db.query.shopping_lists.findMany({
      with: { items: { columns: { name: true } } },
    });
    const listByName = new Map(
      existingLists.map((l) => [
        l.name.trim().toLowerCase(),
        { id: l.id, itemNames: new Set(l.items.map((i) => i.name.trim().toLowerCase())), itemCount: l.items.length },
      ]),
    );
    let activeListCount = existingLists.filter((l) => !l.archived_at).length;

    let currentHeading: string | null = null;
    let currentList: { id: string; itemNames: Set<string>; itemCount: number } | null = null;
    const counts = { lists_created: 0, items_created: 0, items_skipped: 0 };

    for (const rawLine of parsed.data.text.split('\n')) {
      const line = rawLine.trim();
      const heading = line.match(/^#{1,6}\s+(.+)$/);
      if (heading?.[1]) {
        currentHeading = heading[1].trim();
        currentList = null;
        continue;
      }
      const itemMatch = line.match(/^[-*]\s*\[([ xX])\]\s+(.+)$/);
      if (!itemMatch?.[2] || !currentHeading) continue;
      const needed = itemMatch[1] !== ' ';
      const name = itemMatch[2].trim();
      if (!name) continue;

      // Materialize the heading's list lazily, on its first item.
      if (!currentList) {
        const key = currentHeading.toLowerCase();
        let entry = listByName.get(key);
        if (!entry) {
          const [row] = await db.insert(shopping_lists)
            .values({ name: currentHeading, position: activeListCount })
            .returning();
          if (!row) throw app.httpErrors.internalServerError('insert_returned_no_row');
          entry = { id: row.id, itemNames: new Set(), itemCount: 0 };
          listByName.set(key, entry);
          activeListCount += 1;
          counts.lists_created += 1;
        }
        currentList = entry;
      }

      if (currentList.itemNames.has(name.toLowerCase())) {
        counts.items_skipped += 1;
        continue;
      }
      const insert: typeof shopping_items.$inferInsert = {
        list_id: currentList.id,
        name,
        position: currentList.itemCount,
      };
      if (needed) {
        insert.needed = true;
        insert.needed_at = new Date().toISOString();
      }
      await db.insert(shopping_items).values(insert);
      currentList.itemNames.add(name.toLowerCase());
      currentList.itemCount += 1;
      counts.items_created += 1;
    }
    return reply.code(201).send(counts);
  });
};
