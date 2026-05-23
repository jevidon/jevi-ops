import type { FastifyPluginAsync } from 'fastify';
import {
  CreateNoteSchema, UpdateNoteSchema,
  CreateQuoteAnnotationSchema, UpdateQuoteAnnotationSchema,
} from '@jerad-ops/shared/schemas';

// Library CRUD — notes, quotes, quote_annotations, journal_entries, books.
// Auth-gated; uses the request-scoped Supabase client so RLS applies.

export const libraryRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.requireAuth);

  // ─── Notes ────────────────────────────────────────────────────────────

  app.get<{ Querystring: { source_type?: string; needs_review?: string; limit?: string } }>(
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

  app.get<{ Querystring: { limit?: string } }>('/api/quotes', async (req) => {
    const limit = Math.min(parseInt(req.query.limit ?? '500', 10) || 500, 2000);
    const { data, error } = await req.supabase!
      .from('quotes')
      .select('*, book:books(id, title, author), annotations:quote_annotations(id)')
      .order('created_at', { ascending: false })
      .limit(limit);
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

  // ─── Journal entries (read-only for now; create happens via voice) ────

  app.get<{ Querystring: { limit?: string } }>('/api/journal-entries', async (req) => {
    const limit = Math.min(parseInt(req.query.limit ?? '500', 10) || 500, 2000);
    const { data, error } = await req.supabase!
      .from('journal_entries')
      .select('*')
      .order('entry_date', { ascending: false })
      .limit(limit);
    if (error) throw app.httpErrors.internalServerError(error.message);
    return { entries: data ?? [] };
  });

  // ─── Unified library feed (all sources, chronological) ────────────────

  app.get<{ Querystring: { limit?: string } }>('/api/library/feed', async (req) => {
    // Raised from 200 → 2000 to accommodate bulk-imported vaults. At that
    // scale we'll eventually need pagination, but for now letting the UI
    // ask for everything is simpler than building an infinite-scroll feed.
    const limit = Math.min(parseInt(req.query.limit ?? '60', 10) || 60, 2000);
    const sb = req.supabase!;
    const [notes, quotes, annotations, journal] = await Promise.all([
      sb.from('notes').select('id, body, source_type, created_at').order('created_at', { ascending: false }).limit(limit),
      sb.from('quotes').select('id, text, source_author, created_at').order('created_at', { ascending: false }).limit(limit),
      sb.from('quote_annotations').select('id, body, quote_id, annotated_at, quote:quotes(id, text, source_author)').order('annotated_at', { ascending: false }).limit(limit),
      sb.from('journal_entries').select('id, transcription_text, entry_date, created_at').order('entry_date', { ascending: false }).limit(limit),
    ]);

    type FeedItem = { kind: 'note' | 'quote' | 'annotation' | 'journal'; id: string; at: string; payload: Record<string, unknown> };
    const items: FeedItem[] = [];
    for (const n of notes.data ?? []) items.push({ kind: 'note', id: n.id, at: n.created_at, payload: n });
    for (const q of quotes.data ?? []) items.push({ kind: 'quote', id: q.id, at: q.created_at, payload: q });
    for (const a of annotations.data ?? []) items.push({ kind: 'annotation', id: a.id, at: a.annotated_at, payload: a });
    for (const j of journal.data ?? []) items.push({ kind: 'journal', id: j.id, at: j.created_at, payload: j });
    items.sort((a, b) => b.at.localeCompare(a.at));
    return { items: items.slice(0, limit) };
  });
};
