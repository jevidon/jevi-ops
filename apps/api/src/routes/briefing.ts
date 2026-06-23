import type { FastifyPluginAsync } from 'fastify';
import { getAppTz } from '../lib/app-settings.js';
import { computeDomainCadences, type CadenceRow } from '../lib/cadence.js';

// /api/briefing/today — the data layer for the new editorial home screen.
//
// Each domain that's behind cadence produces a BriefLine: a fact about
// neglect ("23 days since a journal entry"), a routing label, and the
// destination tab + a destination hint. Tone is strict — facts only, no
// advice. The page renders them as a newspaper column.
//
// We compute "days since" inline rather than relying on cron-written
// observations so the page always reads true at load time. A handful of
// "max(date)" queries is cheaper than the previous render loop anyway.
//
// Routines are folded in as additional brief lines when they're past
// their goal_days threshold (the user "missed the streak"). System
// domains (Inbox) are filtered out — slipping doesn't apply.

interface BriefLine {
  kind: 'domain' | 'routine';
  id: string;
  name: string;
  // The factual headline: "N days since X". The web renders the metric
  // big and the unit small; both come pre-formatted here so the UI
  // doesn't have to know the pluralization rules.
  metric: number;
  big: string;
  unit: string;
  // Cadence ratio = metric/cadence. >1 means past the threshold (the
  // accent-colored "slipping" state). <=0.7 means quiet but not slipping.
  cadence: number;
  ratio: number;
  status: 'slip' | 'stale';
  last: string | null; // short tail in ink-3, e.g. "Last entry May 31"
  // The one specific next action this line offers.
  next: string;
  routeTo: { href: string; label: string };
}

interface BriefingPayload {
  inbox_triage_count: number;
  brief_lines: BriefLine[];
  // Surface counts so the masthead can render the "4 events today — next
  // 10:30 Randy — Acme kickoff. 3 tasks set." anchor line.
  events_today_count: number;
  next_event: { time: string; title: string } | null;
  doing_today: {
    open_count: number;
    overdue_count: number;
    titles: string[]; // top 3 titles for the strip
  };
  routines_today: {
    total: number;
    done: number;
    remaining_names: string[];
  };
}

function cadenceRowToBriefLine(row: CadenceRow): BriefLine | null {
  // Brief lines only surface slipping/stale items — everything else is
  // quiet by design (the Briefing leads with what's slipping, not a
  // status board). The Domains pulse view shows the full set.
  if (row.status === 'ok' || row.status === 'unconfigured') return null;
  if (row.metric == null || row.cadence == null) return null;
  return {
    kind: 'domain',
    id: row.id,
    name: row.name,
    metric: row.metric,
    big: String(row.metric),
    unit: row.unit,
    cadence: row.cadence,
    ratio: row.ratio,
    status: row.status,
    last: row.last,
    next: row.next,
    routeTo: row.routeTo,
  };
}

export const briefingRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.requireAuth);

  app.get('/api/briefing/today', async (req) => {
    const sb = req.supabase!;
    const tz = await getAppTz();
    const nowIso = new Date().toISOString();
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());

    // INBOX_DOMAIN_ID lives in shared but we import it lazily here to keep
    // the import surface stable across the API/shared boundary.
    const INBOX_ID = 'acf035ee-b247-4c96-a07e-5946bc2b2e91';

    // Fan out the per-request fetches. The domain cadence computation
    // (shared helper) runs its own internal rollups in parallel; here we
    // just kick it off alongside the Today-specific queries.
    const [
      cadenceRows,
      inboxCountRes,
      eventsRes,
      openTasksRes,
      routinesRes,
    ] = await Promise.all([
      computeDomainCadences(sb),
      sb.from('tasks')
        .select('id', { count: 'exact', head: true })
        .eq('domain_id', INBOX_ID)
        .eq('status', 'open'),
      sb.from('calendar_events')
        .select('start_at, title')
        .gte('start_at', `${today}T00:00:00Z`)
        .lte('start_at', `${today}T23:59:59Z`)
        .order('start_at', { ascending: true }),
      sb.from('tasks')
        .select('id, title, due_date, top3_for_date')
        .eq('status', 'open'),
      sb.from('routines')
        .select('id, name, active, archived_at, last_done_date, time_of_day')
        .eq('active', true)
        .is('archived_at', null),
    ]);

    // ─── Brief lines — only slipping/stale cadence rows surface here. ──
    const briefLines: BriefLine[] = cadenceRows
      .map(cadenceRowToBriefLine)
      .filter((b): b is BriefLine => b !== null);

    // ─── Inbox count ───────────────────────────────────────────────────
    const inboxCount = inboxCountRes.count ?? 0;

    // ─── Commitments anchor data ──────────────────────────────────────
    type Event = { start_at: string; title: string };
    const events = (eventsRes.data ?? []) as Event[];
    const nextEvent = events[0]
      ? {
          time: new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(events[0].start_at)),
          title: events[0].title,
        }
      : null;

    // ─── Doing today ───────────────────────────────────────────────────
    // Surface a usable preview of what's actionable, in priority order:
    // overdue first (most urgent), then today's due-list, then user-pinned
    // top-3. Without overdue in the strip a user with no due-today / no
    // top-3 task would see "Nothing pinned for today." even when work is
    // visibly past deadline — bad UX.
    type Task = { id: string; title: string; due_date: string | null; top3_for_date: string | null };
    const openTasks = (openTasksRes.data ?? []) as Task[];
    const overdue = openTasks
      .filter((t) => t.due_date && t.due_date < today)
      .sort((a, b) => (a.due_date ?? '').localeCompare(b.due_date ?? ''));
    const top3 = openTasks.filter((t) => t.top3_for_date === today);
    const dueToday = openTasks.filter((t) => t.due_date === today && !top3.find((s) => s.id === t.id));
    const seen = new Set<string>();
    const doingTitles: string[] = [];
    for (const t of [...overdue, ...top3, ...dueToday]) {
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      doingTitles.push(t.title);
      if (doingTitles.length >= 3) break;
    }

    // ─── Routines for today ────────────────────────────────────────────
    type Routine = { id: string; name: string; last_done_date: string | null };
    const routines = (routinesRes.data ?? []) as Routine[];
    const doneRoutines = routines.filter((r) => r.last_done_date === today);
    const remainingRoutines = routines.filter((r) => r.last_done_date !== today);

    const payload: BriefingPayload = {
      inbox_triage_count: inboxCount,
      brief_lines: briefLines,
      events_today_count: events.length,
      next_event: nextEvent,
      doing_today: {
        open_count: openTasks.length,
        overdue_count: overdue.length,
        titles: doingTitles,
      },
      routines_today: {
        total: routines.length,
        done: doneRoutines.length,
        remaining_names: remainingRoutines.slice(0, 3).map((r) => r.name),
      },
    };

    return payload;
  });

  // /api/briefing/domains — full cadence list for the Domains pulse
  // board. Returns every active non-system domain with its cadence row
  // (slip / stale / ok / unconfigured), sorted worst-first.
  app.get('/api/briefing/domains', async (req) => {
    const sb = req.supabase!;
    const rows = await computeDomainCadences(sb);
    return { domains: rows };
  });
};
