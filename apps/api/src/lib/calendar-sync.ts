import { and, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import { listEvents, insertEvent, markSynced, loadTokens } from './google.js';
import { getDb } from './db.js';
import { calendar_events } from '../db/schema.js';

// Calendar sync — pulls ±7 days from Google, upserts local events,
// deletes cancellations, and pushes any locally-created orphans
// (events made via voice before Google was connected). Extracted from
// the manual /api/sync/calendar/pull handler so the same logic can
// run on cron without duplication.

// Minimal logger shape so the function can accept Fastify's req.log
// or a noop in tests. Methods are optional — calls are guarded.
interface Logger {
  info?: (obj: object, msg?: string) => void;
  warn?: (obj: object, msg?: string) => void;
  error?: (obj: object, msg?: string) => void;
}

export type CalendarSyncOutcome =
  | { ok: true; status: 'synced'; events_fetched: number; events_upserted: number;
      events_deleted: number; orphans_pushed: number; orphans_failed: number;
      window: { from: string; to: string } }
  | { ok: false; status: 'not_connected' | 'api_failed' | 'upsert_failed'; message?: string };

export async function runCalendarSync(logger: Logger = {}): Promise<CalendarSyncOutcome> {
  const tokens = await loadTokens();
  if (!tokens) {
    return { ok: false, status: 'not_connected' };
  }

  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const sevenDaysAhead = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  let events;
  try {
    events = await listEvents(sevenDaysAgo.toISOString(), sevenDaysAhead.toISOString());
  } catch (err) {
    logger.error?.({ err }, 'google events.list failed');
    return {
      ok: false,
      status: 'api_failed',
      message: err instanceof Error ? err.message : 'unknown',
    };
  }
  if (!events) {
    return { ok: false, status: 'not_connected' };
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

  const db = getDb();

  let upsertedCount = 0;
  if (rows.length > 0) {
    try {
      const upserted = await db
        .insert(calendar_events)
        .values(rows)
        .onConflictDoUpdate({
          target: calendar_events.google_event_id,
          set: {
            title: sql`excluded.title`,
            description: sql`excluded.description`,
            start_at: sql`excluded.start_at`,
            end_at: sql`excluded.end_at`,
            all_day: sql`excluded.all_day`,
            location: sql`excluded.location`,
            attendees: sql`excluded.attendees`,
            source: sql`excluded.source`,
            synced_at: sql`excluded.synced_at`,
          },
        })
        .returning({ id: calendar_events.id });
      upsertedCount = upserted.length;
    } catch (err) {
      logger.error?.({ err }, 'calendar upsert failed');
      return { ok: false, status: 'upsert_failed', message: err instanceof Error ? err.message : 'unknown' };
    }
  }

  let deletedCount = 0;
  if (cancelledIds.length > 0) {
    try {
      const deleted = await db
        .delete(calendar_events)
        .where(inArray(calendar_events.google_event_id, cancelledIds))
        .returning({ id: calendar_events.id });
      deletedCount = deleted.length;
    } catch (err) {
      logger.warn?.({ err }, 'cancellation delete failed (non-fatal)');
    }
  }

  // Orphan push — local 'created_here' events that never reached Google
  // (e.g. created via voice before Google was connected). ±30-day window.
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const thirtyDaysAhead = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  let orphans: Array<{
    id: string; title: string; description: string | null; start_at: string;
    end_at: string; location: string | null; attendees: unknown;
  }> = [];
  try {
    orphans = await db.query.calendar_events.findMany({
      columns: {
        id: true, title: true, description: true, start_at: true,
        end_at: true, location: true, attendees: true,
      },
      where: and(
        eq(calendar_events.source, 'created_here'),
        isNull(calendar_events.google_event_id),
        gte(calendar_events.start_at, thirtyDaysAgo.toISOString()),
        lte(calendar_events.start_at, thirtyDaysAhead.toISOString()),
      ),
    });
  } catch (err) {
    logger.warn?.({ err }, 'failed to query orphan events');
  }

  let pushedCount = 0;
  let pushFailures = 0;
  for (const orphan of orphans) {
    try {
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
        await db
          .update(calendar_events)
          .set({ google_event_id: pushed.id, synced_at: new Date().toISOString() })
          .where(eq(calendar_events.id, orphan.id));
        pushedCount += 1;
      } else {
        pushFailures += 1;
      }
    } catch (err) {
      pushFailures += 1;
      logger.warn?.({ err, orphan_id: orphan.id }, 'orphan push failed');
    }
  }

  await markSynced();

  return {
    ok: true,
    status: 'synced',
    events_fetched: events.length,
    events_upserted: upsertedCount,
    events_deleted: deletedCount,
    orphans_pushed: pushedCount,
    orphans_failed: pushFailures,
    window: { from: sevenDaysAgo.toISOString(), to: sevenDaysAhead.toISOString() },
  };
}
