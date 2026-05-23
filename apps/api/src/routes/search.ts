import type { FastifyPluginAsync } from 'fastify';

// Global search across the user's library + work surfaces. Issues
// parallel ILIKE queries per searchable column, dedupes by row id, and
// caps each entity at 10 results so the response stays small.
//
// We do per-column parallel queries (rather than PostgREST .or()) to
// sidestep escaping pain — commas, parens, and quotes in the user's
// query would all need careful handling inside an .or() filter string.
// Two queries per table is cheap and avoids that whole class of bug.

const PER_ENTITY_LIMIT = 10;

// PostgREST + Supabase ILIKE treat % and _ as wildcards. Strip them
// from user input so a query like "50%" doesn't behave weirdly. Also
// trim whitespace and bail early on empties.
function sanitize(raw: string): string {
  return raw.replace(/[%_]/g, '').trim();
}

export const searchRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.requireAuth);

  app.get<{ Querystring: { q?: string } }>('/api/search', async (req) => {
    const q = sanitize(req.query.q ?? '');
    if (q.length < 2) {
      return { query: q, notes: [], quotes: [], tasks: [], content: [], books: [], projects: [], people: [] };
    }
    const pattern = `%${q}%`;
    const sb = req.supabase!;

    // Per-entity helper: run N column queries in parallel, dedupe by id,
    // preserve newest-first order, cap to PER_ENTITY_LIMIT.
    async function searchTable<T extends { id: string }>(
      table: string,
      select: string,
      columns: string[],
      orderColumn: string,
    ): Promise<T[]> {
      const results = await Promise.all(
        columns.map((col) =>
          sb
            .from(table)
            .select(select)
            .ilike(col, pattern)
            .order(orderColumn, { ascending: false })
            .limit(PER_ENTITY_LIMIT),
        ),
      );
      const seen = new Set<string>();
      const merged: T[] = [];
      for (const r of results) {
        if (r.error) {
          req.log.warn({ err: r.error.message, table }, 'search column query failed');
          continue;
        }
        // Supabase's inferred select() row type doesn't overlap cleanly
        // with our caller-supplied T; cast through unknown is fine since
        // the caller knows the shape it asked for.
        for (const row of ((r.data ?? []) as unknown) as T[]) {
          if (seen.has(row.id)) continue;
          seen.add(row.id);
          merged.push(row);
        }
      }
      return merged.slice(0, PER_ENTITY_LIMIT);
    }

    const [notes, quotes, tasks, content, books, projects, people] = await Promise.all([
      searchTable(
        'notes',
        'id, title, body, source_type, created_at',
        ['title', 'body'],
        'created_at',
      ),
      searchTable(
        'quotes',
        'id, text, source_author, created_at, book:books(id, title, author)',
        ['text', 'source_author'],
        'created_at',
      ),
      searchTable(
        'tasks',
        'id, title, notes, status, due_date, created_at, project:projects(id, name, color)',
        ['title', 'notes'],
        'created_at',
      ),
      searchTable(
        'content_items',
        'id, title, type, status, outline_md, updated_at, domain:stewardship_domains(id, name)',
        ['title', 'outline_md'],
        'updated_at',
      ),
      searchTable(
        'books',
        'id, title, author, status, created_at',
        ['title', 'author'],
        'created_at',
      ),
      searchTable(
        'projects',
        'id, name, description, status, color, created_at, domain:stewardship_domains(id, name)',
        ['name', 'description'],
        'created_at',
      ),
      searchTable(
        'people',
        'id, name, relationship_type, email, company, notes, updated_at',
        ['name', 'company', 'email', 'notes'],
        'updated_at',
      ),
    ]);

    return { query: q, notes, quotes, tasks, content, books, projects, people };
  });
};
