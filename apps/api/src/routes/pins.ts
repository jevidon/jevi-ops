import type { FastifyPluginAsync } from 'fastify';
import { eq, inArray, sql, and } from 'drizzle-orm';
import { z } from 'zod';
import {
  CreatePinSchema,
  ReorderPinsSchema,
  PinTargetTypeSchema,
  type PinTargetType,
  type ResolvedPin,
} from '@jevi-ops/shared/schemas';
import { getDb, type Db } from '../lib/db.js';
import {
  pinned_items,
  tasks,
  projects,
  stewardship_domains,
  people,
  companies,
  content_items,
  books,
  notes,
  quotes,
  routines,
  routine_completions,
} from '../db/schema.js';
import { getAppTz } from '../lib/app-settings.js';
import { todayInTz } from '../lib/tz.js';

// /api/pins — Briefing pins (migration 0044). A durable, manually ordered
// polymorphic pointer at any of ten entity types, resolved server-side into
// display summaries so the Pinned panel renders without per-type fetches.
//
// Referential integrity is app-side (no FK — daily_focus pattern): POST
// verifies the target exists, and GET lazily deletes pins whose target has
// since been deleted, so entity DELETE handlers stay untouched. A pin whose
// TASK is completed is NOT stale — it resolves with status 'done' and the
// card renders checked; the user unpins deliberately.

// Querystring target for lookup/delete — same fields as CreatePinSchema but
// arriving as query params, so validated separately (a bad uuid must be a
// 400, not a Postgres cast error).
const TargetQuerySchema = z.object({
  target_type: PinTargetTypeSchema,
  target_id: z.string().uuid(),
});

const excerpt = (s: string, n: number): string => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length <= n ? t : `${t.slice(0, n - 1).trimEnd()}…`;
};

// "active_client" → "Active client"
const humanize = (s: string): string =>
  (s.charAt(0).toUpperCase() + s.slice(1)).replace(/_/g, ' ');

const HREF: Record<PinTargetType, (id: string) => string> = {
  task: (id) => `/tasks/${id}`,
  project: (id) => `/projects/${id}`,
  domain: (id) => `/domains/${id}`,
  person: (id) => `/people/${id}`,
  company: (id) => `/companies/${id}`,
  content_item: (id) => `/content/${id}`,
  book: (id) => `/library/books/${id}`,
  note: (id) => `/library/notes/${id}`,
  quote: (id) => `/library/quotes/${id}`,
  routine: (id) => `/routines/${id}`,
};

// Calendar-day difference between two YYYY-MM-DD strings (b - a).
const daysBetween = (a: string, b: string): number =>
  Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

// Resolve one type's pins in a single batched query. Returns a map keyed by
// target_id holding everything ResolvedPin needs beyond the pin row itself.
type Resolved = Omit<ResolvedPin, 'id' | 'target_type' | 'target_id' | 'position'>;

async function resolveType(
  db: Db,
  type: PinTargetType,
  ids: string[],
  today: string,
): Promise<Map<string, Resolved>> {
  const out = new Map<string, Resolved>();

  switch (type) {
    case 'task': {
      const rows = await db
        .select({
          id: tasks.id,
          title: tasks.title,
          status: tasks.status,
          due_date: tasks.due_date,
          due_time: tasks.due_time,
          priority: tasks.priority,
          project_id: tasks.project_id,
        })
        .from(tasks)
        .where(inArray(tasks.id, ids));
      const projectIds = [...new Set(rows.map((r) => r.project_id).filter((v): v is string => !!v))];
      const projectRows = projectIds.length
        ? await db
            .select({ id: projects.id, name: projects.name })
            .from(projects)
            .where(inArray(projects.id, projectIds))
        : [];
      const projectById = new Map(projectRows.map((p) => [p.id, p]));
      for (const r of rows) {
        const open = r.status === 'open';
        const overdueDays = r.due_date && open ? daysBetween(r.due_date, today) : 0;
        const state = open && r.due_date
          ? overdueDays > 0 ? 'over' : overdueDays === 0 ? 'due' : null
          : null;
        const project = (r.project_id && projectById.get(r.project_id)) || null;
        const dueLabel = !r.due_date
          ? null
          : overdueDays > 0 && open
            ? `Overdue ${overdueDays}d`
            : overdueDays === 0
              ? 'Due today'
              : `Due ${r.due_date}`;
        out.set(r.id, {
          title: r.title,
          subtitle: [project?.name, dueLabel].filter(Boolean).join(' · ') || null,
          href: HREF.task(r.id),
          state,
          task: {
            status: r.status,
            due_date: r.due_date,
            due_time: r.due_time,
            priority: r.priority,
            project: project ? { id: project.id, name: project.name } : null,
          },
        });
      }
      return out;
    }

    case 'project': {
      const rows = await db
        .select({ id: projects.id, name: projects.name, kind: projects.kind, status: projects.status, color: projects.color })
        .from(projects)
        .where(inArray(projects.id, ids));
      for (const r of rows) {
        out.set(r.id, {
          title: r.name,
          subtitle: r.kind === 'area' ? 'Area' : `Project · ${humanize(r.status)}`,
          href: HREF.project(r.id),
          state: null,
          project: { kind: r.kind, status: r.status, color: r.color },
        });
      }
      return out;
    }

    case 'domain': {
      const rows = await db
        .select({ id: stewardship_domains.id, name: stewardship_domains.name, parked: stewardship_domains.parked })
        .from(stewardship_domains)
        .where(inArray(stewardship_domains.id, ids));
      for (const r of rows) {
        out.set(r.id, {
          title: r.name,
          subtitle: r.parked ? 'Domain · parked' : 'Domain',
          href: HREF.domain(r.id),
          state: null,
        });
      }
      return out;
    }

    case 'person': {
      const rows = await db
        .select({ id: people.id, name: people.name, relationship_type: people.relationship_type, role_at_company: people.role_at_company })
        .from(people)
        .where(inArray(people.id, ids));
      for (const r of rows) {
        out.set(r.id, {
          title: r.name,
          subtitle: r.role_at_company ?? (r.relationship_type ? humanize(r.relationship_type) : 'Person'),
          href: HREF.person(r.id),
          state: null,
        });
      }
      return out;
    }

    case 'company': {
      const rows = await db
        .select({ id: companies.id, name: companies.name, relationship_type: companies.relationship_type, last_interaction_at: companies.last_interaction_at })
        .from(companies)
        .where(inArray(companies.id, ids));
      for (const r of rows) {
        // Calendar-day silence, same derivation the Briefing's silent-client
        // rows use (days since last conversation; null = never).
        const silentDays = r.last_interaction_at
          ? daysBetween(r.last_interaction_at.slice(0, 10), today)
          : null;
        out.set(r.id, {
          title: r.name,
          subtitle: r.relationship_type ? humanize(r.relationship_type) : 'Company',
          href: HREF.company(r.id),
          state: null,
          company: { relationship_type: r.relationship_type, silent_days: silentDays },
        });
      }
      return out;
    }

    case 'content_item': {
      const rows = await db
        .select({ id: content_items.id, title: content_items.title, type: content_items.type, status: content_items.status })
        .from(content_items)
        .where(inArray(content_items.id, ids));
      for (const r of rows) {
        out.set(r.id, {
          title: r.title,
          subtitle: `${humanize(r.type)} · ${humanize(r.status)}`,
          href: HREF.content_item(r.id),
          state: null,
          content_item: { type: r.type, status: r.status },
        });
      }
      return out;
    }

    case 'book': {
      const rows = await db
        .select({ id: books.id, title: books.title, author: books.author, status: books.status })
        .from(books)
        .where(inArray(books.id, ids));
      for (const r of rows) {
        out.set(r.id, {
          title: r.title,
          subtitle: r.author ?? humanize(r.status),
          href: HREF.book(r.id),
          state: null,
          book: { author: r.author, status: r.status },
        });
      }
      return out;
    }

    case 'note': {
      const rows = await db
        .select({ id: notes.id, title: notes.title, body: notes.body })
        .from(notes)
        .where(inArray(notes.id, ids));
      for (const r of rows) {
        out.set(r.id, {
          title: r.title ?? excerpt(r.body, 80),
          subtitle: 'Note',
          href: HREF.note(r.id),
          state: null,
        });
      }
      return out;
    }

    case 'quote': {
      const rows = await db
        .select({ id: quotes.id, text: quotes.text, source_author: quotes.source_author })
        .from(quotes)
        .where(inArray(quotes.id, ids));
      for (const r of rows) {
        out.set(r.id, {
          title: excerpt(r.text, 100),
          subtitle: r.source_author ?? 'Quote',
          href: HREF.quote(r.id),
          state: null,
        });
      }
      return out;
    }

    case 'routine': {
      const rows = await db
        .select({ id: routines.id, name: routines.name, active: routines.active, archived_at: routines.archived_at })
        .from(routines)
        .where(inArray(routines.id, ids));
      // done_today in APP timezone — never the server-local date.
      const doneRows = rows.length
        ? await db
            .select({ routine_id: routine_completions.routine_id })
            .from(routine_completions)
            .where(and(inArray(routine_completions.routine_id, rows.map((r) => r.id)), eq(routine_completions.completed_date, today)))
        : [];
      const doneToday = new Set(doneRows.map((d) => d.routine_id));
      for (const r of rows) {
        const active = r.active && !r.archived_at;
        out.set(r.id, {
          title: r.name,
          subtitle: active ? 'Routine' : 'Routine · archived',
          href: HREF.routine(r.id),
          state: null,
          routine: { done_today: doneToday.has(r.id), active },
        });
      }
      return out;
    }
  }
}

// POST-time existence probe — one findFirst against the typed table.
async function targetExists(db: Db, type: PinTargetType, id: string): Promise<boolean> {
  const probe = async (table: any): Promise<boolean> => {
    const [row] = await db.select({ id: table.id }).from(table).where(eq(table.id, id)).limit(1);
    return !!row;
  };
  switch (type) {
    case 'task': return probe(tasks);
    case 'project': return probe(projects);
    case 'domain': return probe(stewardship_domains);
    case 'person': return probe(people);
    case 'company': return probe(companies);
    case 'content_item': return probe(content_items);
    case 'book': return probe(books);
    case 'note': return probe(notes);
    case 'quote': return probe(quotes);
    case 'routine': return probe(routines);
  }
}

export const pinRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.requireAuth);

  // GET /api/pins — all pins in position order, resolved. One batched query
  // per type present (bounded at 10 + one for routine completions). Pins
  // whose target no longer exists are excluded AND best-effort deleted, so
  // the panel self-heals without touching ten DELETE handlers.
  app.get('/api/pins', async () => {
    const db = getDb();
    const tz = await getAppTz();
    const today = todayInTz(tz);

    const pins = await db.select().from(pinned_items).orderBy(pinned_items.position, pinned_items.created_at);
    if (pins.length === 0) return { pins: [] };

    const byType = new Map<PinTargetType, string[]>();
    for (const p of pins) {
      const t = p.target_type as PinTargetType;
      byType.set(t, [...(byType.get(t) ?? []), p.target_id]);
    }

    const resolved = new Map<string, Resolved>(); // key: `${type}:${target_id}`
    await Promise.all(
      [...byType.entries()].map(async ([type, ids]) => {
        const m = await resolveType(db, type, ids, today);
        for (const [id, r] of m) resolved.set(`${type}:${id}`, r);
      }),
    );

    const out: ResolvedPin[] = [];
    const staleIds: string[] = [];
    for (const p of pins) {
      const r = resolved.get(`${p.target_type}:${p.target_id}`);
      if (!r) {
        staleIds.push(p.id);
        continue;
      }
      out.push({
        id: p.id,
        target_type: p.target_type as PinTargetType,
        target_id: p.target_id,
        position: p.position,
        ...r,
      });
    }

    if (staleIds.length) {
      // Best-effort cleanup — a failure here must never fail the read.
      try {
        await db.delete(pinned_items).where(inArray(pinned_items.id, staleIds));
      } catch (err) {
        app.log.warn({ err, staleIds }, 'stale pin cleanup failed');
      }
    }

    return { pins: out };
  });

  // GET /api/pins/lookup?target_type=&target_id= — cheap pin-state probe for
  // detail pages' pin button. No resolution work.
  app.get<{ Querystring: { target_type?: string; target_id?: string } }>(
    '/api/pins/lookup',
    async (req, reply) => {
      const parsed = TargetQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid_target' });
      }
      const [row] = await getDb()
        .select({ id: pinned_items.id })
        .from(pinned_items)
        .where(and(eq(pinned_items.target_type, parsed.data.target_type), eq(pinned_items.target_id, parsed.data.target_id)))
        .limit(1);
      return { pin: row ?? null };
    },
  );

  // POST /api/pins — pin a target. Idempotent: repinning an already-pinned
  // target is a 200 with the existing row, which keeps the detail-page
  // button dumb. New pins append at max+1.
  app.post('/api/pins', async (req, reply) => {
    const parsed = CreatePinSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_payload', details: parsed.error.flatten().fieldErrors });
    }
    const db = getDb();
    const { target_type, target_id } = parsed.data;

    if (!(await targetExists(db, target_type, target_id))) {
      return reply.code(404).send({ error: 'target_not_found' });
    }

    const [inserted] = await db
      .insert(pinned_items)
      .values({
        target_type,
        target_id,
        position: sql`coalesce((select max(position) from pinned_items), -1) + 1`,
      })
      .onConflictDoNothing({ target: [pinned_items.target_type, pinned_items.target_id] })
      .returning();
    if (inserted) return { pin: inserted };

    const [existing] = await db
      .select()
      .from(pinned_items)
      .where(and(eq(pinned_items.target_type, target_type), eq(pinned_items.target_id, target_id)))
      .limit(1);
    return { pin: existing };
  });

  // DELETE /api/pins?target_type=&target_id= — unpin. Idempotent 204 (the
  // detail page knows the target, not the pin row id).
  app.delete<{ Querystring: { target_type?: string; target_id?: string } }>(
    '/api/pins',
    async (req, reply) => {
      const parsed = TargetQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid_target' });
      }
      await getDb()
        .delete(pinned_items)
        .where(and(eq(pinned_items.target_type, parsed.data.target_type), eq(pinned_items.target_id, parsed.data.target_id)));
      return reply.code(204).send();
    },
  );

  // PATCH /api/pins/reorder — full ordered pin-id list; positions become the
  // list index. Ids in the DB but missing from the payload re-append after
  // the listed ones in their previous relative order (a stale client must
  // shuffle, never vanish, pins).
  app.patch('/api/pins/reorder', async (req, reply) => {
    const parsed = ReorderPinsSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_payload', details: parsed.error.flatten().fieldErrors });
    }
    const db = getDb();
    await db.transaction(async (tx) => {
      const all = await tx
        .select({ id: pinned_items.id })
        .from(pinned_items)
        .orderBy(pinned_items.position, pinned_items.created_at);
      const known = new Set(all.map((r) => r.id));
      const listed = parsed.data.ids.filter((id) => known.has(id));
      const listedSet = new Set(listed);
      const order = [...listed, ...all.map((r) => r.id).filter((id) => !listedSet.has(id))];
      for (let i = 0; i < order.length; i++) {
        await tx.update(pinned_items).set({ position: i }).where(eq(pinned_items.id, order[i]!));
      }
    });
    return reply.code(204).send();
  });
};
