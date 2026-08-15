import type { FastifyPluginAsync } from 'fastify';
import { and, asc, desc, eq, gt, lt, ne, or, sql, type SQL } from 'drizzle-orm';
import { arrayContains } from 'drizzle-orm';
import {
  CreateNoteSchema, UpdateNoteSchema,
  CreateQuoteAnnotationSchema, UpdateQuoteAnnotationSchema,
  CreateBookSchema, UpdateBookSchema,
  CreateQuoteSchema, UpdateQuoteSchema,
} from '@jevi-ops/shared/schemas';
import { getDb } from '../lib/db.js';
import {
  books,
  journal_entries,
  notes,
  quote_annotations,
  quotes,
  type StoredAttachment,
} from '../db/schema.js';

// Library CRUD — notes, quotes, quote_annotations, journal_entries, books.
// Auth-gated.

// Stable 32-bit hash of a short string. Used to seed the daily
// resurfacing pick from a date — same date in always yields the same
// item, different dates rotate.
//
// djb2 alone is too weak here: for "YYYY-MM-DD" strings on consecutive
// days, the hashes differ by only ~1 (last byte changes by 1), and the
// subsequent `% 1_000_000` step collapses those tiny differences back
// onto the same normalized pickAt. Result: the same item ran for weeks
// instead of rotating. Appending a murmur3 finalizer mixes the small
// input deltas into the full 32-bit width, restoring real rotation.
function simpleHash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  // Murmur3 finalizer — avalanche so a 1-byte input diff scrambles the
  // whole hash. Math.imul handles 32-bit overflow correctly.
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h = h ^ (h >>> 16);
  return Math.abs(h);
}

export const libraryRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.requireAuth);

  // ─── Notes ────────────────────────────────────────────────────────────

  app.get<{ Querystring: { source_type?: string; needs_review?: string; tag?: string; limit?: string; resurface?: string } }>(
    '/api/notes',
    async (req) => {
      const limit = Math.min(parseInt(req.query.limit ?? '500', 10) || 500, 2000);
      const conds: SQL[] = [];
      if (req.query.source_type) conds.push(eq(notes.source_type, req.query.source_type));
      if (req.query.needs_review === 'true') conds.push(eq(notes.needs_review, true));
      // tags is a text[] column — arrayContains generates the @> operator
      // which matches rows whose array includes every element we pass.
      if (req.query.tag) conds.push(arrayContains(notes.tags, [req.query.tag]));
      // ?resurface=boosted → weight > 1, excluded → weight = 0. The default
      // (no filter) shows everything regardless of weight so the list
      // doesn't mysteriously hide rows.
      if (req.query.resurface === 'boosted') conds.push(gt(notes.resurface_weight, 1));
      else if (req.query.resurface === 'excluded') conds.push(eq(notes.resurface_weight, 0));
      const rows = await getDb().query.notes.findMany({
        with: {
          project: { columns: { id: true, name: true, color: true } },
          person: { columns: { id: true, name: true } },
          quote: { columns: { id: true, text: true } },
        },
        where: conds.length ? and(...conds) : undefined,
        orderBy: desc(notes.created_at),
        limit,
      });
      return { notes: rows };
    },
  );

  app.get<{ Params: { id: string } }>('/api/notes/:id', async (req, reply) => {
    const row = await getDb().query.notes.findFirst({
      with: {
        project: { columns: { id: true, name: true, color: true } },
        person: { columns: { id: true, name: true } },
        quote: { columns: { id: true, text: true, source_author: true } },
      },
      where: eq(notes.id, req.params.id),
    });
    if (!row) return reply.code(404).send({ error: 'not_found' });
    return row;
  });

  app.post('/api/notes', async (req, reply) => {
    const parsed = CreateNoteSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_payload', details: parsed.error.flatten().fieldErrors });
    }
    const insert = { ...parsed.data, attachments: parsed.data.attachments as StoredAttachment[] | undefined };
    const [row] = await getDb().insert(notes).values(insert).returning();
    if (!row) throw app.httpErrors.internalServerError('insert_returned_no_row');
    return reply.code(201).send(row);
  });

  app.patch<{ Params: { id: string } }>('/api/notes/:id', async (req, reply) => {
    const parsed = UpdateNoteSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_payload', details: parsed.error.flatten().fieldErrors });
    }
    const update = { ...parsed.data, attachments: parsed.data.attachments as StoredAttachment[] | undefined };
    const [row] = await getDb()
      .update(notes)
      .set(update)
      .where(eq(notes.id, req.params.id))
      .returning();
    if (!row) return reply.code(404).send({ error: 'not_found' });
    return row;
  });

  app.delete<{ Params: { id: string } }>('/api/notes/:id', async (req, reply) => {
    await getDb().delete(notes).where(eq(notes.id, req.params.id));
    return reply.code(204).send();
  });

  // ─── Quotes ────────────────────────────────────────────────────────────

  app.get<{ Querystring: { tag?: string; limit?: string; resurface?: string } }>('/api/quotes', async (req) => {
    const limit = Math.min(parseInt(req.query.limit ?? '500', 10) || 500, 2000);
    const conds: SQL[] = [];
    if (req.query.tag) conds.push(arrayContains(quotes.tags, [req.query.tag]));
    if (req.query.resurface === 'boosted') conds.push(gt(quotes.resurface_weight, 1));
    else if (req.query.resurface === 'excluded') conds.push(eq(quotes.resurface_weight, 0));
    const rows = await getDb().query.quotes.findMany({
      with: {
        book: { columns: { id: true, title: true, author: true } },
        annotations: { columns: { id: true } },
      },
      where: conds.length ? and(...conds) : undefined,
      orderBy: desc(quotes.created_at),
      limit,
    });
    // Compress annotation rows down to a count for the list view.
    const quoteRows = rows.map((q) => ({
      ...q,
      annotation_count: q.annotations?.length ?? 0,
      annotations: undefined,
    }));
    return { quotes: quoteRows };
  });

  app.get<{ Params: { id: string } }>('/api/quotes/:id', async (req, reply) => {
    const db = getDb();
    const [quote, annotations] = await Promise.all([
      db.query.quotes.findFirst({
        with: { book: { columns: { id: true, title: true, author: true } } },
        where: eq(quotes.id, req.params.id),
      }),
      db.query.quote_annotations.findMany({
        where: eq(quote_annotations.quote_id, req.params.id),
        orderBy: asc(quote_annotations.annotated_at),
      }),
    ]);
    if (!quote) return reply.code(404).send({ error: 'not_found' });
    return { quote, annotations };
  });

  app.post('/api/quotes', async (req, reply) => {
    const parsed = CreateQuoteSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_payload', details: parsed.error.flatten().fieldErrors });
    }
    const [row] = await getDb().insert(quotes).values(parsed.data).returning();
    if (!row) throw app.httpErrors.internalServerError('insert_returned_no_row');
    return reply.code(201).send(row);
  });

  app.patch<{ Params: { id: string } }>('/api/quotes/:id', async (req, reply) => {
    const parsed = UpdateQuoteSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_payload', details: parsed.error.flatten().fieldErrors });
    }
    if (Object.keys(parsed.data).length === 0) {
      return reply.code(400).send({ error: 'empty_payload' });
    }
    const [row] = await getDb()
      .update(quotes)
      .set(parsed.data)
      .where(eq(quotes.id, req.params.id))
      .returning();
    if (!row) return reply.code(404).send({ error: 'not_found' });
    return row;
  });

  app.delete<{ Params: { id: string } }>('/api/quotes/:id', async (req, reply) => {
    // CASCADE on quote_annotations.quote_id cleans up annotations automatically.
    await getDb().delete(quotes).where(eq(quotes.id, req.params.id));
    return reply.code(204).send();
  });

  // ─── Quote annotations ───────────────────────────────────────────────

  app.post('/api/quote-annotations', async (req, reply) => {
    const parsed = CreateQuoteAnnotationSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_payload', details: parsed.error.flatten().fieldErrors });
    }
    const [row] = await getDb().insert(quote_annotations).values(parsed.data).returning();
    if (!row) throw app.httpErrors.internalServerError('insert_returned_no_row');
    return reply.code(201).send(row);
  });

  app.patch<{ Params: { id: string } }>('/api/quote-annotations/:id', async (req, reply) => {
    const parsed = UpdateQuoteAnnotationSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_payload', details: parsed.error.flatten().fieldErrors });
    }
    const [row] = await getDb()
      .update(quote_annotations)
      .set(parsed.data)
      .where(eq(quote_annotations.id, req.params.id))
      .returning();
    if (!row) return reply.code(404).send({ error: 'not_found' });
    return row;
  });

  app.delete<{ Params: { id: string } }>('/api/quote-annotations/:id', async (req, reply) => {
    await getDb().delete(quote_annotations).where(eq(quote_annotations.id, req.params.id));
    return reply.code(204).send();
  });

  // ─── Journal entries ────────────────────────────────────────────────
  //
  // Create still happens via voice. Manual edit + delete + attachments
  // shipped alongside image attachments (migration 0019) so journal
  // entries can be revisited after the fact (e.g., to add photos taken
  // during the moment that was journaled about).

  app.get<{ Querystring: { limit?: string; resurface?: string } }>('/api/journal-entries', async (req) => {
    const limit = Math.min(parseInt(req.query.limit ?? '500', 10) || 500, 2000);
    const conds: SQL[] = [];
    if (req.query.resurface === 'boosted') conds.push(gt(journal_entries.resurface_weight, 1));
    else if (req.query.resurface === 'excluded') conds.push(eq(journal_entries.resurface_weight, 0));
    const entries = await getDb().query.journal_entries.findMany({
      where: conds.length ? and(...conds) : undefined,
      // Secondary sort by created_at so multiple entries on the same
      // day surface newest-first. Without this Postgres returns same-
      // entry_date rows in insertion order — oldest at the top.
      orderBy: [desc(journal_entries.entry_date), desc(journal_entries.created_at)],
      limit,
    });
    return { entries };
  });

  app.post<{
    Body: {
      transcription_text?: string | null;
      entry_date?: string;
      attachments?: unknown[];
      source?: string;
    };
  }>('/api/journal-entries', async (req, reply) => {
    // Minimal validation — the column constraints on journal_entries do
    // the heavy lifting. Manual creates via the web form land here; the
    // voice path inserts directly via the executor.
    const body = req.body ?? {};
    const insert: typeof journal_entries.$inferInsert = {
      transcription_text: typeof body.transcription_text === 'string'
        ? body.transcription_text
        : null,
      entry_date: typeof body.entry_date === 'string' && body.entry_date
        ? body.entry_date
        : new Date().toISOString().slice(0, 10),
      attachments: Array.isArray(body.attachments) ? (body.attachments as StoredAttachment[]) : [],
      // 'typed' — the journal_entries source vocabulary is
      // handwritten_photo | voice | typed (a bare 'manual' violates the
      // CHECK constraint; pre-fork this path only worked because the web
      // form always sent source explicitly).
      source: typeof body.source === 'string' ? body.source : 'typed',
    };
    const [row] = await getDb().insert(journal_entries).values(insert).returning();
    if (!row) throw app.httpErrors.internalServerError('insert_returned_no_row');
    return reply.code(201).send(row);
  });

  app.get<{ Params: { id: string } }>('/api/journal-entries/:id', async (req, reply) => {
    const db = getDb();
    const row = await db.query.journal_entries.findFirst({
      where: eq(journal_entries.id, req.params.id),
    });
    if (!row) return reply.code(404).send({ error: 'not_found' });

    // Prev/next-day neighbours for the reader's paging (prev = older,
    // next = newer). Ordering mirrors the list route (entry_date, then
    // created_at) so paging walks the same sequence the list shows. The
    // ne(id) guard matters: created_at loses sub-millisecond precision on
    // the JS round-trip, so a strict gt/lt can match the row itself.
    const neighborColumns = { id: true, entry_date: true, transcription_text: true } as const;
    const [prev, next] = await Promise.all([
      db.query.journal_entries.findFirst({
        columns: neighborColumns,
        where: and(
          ne(journal_entries.id, row.id),
          or(
            lt(journal_entries.entry_date, row.entry_date),
            and(
              eq(journal_entries.entry_date, row.entry_date),
              lt(journal_entries.created_at, row.created_at),
            ),
          ),
        ),
        orderBy: [desc(journal_entries.entry_date), desc(journal_entries.created_at)],
      }),
      db.query.journal_entries.findFirst({
        columns: neighborColumns,
        where: and(
          ne(journal_entries.id, row.id),
          or(
            gt(journal_entries.entry_date, row.entry_date),
            and(
              eq(journal_entries.entry_date, row.entry_date),
              gt(journal_entries.created_at, row.created_at),
            ),
          ),
        ),
        orderBy: [asc(journal_entries.entry_date), asc(journal_entries.created_at)],
      }),
    ]);

    return { entry: row, prev: prev ?? null, next: next ?? null };
  });

  app.patch<{
    Params: { id: string };
    Body: {
      transcription_text?: string | null;
      entry_date?: string;
      attachments?: unknown[];
      resurface_weight?: number;
    };
  }>('/api/journal-entries/:id', async (req, reply) => {
    const update: Partial<typeof journal_entries.$inferInsert> = {};
    if (typeof req.body?.transcription_text === 'string') {
      update.transcription_text = req.body.transcription_text;
    } else if (req.body?.transcription_text === null) {
      update.transcription_text = null;
    }
    if (typeof req.body?.entry_date === 'string') {
      update.entry_date = req.body.entry_date;
    }
    if (Array.isArray(req.body?.attachments)) {
      update.attachments = req.body.attachments as StoredAttachment[];
    }
    if (typeof req.body?.resurface_weight === 'number' && req.body.resurface_weight >= 0) {
      update.resurface_weight = req.body.resurface_weight;
    }
    if (Object.keys(update).length === 0) {
      return reply.code(400).send({ error: 'empty_payload' });
    }
    const [row] = await getDb()
      .update(journal_entries)
      .set(update)
      .where(eq(journal_entries.id, req.params.id))
      .returning();
    if (!row) return reply.code(404).send({ error: 'not_found' });
    return row;
  });

  app.delete<{ Params: { id: string } }>('/api/journal-entries/:id', async (req, reply) => {
    // We delete attachment files lazily — the row's gone, the stored
    // files become orphaned. A future cleanup job can sweep them.
    // Inline deletion would add a storage round-trip per attachment and
    // failure modes (DB gone, file still there) we'd have to handle.
    await getDb().delete(journal_entries).where(eq(journal_entries.id, req.params.id));
    return reply.code(204).send();
  });

  // ─── Books (reading log + highlight container) ──────────────────────

  app.get<{ Querystring: { limit?: string } }>('/api/books', async (req) => {
    const limit = Math.min(parseInt(req.query.limit ?? '500', 10) || 500, 2000);
    const rows = await getDb().query.books.findMany({
      with: { quotes: { columns: { id: true } } },
      orderBy: asc(books.title),
      limit,
    });
    // Compress the quotes join down to a count for the list view.
    const bookRows = rows.map((b) => ({
      ...b,
      quote_count: b.quotes?.length ?? 0,
      quotes: undefined,
    }));
    return { books: bookRows };
  });

  app.post('/api/books', async (req, reply) => {
    const parsed = CreateBookSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_payload', details: parsed.error.flatten().fieldErrors });
    }
    const [row] = await getDb().insert(books).values(parsed.data).returning();
    if (!row) throw app.httpErrors.internalServerError('insert_returned_no_row');
    return reply.code(201).send(row);
  });

  app.patch<{ Params: { id: string } }>('/api/books/:id', async (req, reply) => {
    const parsed = UpdateBookSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_payload', details: parsed.error.flatten().fieldErrors });
    }
    if (Object.keys(parsed.data).length === 0) {
      return reply.code(400).send({ error: 'empty_payload' });
    }
    const [row] = await getDb()
      .update(books)
      .set(parsed.data)
      .where(eq(books.id, req.params.id))
      .returning();
    if (!row) return reply.code(404).send({ error: 'not_found' });
    return row;
  });

  app.delete<{ Params: { id: string } }>('/api/books/:id', async (req, reply) => {
    // quotes.book_id has ON DELETE SET NULL so highlights are preserved
    // (just unlinked) when a book row is removed.
    await getDb().delete(books).where(eq(books.id, req.params.id));
    return reply.code(204).send();
  });

  app.get<{ Params: { id: string } }>('/api/books/:id', async (req, reply) => {
    const db = getDb();
    const [book, bookQuotes] = await Promise.all([
      db.query.books.findFirst({ where: eq(books.id, req.params.id) }),
      db.query.quotes.findMany({
        where: eq(quotes.book_id, req.params.id),
        orderBy: [sql`${quotes.page_number} asc nulls last`, asc(quotes.created_at)],
      }),
    ]);
    if (!book) return reply.code(404).send({ error: 'not_found' });
    return { book, quotes: bookQuotes };
  });

  // ─── Tag aggregation ──────────────────────────────────────────────────
  //
  // Returns every distinct tag across the user's notes + quotes with a
  // per-source count, sorted by total count desc. The Readwise import gave
  // a lot of items tag arrays — this lets the UI render a tag cloud and
  // filter by clicking. We aggregate in JS rather than via a Postgres
  // function; with ~1500 rows total it's a single column-scan-and-count,
  // well under a second.

  app.get('/api/library/tags', async () => {
    const db = getDb();
    const [noteTags, quoteTags] = await Promise.all([
      db.query.notes.findMany({ columns: { tags: true }, limit: 5000 }),
      db.query.quotes.findMany({ columns: { tags: true }, limit: 5000 }),
    ]);

    const tally = new Map<string, { tag: string; notes: number; quotes: number }>();
    function bump(tags: string[] | null | undefined, key: 'notes' | 'quotes') {
      for (const raw of tags ?? []) {
        const tag = (raw ?? '').trim();
        if (!tag) continue;
        const existing = tally.get(tag) ?? { tag, notes: 0, quotes: 0 };
        existing[key] += 1;
        tally.set(tag, existing);
      }
    }
    for (const r of noteTags) bump(r.tags, 'notes');
    for (const r of quoteTags) bump(r.tags, 'quotes');

    const tags = Array.from(tally.values())
      .map((t) => ({ ...t, total: t.notes + t.quotes }))
      .sort((a, b) => b.total - a.total || a.tag.localeCompare(b.tag));
    return { tags };
  });

  // ─── Resurfacing — daily rotating pick ────────────────────────────────
  //
  // Pulls one item per day from the resurfacing pool (quotes +
  // journal entries) for the Today page's Resurfacing panel.
  //
  // Selection is weighted-random seeded by today's date. Same item shows
  // all day, rotates tomorrow. No state to update — pure read-only pick.
  //
  // Each row carries a resurface_weight column (default 1.0). Items
  // with weight 0 are excluded. Higher weights = proportionally more
  // likely to land.
  app.get<{ Querystring: { date?: string; skip?: string } }>('/api/library/resurfacing', async (req) => {
    const db = getDb();
    // Comma-separated IDs to exclude from the pool. The web side passes
    // these from a "resurfacing_seen" cookie that the "Next" button on
    // Today bumps every time the user wants to cycle to a different item.
    const skipIds = new Set(
      (req.query.skip ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    );
    // Pull only what we need to pick + render. ~thousand rows max for
    // a personal library; full scan is fine.
    const [poolQuotes, poolJournal] = await Promise.all([
      db.query.quotes.findMany({
        columns: { id: true, text: true, source_author: true, resurface_weight: true },
        with: { book: { columns: { id: true, title: true, author: true } } },
        where: gt(quotes.resurface_weight, 0),
      }),
      db.query.journal_entries.findMany({
        columns: { id: true, transcription_text: true, entry_date: true, resurface_weight: true },
        where: gt(journal_entries.resurface_weight, 0),
      }),
    ]);

    // Flatten everything into one weighted pool with a shared shape.
    type PoolItem = {
      kind: 'quote' | 'journal';
      id: string;
      weight: number;
      excerpt: string;
      source: string | null;
      href: string;
    };
    const pool: PoolItem[] = [];

    for (const q of poolQuotes) {
      const sourceBits = [q.book?.title, q.book?.author ?? q.source_author].filter(Boolean);
      pool.push({
        kind: 'quote',
        id: q.id,
        weight: Number(q.resurface_weight ?? 1),
        excerpt: String(q.text ?? ''),
        source: sourceBits.length > 0 ? sourceBits.join(' · ') : null,
        href: `/library/quotes/${q.id}`,
      });
    }
    for (const j of poolJournal) {
      pool.push({
        kind: 'journal',
        id: j.id,
        weight: Number(j.resurface_weight ?? 1),
        excerpt: String(j.transcription_text ?? ''),
        source: j.entry_date ?? null,
        href: `/library/journal/${j.id}`,
      });
    }

    if (pool.length === 0) {
      return { item: null };
    }

    // Apply skip filter. We keep `pool.length` (pre-filter) as the
    // original pool_size so the client can know whether the user has
    // burned through everything for today vs. a genuinely empty pool.
    const originalPoolSize = pool.length;
    const filtered = skipIds.size > 0
      ? pool.filter((p) => !skipIds.has(p.id))
      : pool;
    if (filtered.length === 0) {
      // The user has cycled past every item. Surface that distinctly so
      // the UI can render "All seen today — back tomorrow" instead of an
      // empty card.
      return { item: null, pool_size: originalPoolSize, exhausted: true };
    }

    // Deterministic seed: hash of today's date (or override via ?date).
    const dateStr = (req.query.date ?? new Date().toISOString().slice(0, 10));
    const seed = simpleHash(dateStr);

    // Weighted pick: total weight × normalized seed → index.
    const totalWeight = filtered.reduce((sum, p) => sum + p.weight, 0);
    if (totalWeight <= 0) return { item: null };
    const pickAt = (seed % 1_000_000) / 1_000_000 * totalWeight;
    let acc = 0;
    let chosen: PoolItem = filtered[0]!;
    for (const item of filtered) {
      acc += item.weight;
      if (acc >= pickAt) {
        chosen = item;
        break;
      }
    }

    // Cap excerpt length so the Today card stays compact. Word-boundary
    // truncation when possible, then an ellipsis.
    const MAX = 240;
    let excerpt = chosen.excerpt.trim();
    if (excerpt.length > MAX) {
      const cut = excerpt.slice(0, MAX);
      const lastSpace = cut.lastIndexOf(' ');
      excerpt = (lastSpace > 100 ? cut.slice(0, lastSpace) : cut) + '…';
    }

    return {
      item: {
        kind: chosen.kind,
        id: chosen.id,
        excerpt,
        source: chosen.source,
        href: chosen.href,
      },
      pool_size: originalPoolSize,
      skipped: skipIds.size,
      date: dateStr,
    };
  });

  // ─── Unified library feed (all sources, chronological) ────────────────

  app.get<{ Querystring: { limit?: string } }>('/api/library/feed', async (req) => {
    // Raised from 200 → 2000 to accommodate bulk-imported vaults. At that
    // scale we'll eventually need pagination, but for now letting the UI
    // ask for everything is simpler than building an infinite-scroll feed.
    const limit = Math.min(parseInt(req.query.limit ?? '60', 10) || 60, 2000);
    const db = getDb();
    // Include title (notes), tags + source_reference (notes + quotes),
    // and the book join (quotes) so the /library "All" view can render
    // the same scannable rows that the per-kind sub-pages do — instead
    // of dumping a wall of body text per item.
    const [feedNotes, feedQuotes, feedAnnotations, feedJournal] = await Promise.all([
      db.query.notes.findMany({
        columns: { id: true, title: true, body: true, source_type: true, source_reference: true, tags: true, created_at: true },
        orderBy: desc(notes.created_at),
        limit,
      }),
      db.query.quotes.findMany({
        columns: { id: true, text: true, source_author: true, source_reference: true, tags: true, created_at: true },
        with: { book: { columns: { id: true, title: true, author: true } } },
        orderBy: desc(quotes.created_at),
        limit,
      }),
      db.query.quote_annotations.findMany({
        columns: { id: true, body: true, quote_id: true, annotated_at: true },
        with: { quote: { columns: { id: true, text: true, source_author: true } } },
        orderBy: desc(quote_annotations.annotated_at),
        limit,
      }),
      db.query.journal_entries.findMany({
        columns: { id: true, transcription_text: true, entry_date: true, created_at: true },
        orderBy: desc(journal_entries.entry_date),
        limit,
      }),
    ]);

    type FeedItem = { kind: 'note' | 'quote' | 'annotation' | 'journal'; id: string; at: string; payload: Record<string, unknown> };
    const items: FeedItem[] = [];
    for (const n of feedNotes) items.push({ kind: 'note', id: n.id, at: n.created_at, payload: n });
    for (const q of feedQuotes) items.push({ kind: 'quote', id: q.id, at: q.created_at, payload: q });
    for (const a of feedAnnotations) items.push({ kind: 'annotation', id: a.id, at: a.annotated_at, payload: a });
    // Journal entries: the user can backdate them, so the feed sorts
    // + displays by entry_date (the day the user attributes the entry
    // to), not created_at (when the row was inserted).
    //
    // To preserve "newest first" WITHIN a given entry_date, we pin the
    // entry to its created_at's time-of-day on the entry_date. So two
    // journals both dated May 23 — one entered at 9am, one at 2pm —
    // sort as May-23 14:00 above May-23 09:00 instead of collapsing
    // to identical noon-UTC keys. Same-day notes/quotes mix in by
    // their own timestamps too, which feels right.
    for (const j of feedJournal) {
      const createdTime = j.created_at
        ? new Date(j.created_at).toISOString().slice(11, 19)
        : '12:00:00';
      items.push({
        kind: 'journal',
        id: j.id,
        at: `${j.entry_date}T${createdTime}Z`,
        payload: j,
      });
    }
    items.sort((a, b) => b.at.localeCompare(a.at));
    return { items: items.slice(0, limit) };
  });
};
