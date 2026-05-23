import type { FastifyPluginAsync } from 'fastify';
import {
  CreateRoutineSchema, UpdateRoutineSchema, ToggleCompletionSchema,
} from '@jerad-ops/shared/schemas';
import { computeRoutineStats } from '@jerad-ops/shared';

// Routines + completions. Daily habits (read Bible, take meds…) live
// here instead of in tasks because they have different semantics — no
// due date, no priority, no project, no reminders. The daily reset is
// implicit: "did I do it today" is just "does a completion row exist
// for today's date".

// Build a YYYY-MM-DD for "today" in America/Denver. Same TZ pin as the
// rest of the app. Doing this server-side keeps every consumer (today
// widget, routines list, daily summary cron) agreeing on what "today"
// means.
const APP_TZ = 'America/Denver';
function todayIso(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${g('year')}-${g('month')}-${g('day')}`;
}

// Pull completions back ~120 days. 30 for the heatmap + plenty of buffer
// for streak detection past the visible window. Keeps the payload small
// for the today widget while staying correct for long streaks.
const COMPLETIONS_WINDOW_DAYS = 120;
function lookbackIso(days: number): string {
  const today = todayIso();
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
      let q = req.supabase!
        .from('routines')
        .select('*, completions:routine_completions(completed_date)')
        .order('position', { ascending: true })
        .order('created_at', { ascending: true });
      if (!includeArchived) q = q.eq('active', true);
      const { data, error } = await q;
      if (error) throw app.httpErrors.internalServerError(error.message);

      const today = todayIso();
      const cutoff = lookbackIso(COMPLETIONS_WINDOW_DAYS);
      type Row = {
        id: string;
        completions?: { completed_date: string }[];
        [k: string]: unknown;
      };
      const routines = ((data ?? []) as Row[]).map((r) => {
        // Trim the embedded completions to our window. Supabase's nested
        // select doesn't accept a filter, so we filter in JS.
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
      return { routines, today };
    },
  );

  app.get<{ Params: { id: string } }>('/api/routines/:id', async (req, reply) => {
    const id = req.params.id;
    const sb = req.supabase!;
    const [routineRes, completionsRes] = await Promise.all([
      sb.from('routines').select('*').eq('id', id).maybeSingle(),
      // Pull ALL completions for the detail view — the heatmap is 30d
      // but lifetime stats need the full history. We don't paginate;
      // even at one row/day for 10 years that's <4000 rows.
      sb.from('routine_completions').select('completed_date').eq('routine_id', id).order('completed_date', { ascending: false }),
    ]);
    if (routineRes.error) throw app.httpErrors.internalServerError(routineRes.error.message);
    if (!routineRes.data) return reply.code(404).send({ error: 'not_found' });
    if (completionsRes.error) throw app.httpErrors.internalServerError(completionsRes.error.message);

    const today = todayIso();
    const dates = (completionsRes.data ?? []).map((c) => c.completed_date);
    return {
      routine: routineRes.data,
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
    // Default position = end of the active list, so new routines append.
    let position = parsed.data.position;
    if (position == null) {
      const { count } = await req.supabase!
        .from('routines')
        .select('id', { count: 'exact', head: true })
        .eq('active', true);
      position = count ?? 0;
    }
    const insert: Record<string, unknown> = {
      name: parsed.data.name,
      description: parsed.data.description,
      position,
    };
    if (parsed.data.time_of_day) insert.time_of_day = parsed.data.time_of_day;
    if (parsed.data.specific_time !== undefined) insert.specific_time = parsed.data.specific_time;
    // Defensive: reminders only make sense with a specific_time. If the
    // caller asked for reminders without a time, silently disable rather
    // than rejecting — the form should enforce it but a stale client
    // shouldn't 400.
    if (parsed.data.reminder_enabled && parsed.data.specific_time) {
      insert.reminder_enabled = true;
    } else if (parsed.data.reminder_enabled === false) {
      insert.reminder_enabled = false;
    }
    const { data, error } = await req.supabase!
      .from('routines')
      .insert(insert)
      .select('*')
      .single();
    if (error) throw app.httpErrors.internalServerError(error.message);
    return reply.code(201).send(data);
  });

  app.patch<{ Params: { id: string } }>('/api/routines/:id', async (req, reply) => {
    const parsed = UpdateRoutineSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_payload', details: parsed.error.flatten().fieldErrors });
    }
    if (Object.keys(parsed.data).length === 0) {
      return reply.code(400).send({ error: 'empty_payload' });
    }
    const update: Record<string, unknown> = { ...parsed.data };
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
      const { data: existing } = await req.supabase!
        .from('routines')
        .select('specific_time')
        .eq('id', req.params.id)
        .maybeSingle();
      if (!existing?.specific_time) update.reminder_enabled = false;
    }
    const { data, error } = await req.supabase!
      .from('routines')
      .update(update)
      .eq('id', req.params.id)
      .select('*')
      .single();
    if (error) throw app.httpErrors.internalServerError(error.message);
    return data;
  });

  app.delete<{ Params: { id: string } }>('/api/routines/:id', async (req, reply) => {
    // Hard delete cascades to completions. The UI nudges toward soft
    // delete (archive — sets active=false) so streak history is preserved
    // when you re-activate.
    const { error } = await req.supabase!.from('routines').delete().eq('id', req.params.id);
    if (error) throw app.httpErrors.internalServerError(error.message);
    return reply.code(204).send();
  });

  // ─── Toggle completion ───────────────────────────────────────────────
  //
  // POST /api/routines/:id/completions { date?, done? }
  //   done=true  (default) → upsert row, no-op if it already exists
  //   done=false           → delete row
  //
  // We use upsert with ignoreDuplicates so the API stays idempotent —
  // checking a checked routine is a 200 with the existing row, not an
  // error. The web client can fire and forget without checking state.

  app.post<{ Params: { id: string } }>(
    '/api/routines/:id/completions',
    async (req, reply) => {
      const parsed = ToggleCompletionSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid_payload', details: parsed.error.flatten().fieldErrors });
      }
      const date = parsed.data.date ?? todayIso();
      const done = parsed.data.done !== false;

      if (done) {
        const { data, error } = await req.supabase!
          .from('routine_completions')
          .upsert(
            { routine_id: req.params.id, completed_date: date },
            { onConflict: 'routine_id,completed_date', ignoreDuplicates: false },
          )
          .select('*')
          .single();
        if (error) throw app.httpErrors.internalServerError(error.message);
        return reply.code(201).send(data);
      } else {
        const { error } = await req.supabase!
          .from('routine_completions')
          .delete()
          .eq('routine_id', req.params.id)
          .eq('completed_date', date);
        if (error) throw app.httpErrors.internalServerError(error.message);
        return reply.code(204).send();
      }
    },
  );
};
