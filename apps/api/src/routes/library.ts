import type { FastifyPluginAsync } from 'fastify';
import {
  CreateNoteSchema, UpdateNoteSchema,
  CreateQuoteAnnotationSchema, UpdateQuoteAnnotationSchema,
  CreateBookSchema, UpdateBookSchema,
  CreateQuoteSchema, UpdateQuoteSchema,
} from '@jerad-ops/shared/schemas';

// Library CRUD — notes, quotes, quote_annotations, journal_entries, books.
// Auth-gated; uses the request-scoped Supabase client so RLS applies.

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
      let q = req.supabase!
        .from('notes')
        .select('*, project:projects(id, name, color), person:people(id, name), quote:quotes(id, text)')
        .order('created_at', { ascending: false })
        .limit(limit);
      if (req.query.source_type) q = q.eq('source_type', req.query.source_type);
      if (req.query.needs_review === 'true') q = q.eq('needs_review', true);
      // tags is a text[] column — .contains() generates the @> operator
      // which matches rows whose array includes every element we pass.
      if (req.query.tag) q = q.contains('tags', [req.query.tag]);
      // ?resurface=boosted → weight > 1, excluded → weight = 0. The default
      // (no filter) shows everything regardless of weight so the list
      // doesn't mysteriously hide rows.
      if (req.query.resurface === 'boosted') q = q.gt('resurface_weight', 1);
      else if (req.query.resurface === 'excluded') q = q.eq('resurface_weight', 0);
      const { data, error } = await q;
      if (error) throw app.httpErrors.internalServerError(error.message);
      return { notes: data ?? [] };
    },
  );

  app.get<{ Params: { id: string } }>('/api/notes/:id', async (req, reply) => {
    const { data, error } = await req.supabase!
      .from('notes')
      .select('*, project:projects(id, name, color), person:people(id, name), quote:quotes(id, text, source_author)')
      .eq('id', req.params.id)
      .maybeSingle();
    if (error) throw app.httpErrors.internalServerError(error.message);
    if (!data) return reply.code(404).send({ error: 'not_found' });
    return data;
  });

  app.post('/api/notes', async (req, reply) => {
    const parsed = CreateNoteSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_payload', details: parsed.error.flatten().fieldErrors });
    }
    const { data, error } = await req.supabase!.from('notes').insert(parsed.data).select('*').single();
    if (error) throw app.httpErrors.internalServerError(error.message);
    return reply.code(201).send(data);
  });

  app.patch<{ Params: { id: string } }>('/api/notes/:id', async (req, reply) => {
    const parsed = UpdateNoteSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_payload', details: parsed.error.flatten().fieldErrors });
    }
    const { data, error } = await req.supabase!
      .from('notes')
      .update(parsed.data)
      .eq('id', req.params.id)
      .select('*')
      .single();
    if (error) throw app.httpErrors.internalServerError(error.message);
    return data;
  });

  app.delete<{ Params: { id: string } }>('/api/notes/:id', async (req, reply) => {
    const { error } = await req.supabase!.from('notes').delete().eq('id', req.params.id);
    if (error) throw app.httpErrors.internalServerError(error.message);
    return reply.code(204).send();
  });

  // ─── Quotes ────────────────────────────────────────────────────────────

  app.get<{ Querystring: { tag?: string; limit?: string; resurface?: string } }>('/api/quotes', async (req) => {
    const limit = Math.min(parseInt(req.query.limit ?? '500', 10) || 500, 2000);
    let qb = req.supabase!
      .from('quotes')
      .select('*, book:books(id, title, author), annotations:quote_annotations(id)')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (req.query.tag) qb = qb.contains('tags', [req.query.tag]);
    if (req.query.resurface === 'boosted') qb = qb.gt('resurface_weight', 1);
    else if (req.query.resurface === 'excluded') qb = qb.eq('resurface_weight', 0);
    const { data, error } = await qb;
    if (error) throw app.httpErrors.internalServerError(error.message);
    // Compress annotation rows down to a count for the list view.
    type AnnoRow = { id: string };
    type QuoteRow = { annotations?: AnnoRow[]; [k: string]: unknown };
    const quotes = ((data ?? []) as QuoteRow[]).map((q) => ({
      ...q,
      annotation_count: q.annotations?.length ?? 0,
      annotations: undefined,
    }));
    return { quotes };
  });

  app.get<{ Params: { id: string } }>('/api/quotes/:id', async (req, reply) => {
    const [quoteRes, annoRes] = await Promise.all([
      req.supabase!
        .from('quotes')
        .select('*, book:books(id, title, author)')
        .eq('id', req.params.id)
        .maybeSingle(),
      req.supabase!
        .from('quote_annotations')
        .select('*')
        .eq('quote_id', req.params.id)
        .order('annotated_at', { ascending: true }),
    ]);
    if (quoteRes.error) throw app.httpErrors.internalServerError(quoteRes.error.message);
    if (!quoteRes.data) return reply.code(404).send({ error: 'not_found' });
    if (annoRes.error) throw app.httpErrors.internalServerError(annoRes.error.message);
    return { quote: quoteRes.data, annotations: annoRes.data ?? [] };
  });

  app.post('/api/quotes', async (req, reply) => {
    const parsed = CreateQuoteSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_payload', details: parsed.error.flatten().fieldErrors });
    }
    const { data, error } = await req.supabase!
      .from('quotes')
      .insert(parsed.data)
      .select('*')
      .single();
    if (error) throw app.httpErrors.internalServerError(error.message);
    return reply.code(201).send(data);
  });

  app.patch<{ Params: { id: string } }>('/api/quotes/:id', async (req, reply) => {
    const parsed = UpdateQuoteSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_payload', details: parsed.error.flatten().fieldErrors });
    }
    if (Object.keys(parsed.data).length === 0) {
      return reply.code(400).send({ error: 'empty_payload' });
    }
    const { data, error } = await req.supabase!
      .from('quotes')
      .update(parsed.data)
      .eq('id', req.params.id)
      .select('*')
      .single();
    if (error) throw app.httpErrors.internalServerError(error.message);
    return data;
  });

  app.delete<{ Params: { id: string } }>('/api/quotes/:id', async (req, reply) => {
    // CASCADE on quote_annotations.quote_id cleans up annotations automatically.
    const { error } = await req.supabase!.from('quotes').delete().eq('id', req.params.id);
    if (error) throw app.httpErrors.internalServerError(error.message);
    return reply.code(204).send();
  });

  // ─── Quote annotations ───────────────────────────────────────────────

  app.post('/api/quote-annotations', async (req, reply) => {
    const parsed = CreateQuoteAnnotationSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_payload', details: parsed.error.flatten().fieldErrors });
    }
    const { data, error } = await req.supabase!
      .from('quote_annotations')
      .insert(parsed.data)
      .select('*')
      .single();
    if (error) throw app.httpErrors.internalServerError(error.message);
    return reply.code(201).send(data);
  });

  app.patch<{ Params: { id: string } }>('/api/quote-annotations/:id', async (req, reply) => {
    const parsed = UpdateQuoteAnnotationSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_payload', details: parsed.error.flatten().fieldErrors });
    }
    const { data, error } = await req.supabase!
      .from('quote_annotations')
      .update(parsed.data)
      .eq('id', req.params.id)
      .select('*')
      .single();
    if (error) throw app.httpErrors.internalServerError(error.message);
    return data;
  });

  app.delete<{ Params: { id: string } }>('/api/quote-annotations/:id', async (req, reply) => {
    const { error } = await req.supabase!.from('quote_annotations').delete().eq('id', req.params.id);
    if (error) throw app.httpErrors.internalServerError(error.message);
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
    let qb = req.supabase!
      .from('journal_entries')
      .select('*')
      .order('entry_date', { ascending: false })
      // Secondary sort by created_at so multiple entries on the same
      // day surface newest-first. Without this Postgres returns same-
      // entry_date rows in insertion order — oldest at the top.
      .order('created_at', { ascending: false })
      .limit(limit);
    if (req.query.resurface === 'boosted') qb = qb.gt('resurface_weight', 1);
    else if (req.query.resurface === 'excluded') qb = qb.eq('resurface_weight', 0);
    const { data, error } = await qb;
    if (error) throw app.httpErrors.internalServerError(error.message);
    return { entries: data ?? [] };
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
    const insert: Record<string, unknown> = {
      transcription_text: typeof body.transcription_text === 'string'
        ? body.transcription_text
        : null,
      entry_date: typeof body.entry_date === 'string' && body.entry_date
        ? body.entry_date
        : new Date().toISOString().slice(0, 10),
      attachments: Array.isArray(body.attachments) ? body.attachments : [],
      source: typeof body.source === 'string' ? body.source : 'manual',
    };
    const { data, error } = await req.supabase!
      .from('journal_entries')
      .insert(insert)
      .select('*')
      .single();
    if (error) throw app.httpErrors.internalServerError(error.message);
    return reply.code(201).send(data);
  });

  app.get<{ Params: { id: string } }>('/api/journal-entries/:id', async (req, reply) => {
    const { data, error } = await req.supabase!
      .from('journal_entries')
      .select('*')
      .eq('id', req.params.id)
      .maybeSingle();
    if (error) throw app.httpErrors.internalServerError(error.message);
    if (!data) return reply.code(404).send({ error: 'not_found' });
    return data;
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
    const update: Record<string, unknown> = {};
    if (typeof req.body?.transcription_text === 'string') {
      update.transcription_text = req.body.transcription_text;
    } else if (req.body?.transcription_text === null) {
      update.transcription_text = null;
    }
    if (typeof req.body?.entry_date === 'string') {
      update.entry_date = req.body.entry_date;
    }
    if (Array.isArray(req.body?.attachments)) {
      update.attachments = req.body.attachments;
    }
    if (typeof req.body?.resurface_weight === 'number' && req.body.resurface_weight >= 0) {
      update.resurface_weight = req.body.resurface_weight;
    }
    if (Object.keys(update).length === 0) {
      return reply.code(400).send({ error: 'empty_payload' });
    }
    const { data, error } = await req.supabase!
      .from('journal_entries')
      .update(update)
      .eq('id', req.params.id)
      .select('*')
      .single();
    if (error) throw app.httpErrors.internalServerError(error.message);
    return data;
  });

  app.delete<{ Params: { id: string } }>('/api/journal-entries/:id', async (req, reply) => {
    // We delete attachments from Bunny lazily — the row's gone, the
    // CDN files become orphaned. A future cleanup job can sweep them.
    // Inline deletion would add a Bunny round-trip per attachment and
    // failure modes (DB gone, file still there) we'd have to handle.
    const { error } = await req.supabase!
      .from('journal_entries')
      .delete()
      .eq('id', req.params.id);
    if (error) throw app.httpErrors.internalServerError(error.message);
    return reply.code(204).send();
  });

  // ─── Books (reading log + highlight container) ──────────────────────

  app.get<{ Querystring: { limit?: string } }>('/api/books', async (req) => {
    const limit = Math.min(parseInt(req.query.limit ?? '500', 10) || 500, 2000);
    const { data, error } = await req.supabase!
      .from('books')
      .select('*, quotes:quotes(id)')
      .order('title', { ascending: true })
      .limit(limit);
    if (error) throw app.httpErrors.internalServerError(error.message);
    // Compress the quotes join down to a count for the list view.
    type QuoteRef = { id: string };
    type BookRow = { quotes?: QuoteRef[]; [k: string]: unknown };
    const books = ((data ?? []) as BookRow[]).map((b) => ({
      ...b,
      quote_count: b.quotes?.length ?? 0,
      quotes: undefined,
    }));
    return { books };
  });

  app.post('/api/books', async (req, reply) => {
    const parsed = CreateBookSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_payload', details: parsed.error.flatten().fieldErrors });
    }
    const { data, error } = await req.supabase!
      .from('books')
      .insert(parsed.data)
      .select('*')
      .single();
    if (error) throw app.httpErrors.internalServerError(error.message);
    return reply.code(201).send(data);
  });

  app.patch<{ Params: { id: string } }>('/api/books/:id', async (req, reply) => {
    const parsed = UpdateBookSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_payload', details: parsed.error.flatten().fieldErrors });
    }
    if (Object.keys(parsed.data).length === 0) {
      return reply.code(400).send({ error: 'empty_payload' });
    }
    const { data, error } = await req.supabase!
      .from('books')
      .update(parsed.data)
      .eq('id', req.params.id)
      .select('*')
      .single();
    if (error) throw app.httpErrors.internalServerError(error.message);
    return data;
  });

  app.delete<{ Params: { id: string } }>('/api/books/:id', async (req, reply) => {
    // quotes.book_id has ON DELETE SET NULL so highlights are preserved
    // (just unlinked) when a book row is removed.
    const { error } = await req.supabase!.from('books').delete().eq('id', req.params.id);
    if (error) throw app.httpErrors.internalServerError(error.message);
    return reply.code(204).send();
  });

  app.get<{ Params: { id: string } }>('/api/books/:id', async (req, reply) => {
    const [bookRes, quotesRes] = await Promise.all([
      req.supabase!.from('books').select('*').eq('id', req.params.id).maybeSingle(),
      req.supabase!
        .from('quotes')
        .select('*')
        .eq('book_id', req.params.id)
        .order('page_number', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: true }),
    ]);
    if (bookRes.error) throw app.httpErrors.internalServerError(bookRes.error.message);
    if (!bookRes.data) return reply.code(404).send({ error: 'not_found' });
    if (quotesRes.error) throw app.httpErrors.internalServerError(quotesRes.error.message);
    return { book: bookRes.data, quotes: quotesRes.data ?? [] };
  });

  // ─── Tag aggregation ──────────────────────────────────────────────────
  //
  // Returns every distinct tag across the user's notes + quotes with a
  // per-source count, sorted by total count desc. The Readwise import gave
  // a lot of items tag arrays — this lets the UI render a tag cloud and
  // filter by clicking. We aggregate in JS rather than via a Postgres
  // function so we don't need a new migration; with ~1500 rows total it's
  // a single column-scan-and-count, well under a second.

  app.get('/api/library/tags', async (req) => {
    const sb = req.supabase!;
    const [notesRes, quotesRes] = await Promise.all([
      sb.from('notes').select('tags').limit(5000),
      sb.from('quotes').select('tags').limit(5000),
    ]);
    if (notesRes.error) throw app.httpErrors.internalServerError(notesRes.error.message);
    if (quotesRes.error) throw app.httpErrors.internalServerError(quotesRes.error.message);

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
    type TagsRow = { tags?: string[] | null };
    for (const r of (notesRes.data ?? []) as TagsRow[]) bump(r.tags, 'notes');
    for (const r of (quotesRes.data ?? []) as TagsRow[]) bump(r.tags, 'quotes');

    const tags = Array.from(tally.values())
      .map((t) => ({ ...t, total: t.notes + t.quotes }))
      .sort((a, b) => b.total - a.total || a.tag.localeCompare(b.tag));
    return { tags };
  });

  // ─── Unified library feed (all sources, chronological) ────────────────

  // ─── Resurfacing — daily rotating pick ────────────────────────────────
  //
  // Pulls one item per day from the resurfacing pool (quotes +
  // journal entries) for the Today page's Resurfacing panel.
  //
  // Selection is weighted-random seeded by today's date (in the
  // requester's app timezone, defaulted to America/Denver server-side
  // for now). Same item shows all day, rotates tomorrow. No state to
  // update — pure read-only pick.
  //
  // Each row carries a resurface_weight column (default 1.0). Items
  // with weight 0 are excluded. Higher weights = proportionally more
  // likely to land. UI for adjusting weights ships later.
  app.get<{ Querystring: { date?: string; skip?: string } }>('/api/library/resurfacing', async (req) => {
    const sb = req.supabase!;
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
    const [quotesRes, journalRes] = await Promise.all([
      sb.from('quotes')
        .select('id, text, source_author, resurface_weight, book:books(id, title, author)')
        .gt('resurface_weight', 0),
      sb.from('journal_entries')
        .select('id, transcription_text, entry_date, resurface_weight')
        .gt('resurface_weight', 0),
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

    for (const q of quotesRes.data ?? []) {
      const book = Array.isArray((q as { book?: unknown }).book)
        ? ((q as { book: unknown[] }).book[0] as { title?: string; author?: string } | undefined)
        : ((q as { book?: { title?: string; author?: string } | null }).book ?? undefined);
      const sourceBits = [book?.title, book?.author ?? (q as { source_author?: string }).source_author]
        .filter(Boolean);
      pool.push({
        kind: 'quote',
        id: (q as { id: string }).id,
        weight: Number((q as { resurface_weight?: number }).resurface_weight ?? 1),
        excerpt: String((q as { text?: string }).text ?? ''),
        source: sourceBits.length > 0 ? sourceBits.join(' · ') : null,
        href: `/library/quotes/${(q as { id: string }).id}`,
      });
    }
    for (const j of journalRes.data ?? []) {
      pool.push({
        kind: 'journal',
        id: (j as { id: string }).id,
        weight: Number((j as { resurface_weight?: number }).resurface_weight ?? 1),
        excerpt: String((j as { transcription_text?: string }).transcription_text ?? ''),
        source: (j as { entry_date?: string }).entry_date ?? null,
        href: `/library/journal/${(j as { id: string }).id}`,
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

  app.get<{ Querystring: { limit?: string } }>('/api/library/feed', async (req) => {
    // Raised from 200 → 2000 to accommodate bulk-imported vaults. At that
    // scale we'll eventually need pagination, but for now letting the UI
    // ask for everything is simpler than building an infinite-scroll feed.
    const limit = Math.min(parseInt(req.query.limit ?? '60', 10) || 60, 2000);
    const sb = req.supabase!;
    // Include title (notes), tags + source_reference (notes + quotes),
    // and the book join (quotes) so the /library "All" view can render
    // the same scannable rows that the per-kind sub-pages do — instead
    // of dumping a wall of body text per item.
    const [notes, quotes, annotations, journal] = await Promise.all([
      sb.from('notes')
        .select('id, title, body, source_type, source_reference, tags, created_at')
        .order('created_at', { ascending: false }).limit(limit),
      sb.from('quotes')
        .select('id, text, source_author, source_reference, tags, created_at, book:books(id, title, author)')
        .order('created_at', { ascending: false }).limit(limit),
      sb.from('quote_annotations')
        .select('id, body, quote_id, annotated_at, quote:quotes(id, text, source_author)')
        .order('annotated_at', { ascending: false }).limit(limit),
      sb.from('journal_entries')
        .select('id, transcription_text, entry_date, created_at')
        .order('entry_date', { ascending: false }).limit(limit),
    ]);

    type FeedItem = { kind: 'note' | 'quote' | 'annotation' | 'journal'; id: string; at: string; payload: Record<string, unknown> };
    const items: FeedItem[] = [];
    for (const n of notes.data ?? []) items.push({ kind: 'note', id: n.id, at: n.created_at, payload: n });
    for (const q of quotes.data ?? []) items.push({ kind: 'quote', id: q.id, at: q.created_at, payload: q });
    for (const a of annotations.data ?? []) items.push({ kind: 'annotation', id: a.id, at: a.annotated_at, payload: a });
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
    for (const j of journal.data ?? []) {
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
