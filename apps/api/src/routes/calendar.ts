import type { FastifyPluginAsync } from 'fastify';
import { listEvents, insertEvent, markSynced, loadTokens } from '../lib/google.js';
import { supabaseAdmin } from '../lib/supabase.js';

// Calendar sync:
//   POST /api/sync/calendar/pull  — fetch Google events for ±7 days, upsert
//     into calendar_events keyed on google_event_id.
//   GET  /api/calendar/upcoming   — next 4 events on or after now.
//
// Both are user-auth-gated. The Google API itself uses the service-role
// stored tokens (single user), but we still want the caller to be signed in.

export const calendarRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.requireAuth);

  // Manual pull. Cron version arrives in Phase 2.
  app.post('/api/sync/calendar/pull', async (req, reply) => {
    const tokens = await loadTokens();
    if (!tokens) {
      return reply.code(409).send({ error: 'google_not_connected' });
    }

    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const sevenDaysAhead = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    let events;
    try {
      events = await listEvents(sevenDaysAgo.toISOString(), sevenDaysAhead.toISOString());
    } catch (err) {
      req.log.error({ err }, 'google events.list failed');
      return reply.code(502).send({
        error: 'google_api_failed',
        message: err instanceof Error ? err.message : 'unknown',
      });
    }
    if (!events) {
      return reply.code(409).send({ error: 'google_not_connected' });
    }

    // Split cancelled from active. Cancelled events come back from Google
    // when showDeleted:true is set — they have just id + status:'cancelled',
    // no start/end. We delete local rows for those by google_event_id.
    const cancelledIds: string[] = [];
    const rows = events
      .filter((e) => Boolean(e.id))
      .map((e) => {
        if (e.status === 'cancelled') {
          cancelledIds.push(e.id!);
          return null;
        }
        if (!e.start || !e.end) return null;
        const isAllDay = Boolean(e.start?.date && !e.start?.dateTime);
        const start = e.start?.dateTime ?? (e.start?.date ? `${e.start.date}T00:00:00Z` : null);
        const end = e.end?.dateTime ?? (e.end?.date ? `${e.end.date}T00:00:00Z` : null);
        if (!start || !end) return null;
        return {
          google_event_id: e.id!,
          title: e.summary ?? '(untitled)',
          description: e.description ?? null,
          start_at: start,
          end_at: end,
          all_day: isAllDay,
          location: e.location ?? null,
          attendees: (e.attendees ?? []).map((a) => ({ email: a.email, response: a.responseStatus })),
          source: 'google' as const,
          synced_at: new Date().toISOString(),
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

    const sb = supabaseAdmin();

    let upsertedCount = 0;
    if (rows.length > 0) {
      const { error, count } = await sb
        .from('calendar_events')
        .upsert(rows, { onConflict: 'google_event_id', count: 'exact' });
      if (error) {
        req.log.error({ error }, 'calendar upsert failed');
        return reply.code(500).send({ error: 'upsert_failed', message: error.message });
      }
      upsertedCount = count ?? rows.length;
    }

    // Delete locals for events Google reports as cancelled.
    let deletedCount = 0;
    if (cancelledIds.length > 0) {
      const { error, count } = await sb
        .from('calendar_events')
        .delete({ count: 'exact' })
        .in('google_event_id', cancelledIds);
      if (error) {
        req.log.warn({ error }, 'cancellation delete failed (non-fatal)');
      } else {
        deletedCount = count ?? 0;
      }
    }

    // ─── Orphan push — local 'created_here' events that never reached
    // Google (e.g. created via voice before Google was connected). Push
    // each, store the returned google_event_id. ±30-day window so we
    // catch slightly older ones too.
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const thirtyDaysAhead = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const { data: orphans, error: orphanErr } = await sb
      .from('calendar_events')
      .select('id, title, description, start_at, end_at, location, attendees')
      .eq('source', 'created_here')
      .is('google_event_id', null)
      .gte('start_at', thirtyDaysAgo.toISOString())
      .lte('start_at', thirtyDaysAhead.toISOString());

    if (orphanErr) {
      req.log.warn({ orphanErr }, 'failed to query orphan events');
    }

    let pushedCount = 0;
    let pushFailures = 0;
    for (const orphan of orphans ?? []) {
      try {
        // Pull email strings out of the attendees jsonb if shaped that way.
        const attendees = Array.isArray(orphan.attendees)
          ? (orphan.attendees as Array<unknown>)
              .map((a) =>
                typeof a === 'string'
                  ? a
                  : a && typeof a === 'object' && 'email' in (a as Record<string, unknown>)
                  ? String((a as Record<string, unknown>).email)
                  : null,
              )
              .filter((s): s is string => Boolean(s))
          : undefined;

        const pushed = await insertEvent({
          summary: orphan.title,
          description: orphan.description ?? undefined,
          location: orphan.location ?? undefined,
          start: orphan.start_at,
          end: orphan.end_at,
          attendees,
        });
        if (pushed?.id) {
          await sb
            .from('calendar_events')
            .update({ google_event_id: pushed.id, synced_at: new Date().toISOString() })
            .eq('id', orphan.id);
          pushedCount += 1;
        } else {
          pushFailures += 1;
        }
      } catch (err) {
        pushFailures += 1;
        req.log.warn({ err, orphan_id: orphan.id }, 'orphan push failed');
      }
    }

    await markSynced();
    return reply.code(200).send({
      status: 'synced',
      events_fetched: events.length,
      events_upserted: upsertedCount,
      events_deleted: deletedCount,
      orphans_pushed: pushedCount,
      orphans_failed: pushFailures,
      window: { from: sevenDaysAgo.toISOString(), to: sevenDaysAhead.toISOString() },
    });
  });

  // Next N events for Today's "Up next" section.
  app.get<{ Querystring: { limit?: string } }>('/api/calendar/upcoming', async (req) => {
    const limit = Math.min(parseInt(req.query.limit ?? '4', 10) || 4, 20);
    const nowIso = new Date().toISOString();
    const { data, error } = await req.supabase!
      .from('calendar_events')
      .select('*')
      .gte('end_at', nowIso) // include events currently in progress
      .order('start_at', { ascending: true })
      .limit(limit);
    if (error) throw app.httpErrors.internalServerError(error.message);
    return { events: data ?? [] };
  });

  // Range list for the /calendar page. Defaults to ±30 days.
  app.get<{ Querystring: { from?: string; to?: string } }>('/api/calendar/events', async (req) => {
    const now = new Date();
    const defaultFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const defaultTo = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000).toISOString();
    const from = req.query.from ?? defaultFrom;
    const to = req.query.to ?? defaultTo;
    const { data, error } = await req.supabase!
      .from('calendar_events')
      .select('*')
      .gte('start_at', from)
      .lte('start_at', to)
      .order('start_at', { ascending: true })
      .limit(500);
    if (error) throw app.httpErrors.internalServerError(error.message);
    return { events: data ?? [], range: { from, to } };
  });
};
