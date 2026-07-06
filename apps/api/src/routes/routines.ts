import type { FastifyPluginAsync } from 'fastify';
import { and, asc, count, desc, eq, sql } from 'drizzle-orm';
import {
  CreateRoutineSchema, UpdateRoutineSchema, ToggleCompletionSchema,
} from '@jevi-ops/shared/schemas';
import { computeRoutineStats } from '@jevi-ops/shared';
import { getAppTz } from '../lib/app-settings.js';
import { getDb } from '../lib/db.js';
import { routine_completions, routines } from '../db/schema.js';

// Routines + completions. Daily habits (read Bible, take meds…) live
// here instead of in tasks because they have different semantics — no
// due date, no priority, no project, no reminders. The daily reset is
// implicit: "did I do it today" is just "does a completion row exist
// for today's date".

// Build a YYYY-MM-DD for "today" in the app TZ. Doing this server-side
// keeps every consumer (today widget, routines list, daily summary cron)
// agreeing on what "today" means.
function todayIso(tz: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${g('year')}-${g('month')}-${g('day')}`;
}

// Pull completions back ~120 days. 30 for the heatmap + plenty of buffer
// for streak detection past the visible window. Keeps the payload small
// for the today widget while staying correct for long streaks.
const COMPLETIONS_WINDOW_DAYS = 120;
function lookbackIso(days: number, tz: string): string {
  const today = todayIso(tz);
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

export const routineRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.requireAuth);

  // ─── List routines + per-routine stats ────────────────────────────────
  //
  // Joins recent completions so the client gets stats in one round-trip.
  // We compute stats server-side because the API also exposes them to
  // the daily-summary cron and we want one source of truth.

  app.get<{ Querystring: { include_archived?: string } }>(
    '/api/routines',
    async (req) => {
      const includeArchived = req.query.include_archived === 'true';
      const rows = await getDb().query.routines.findMany({
        with: { completions: { columns: { completed_date: true } } },
        where: includeArchived ? undefined : eq(routines.active, true),
        orderBy: [asc(routines.position), asc(routines.created_at)],
      });

      const tz = await getAppTz();
      const today = todayIso(tz);
      const cutoff = lookbackIso(COMPLETIONS_WINDOW_DAYS, tz);
      const routineRows = rows.map((r) => {
        // Trim the embedded completions to our window (filter in JS —
        // matches the pre-fork response shape).
        const dates = (r.completions ?? [])
          .map((c) => c.completed_date)
          .filter((d) => d >= cutoff);
        const stats = computeRoutineStats(dates, today);
        return {
          ...r,
          completions: undefined,
          recent_completions: dates,
          stats,
        };
      });
      return { routines: routineRows, today };
    },
  );

  app.get<{ Params: { id: string } }>('/api/routines/:id', async (req, reply) => {
    const id = req.params.id;
    const db = getDb();
    const [routine, completions] = await Promise.all([
      db.query.routines.findFirst({ where: eq(routines.id, id) }),
      // Pull ALL completions for the detail view — the heatmap is 30d
      // but lifetime stats need the full history. We don't paginate;
      // even at one row/day for 10 years that's <4000 rows.
      db.query.routine_completions.findMany({
        columns: { completed_date: true },
        where: eq(routine_completions.routine_id, id),
        orderBy: desc(routine_completions.completed_date),
      }),
    ]);
    if (!routine) return reply.code(404).send({ error: 'not_found' });

    const tz = await getAppTz();
    const today = todayIso(tz);
    const dates = completions.map((c) => c.completed_date);
    return {
      routine,
      completions: dates,
      stats: computeRoutineStats(dates, today),
      today,
    };
  });

  app.post('/api/routines', async (req, reply) => {
    const parsed = CreateRoutineSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_payload', details: parsed.error.flatten().fieldErrors });
    }
    const db = getDb();
    // Default position = end of the active list, so new routines append.
    let position = parsed.data.position;
    if (position == null) {
      const [row] = await db.select({ n: count() }).from(routines).where(eq(routines.active, true));
      position = row?.n ?? 0;
    }
    const insert: typeof routines.$inferInsert = {
      name: parsed.data.name,
      description: parsed.data.description,
      position,
    };
    if (parsed.data.time_of_day) insert.time_of_day = parsed.data.time_of_day;
    if (parsed.data.specific_time !== undefined) insert.specific_time = parsed.data.specific_time;
    if (parsed.data.goal_days !== undefined) insert.goal_days = parsed.data.goal_days;
    // Defensive: reminders only make sense with a specific_time. If the
    // caller asked for reminders without a time, silently disable rather
    // than rejecting — the form should enforce it but a stale client
    // shouldn't 400.
    if (parsed.data.reminder_enabled && parsed.data.specific_time) {
      insert.reminder_enabled = true;
    } else if (parsed.data.reminder_enabled === false) {
      insert.reminder_enabled = false;
    }
    const [row] = await db.insert(routines).values(insert).returning();
    if (!row) throw app.httpErrors.internalServerError('insert_returned_no_row');
    return reply.code(201).send(row);
  });

  app.patch<{ Params: { id: string } }>('/api/routines/:id', async (req, reply) => {
    const parsed = UpdateRoutineSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_payload', details: parsed.error.flatten().fieldErrors });
    }
    if (Object.keys(parsed.data).length === 0) {
      return reply.code(400).send({ error: 'empty_payload' });
    }
    const db = getDb();
    const update: Partial<typeof routines.$inferInsert> = { ...parsed.data };
    // Reminders require a specific_time. If the caller is clearing
    // specific_time (sending null), also disable reminders — otherwise
    // we'd have a row that says "remind me at null o'clock" which the
    // cron just skips, but the UI checkbox would look stuck-on.
    if ('specific_time' in update && update.specific_time === null) {
      update.reminder_enabled = false;
    }
    // Conversely: if the caller turns reminders on but didn't include
    // (or also set null) a specific_time, ignore the toggle.
    if (
      update.reminder_enabled === true &&
      (('specific_time' in update && update.specific_time === null) ||
        (!('specific_time' in update)))
    ) {
      // Look up the existing row to see if it has a specific_time we can
      // pair the reminder with.
      const existing = await db.query.routines.findFirst({
        columns: { specific_time: true },
        where: eq(routines.id, req.params.id),
      });
      if (!existing?.specific_time) update.reminder_enabled = false;
    }
    const [row] = await db
      .update(routines)
      .set(update)
      .where(eq(routines.id, req.params.id))
      .returning();
    if (!row) return reply.code(404).send({ error: 'not_found' });
    return row;
  });

  app.delete<{ Params: { id: string } }>('/api/routines/:id', async (req, reply) => {
    // Hard delete cascades to completions. The UI nudges toward soft
    // delete (archive — sets active=false) so streak history is preserved
    // when you re-activate.
    await getDb().delete(routines).where(eq(routines.id, req.params.id));
    return reply.code(204).send();
  });

  // ─── Toggle completion ───────────────────────────────────────────────
  //
  // POST /api/routines/:id/completions { date?, done? }
  //   done=true  (default) → upsert row, no-op if it already exists
  //   done=false           → delete row
  //
  // Upsert keeps the API idempotent — checking a checked routine is a 200
  // with the existing row, not an error. The web client can fire and
  // forget without checking state.

  app.post<{ Params: { id: string } }>(
    '/api/routines/:id/completions',
    async (req, reply) => {
      const parsed = ToggleCompletionSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid_payload', details: parsed.error.flatten().fieldErrors });
      }
      const tz = await getAppTz();
      const date = parsed.data.date ?? todayIso(tz);
      const done = parsed.data.done !== false;
      const db = getDb();

      if (done) {
        const [row] = await db
          .insert(routine_completions)
          .values({ routine_id: req.params.id, completed_date: date })
          .onConflictDoUpdate({
            target: [routine_completions.routine_id, routine_completions.completed_date],
            set: { completed_date: sql`excluded.completed_date` },
          })
          .returning();
        if (!row) throw app.httpErrors.internalServerError('upsert_returned_no_row');

        // If this routine has a goal AND isn't already archived AND
        // the current streak just hit/crossed the goal, auto-archive it.
        // The client gets `archived: true` in the response so it can show
        // a celebratory state.
        let archived = false;
        const r = await db.query.routines.findFirst({
          columns: { goal_days: true, archived_at: true },
          where: eq(routines.id, req.params.id),
        });
        if (r?.goal_days && !r.archived_at) {
          const completions = await db.query.routine_completions.findMany({
            columns: { completed_date: true },
            where: eq(routine_completions.routine_id, req.params.id),
            orderBy: desc(routine_completions.completed_date),
            limit: r.goal_days + 30,
          });
          const dates = completions.map((c) => c.completed_date);
          const stats = computeRoutineStats(dates, todayIso(tz));
          if (stats.current_streak >= r.goal_days) {
            try {
              await db
                .update(routines)
                .set({ active: false, archived_at: new Date().toISOString() })
                .where(eq(routines.id, req.params.id));
              archived = true;
            } catch {
              /* best-effort — the completion row is what matters */
            }
          }
        }
        return reply.code(201).send({ ...row, archived });
      } else {
        await db
          .delete(routine_completions)
          .where(and(
            eq(routine_completions.routine_id, req.params.id),
            eq(routine_completions.completed_date, date),
          ));
        return reply.code(204).send();
      }
    },
  );
};
