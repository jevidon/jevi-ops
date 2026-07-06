import type { FastifyPluginAsync } from 'fastify';
import { desc, ilike } from 'drizzle-orm';
import { getDb } from '../lib/db.js';
import {
  books,
  content_items,
  notes,
  people,
  projects,
  quotes,
  tasks,
} from '../db/schema.js';

// Global search across the user's library + work surfaces. Issues
// parallel ILIKE queries per searchable column, dedupes by row id, and
// caps each entity at 10 results so the response stays small.
//
// We keep per-column parallel queries (rather than a SQL OR) deliberately —
// this mirrors the original architecture: two queries per table is cheap,
// ordering stays per-column, and merging in JS keeps the code obvious.

const PER_ENTITY_LIMIT = 10;

// ILIKE treats % and _ as wildcards. Strip them from user input so a query
// like "50%" doesn't behave weirdly. Also trim whitespace and bail on empties.
function sanitize(raw: string): string {
  return raw.replace(/[%_]/g, '').trim();
}

// Run the per-column queries in parallel, dedupe by id, preserve
// newest-first order, cap to PER_ENTITY_LIMIT. Column queries that fail
// are logged and skipped rather than failing the whole search.
async function mergeColumns<T extends { id: string }>(
  queries: Promise<T[]>[],
  onError: (err: unknown) => void,
): Promise<T[]> {
  const results = await Promise.allSettled(queries);
  const seen = new Set<string>();
  const merged: T[] = [];
  for (const r of results) {
    if (r.status === 'rejected') {
      onError(r.reason);
      continue;
    }
    for (const row of r.value) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      merged.push(row);
    }
  }
  return merged.slice(0, PER_ENTITY_LIMIT);
}

export const searchRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.requireAuth);

  app.get<{ Querystring: { q?: string } }>('/api/search', async (req) => {
    const q = sanitize(req.query.q ?? '');
    if (q.length < 2) {
      return { query: q, notes: [], quotes: [], tasks: [], content: [], books: [], projects: [], people: [] };
    }
    const pattern = `%${q}%`;
    const db = getDb();
    const warn = (err: unknown) =>
      req.log.warn({ err: err instanceof Error ? err.message : String(err) }, 'search column query failed');

    const noteCols = { id: true, title: true, body: true, source_type: true, created_at: true } as const;
    const noteQuery = (col: typeof notes.title | typeof notes.body) =>
      db.query.notes.findMany({
        columns: noteCols, where: ilike(col, pattern),
        orderBy: desc(notes.created_at), limit: PER_ENTITY_LIMIT,
      });

    const quoteCols = { id: true, text: true, source_author: true, created_at: true } as const;
    const quoteQuery = (col: typeof quotes.text | typeof quotes.source_author) =>
      db.query.quotes.findMany({
        columns: quoteCols,
        with: { book: { columns: { id: true, title: true, author: true } } },
        where: ilike(col, pattern),
        orderBy: desc(quotes.created_at), limit: PER_ENTITY_LIMIT,
      });

    const taskCols = { id: true, title: true, notes: true, status: true, due_date: true, created_at: true } as const;
    const taskQuery = (col: typeof tasks.title | typeof tasks.notes) =>
      db.query.tasks.findMany({
        columns: taskCols,
        with: { project: { columns: { id: true, name: true, color: true } } },
        where: ilike(col, pattern),
        orderBy: desc(tasks.created_at), limit: PER_ENTITY_LIMIT,
      });

    const contentCols = { id: true, title: true, type: true, status: true, outline_md: true, updated_at: true } as const;
    const contentQuery = (col: typeof content_items.title | typeof content_items.outline_md) =>
      db.query.content_items.findMany({
        columns: contentCols,
        with: { domain: { columns: { id: true, name: true } } },
        where: ilike(col, pattern),
        orderBy: desc(content_items.updated_at), limit: PER_ENTITY_LIMIT,
      });

    const bookCols = { id: true, title: true, author: true, status: true, created_at: true } as const;
    const bookQuery = (col: typeof books.title | typeof books.author) =>
      db.query.books.findMany({
        columns: bookCols, where: ilike(col, pattern),
        orderBy: desc(books.created_at), limit: PER_ENTITY_LIMIT,
      });

    const projectCols = { id: true, name: true, description: true, status: true, color: true, created_at: true } as const;
    const projectQuery = (col: typeof projects.name | typeof projects.description) =>
      db.query.projects.findMany({
        columns: projectCols,
        with: { domain: { columns: { id: true, name: true } } },
        where: ilike(col, pattern),
        orderBy: desc(projects.created_at), limit: PER_ENTITY_LIMIT,
      });

    const personCols = { id: true, name: true, relationship_type: true, email: true, company: true, notes: true, updated_at: true } as const;
    const personQuery = (col: typeof people.name | typeof people.company | typeof people.email | typeof people.notes) =>
      db.query.people.findMany({
        columns: personCols, where: ilike(col, pattern),
        orderBy: desc(people.updated_at), limit: PER_ENTITY_LIMIT,
      });

    const [noteRows, quoteRows, taskRows, contentRows, bookRows, projectRows, peopleRows] = await Promise.all([
      mergeColumns([noteQuery(notes.title), noteQuery(notes.body)], warn),
      mergeColumns([quoteQuery(quotes.text), quoteQuery(quotes.source_author)], warn),
      mergeColumns([taskQuery(tasks.title), taskQuery(tasks.notes)], warn),
      mergeColumns([contentQuery(content_items.title), contentQuery(content_items.outline_md)], warn),
      mergeColumns([bookQuery(books.title), bookQuery(books.author)], warn),
      mergeColumns([projectQuery(projects.name), projectQuery(projects.description)], warn),
      mergeColumns(
        [personQuery(people.name), personQuery(people.company), personQuery(people.email), personQuery(people.notes)],
        warn,
      ),
    ]);

    return {
      query: q,
      notes: noteRows,
      quotes: quoteRows,
      tasks: taskRows,
      content: contentRows,
      books: bookRows,
      projects: projectRows,
      people: peopleRows,
    };
  });
};
