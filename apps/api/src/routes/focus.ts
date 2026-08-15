import type { FastifyPluginAsync } from 'fastify';
import { eq } from 'drizzle-orm';
import { SetFocusSchema, type ResolvedFocus } from '@jevi-ops/shared/schemas';
import { getDb, type Db } from '../lib/db.js';
import { content_items, daily_focus, projects } from '../db/schema.js';
import { getAppTz } from '../lib/app-settings.js';
import { todayInTz, addDays } from '../lib/tz.js';

// /api/focus — Tomorrow's Focus. Ported from upstream jerad-ops v2.0.0
// (Addendum 09), re-expressed against Drizzle. Three endpoints, no ceremony:
// read one day's focus, upsert it, clear it. This is deliberately the whole
// feature: a pointer, not a flow. Nothing here counts, scores, or reports on
// whether a focus was ever set — see the schema comment.
//
// The target lives in one of two tables, so target_id carries no FK. We
// validate it against the typed table on write and resolve its title on read;
// a target that has since been deleted reads as null (the day renders no line)
// rather than 500ing.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Confirm the target exists and return its display title, or null.
async function resolveTarget(
  db: Db,
  targetType: 'project' | 'content_item',
  targetId: string,
): Promise<string | null> {
  if (targetType === 'project') {
    const row = await db.query.projects.findFirst({
      columns: { name: true },
      where: eq(projects.id, targetId),
    });
    return row?.name ?? null;
  }
  const row = await db.query.content_items.findFirst({
    columns: { title: true },
    where: eq(content_items.id, targetId),
  });
  return row?.title ?? null;
}

export const focusRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.requireAuth);

  // GET /api/focus?date=YYYY-MM-DD (defaults to today in app tz).
  // Returns { focus: ResolvedFocus | null }.
  app.get<{ Querystring: { date?: string } }>('/api/focus', async (req) => {
    const tz = await getAppTz();
    const date = req.query.date && DATE_RE.test(req.query.date)
      ? req.query.date
      : todayInTz(tz);

    const db = getDb();
    const row = await db.query.daily_focus.findFirst({
      where: eq(daily_focus.date, date),
    });
    if (!row) return { focus: null };

    const title = await resolveTarget(db, row.target_type as 'project' | 'content_item', row.target_id);
    // Target deleted since it was set — treat the day as unfocused rather
    // than rendering a dangling pointer.
    if (!title) return { focus: null };

    return { focus: { ...row, title } as ResolvedFocus };
  });

  // PUT /api/focus — upsert the focus for a date (defaults to TOMORROW, the
  // common case: you set it in the evening for the day ahead).
  app.put('/api/focus', async (req, reply) => {
    const parsed = SetFocusSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'invalid_payload',
        details: parsed.error.flatten().fieldErrors,
      });
    }
    const tz = await getAppTz();
    const date = parsed.data.date ?? addDays(todayInTz(tz), 1);

    const db = getDb();
    // The target must exist — a focus pointing at nothing is worse than none.
    const title = await resolveTarget(db, parsed.data.target_type, parsed.data.target_id);
    if (!title) return reply.code(400).send({ error: 'target_not_found' });

    // `note` is patch-style: only written when the caller actually sent the
    // key. The Work picker doesn't collect a note, so without this every tap
    // there would wipe a note set by voice ("tomorrow's focus is X, note …").
    // Sending an explicit null still clears it.
    const insert: typeof daily_focus.$inferInsert = {
      date,
      target_type: parsed.data.target_type,
      target_id: parsed.data.target_id,
    };
    const noteSent = req.body != null && typeof req.body === 'object' && 'note' in req.body;
    if (noteSent) insert.note = parsed.data.note ?? null;

    const updateSet: Partial<typeof daily_focus.$inferInsert> = {
      target_type: insert.target_type,
      target_id: insert.target_id,
    };
    if (noteSent) updateSet.note = insert.note ?? null;

    const [row] = await db
      .insert(daily_focus)
      .values(insert)
      .onConflictDoUpdate({ target: daily_focus.date, set: updateSet })
      .returning();
    if (!row) throw app.httpErrors.internalServerError('upsert_returned_no_row');

    return { focus: { ...row, title } as ResolvedFocus };
  });

  // DELETE /api/focus?date=YYYY-MM-DD — clear it. Unset is a first-class
  // state, not a failure. Defaults to tomorrow, matching PUT.
  app.delete<{ Querystring: { date?: string } }>('/api/focus', async (req, reply) => {
    const tz = await getAppTz();
    const date = req.query.date && DATE_RE.test(req.query.date)
      ? req.query.date
      : addDays(todayInTz(tz), 1);
    await getDb().delete(daily_focus).where(eq(daily_focus.date, date));
    return reply.code(204).send();
  });
};
