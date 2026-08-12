import type { FastifyPluginAsync } from 'fastify';
import { and, asc, count, desc, eq, gte, inArray, isNull, lte } from 'drizzle-orm';
import { getAppTz } from '../lib/app-settings.js';
import { computeDomainCadences, type CadenceRow } from '../lib/cadence.js';
import { getDb } from '../lib/db.js';
import {
  calendar_events,
  projects,
  quotes,
  routine_completions,
  routines as routinesTable,
  tasks,
} from '../db/schema.js';

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
// Routines are folded in via routine_completions for today. (The pre-fork
// code read a nonexistent routines.last_done_date column — the query
// silently failed and routines_today always reported zeros. Fixed here.)

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

// Per-domain workload attached to each Domains-pulse row. `next_due` is
// the earliest dated open task — overdue included, since the most-overdue
// item is exactly what the board should confess first.
interface DomainStats {
  projects: number;   // projects with status = 'active'
  open_tasks: number; // tasks with status = 'open'
  overdue: number;    // open tasks due before today
  due_soon: number;   // open tasks due today through +7 days
  next_due: { date: string; title: string } | null;
}

interface LatestQuote {
  id: string;
  text: string;
  source_author: string | null;
  source_reference: string | null;
  source_url: string | null;
  href: string;
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
  // The single newest quote in the library, regardless of resurface
  // weight. Stays put on the Today page until a newer quote gets added
  // — distinct from `Resurfaced` which date-seeded-rotates daily.
  latest_quote: LatestQuote | null;
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

  app.get('/api/briefing/today', async () => {
    const db = getDb();
    const tz = await getAppTz();
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
      inboxCountRows,
      events,
      openTasks,
      activeRoutines,
      latestQuoteRows,
    ] = await Promise.all([
      computeDomainCadences(db),
      db.select({ n: count() }).from(tasks)
        .where(and(eq(tasks.domain_id, INBOX_ID), eq(tasks.status, 'open'))),
      db.query.calendar_events.findMany({
        columns: { start_at: true, title: true },
        where: and(
          gte(calendar_events.start_at, `${today}T00:00:00Z`),
          lte(calendar_events.start_at, `${today}T23:59:59Z`),
        ),
        orderBy: asc(calendar_events.start_at),
      }),
      db.query.tasks.findMany({
        columns: { id: true, title: true, due_date: true, top3_for_date: true },
        where: eq(tasks.status, 'open'),
      }),
      db.query.routines.findMany({
        columns: { id: true, name: true },
        where: and(eq(routinesTable.active, true), isNull(routinesTable.archived_at)),
      }),
      db.query.quotes.findMany({
        columns: { id: true, text: true, source_author: true, source_reference: true, source_url: true },
        orderBy: desc(quotes.created_at),
        limit: 1,
      }),
    ]);

    // ─── Brief lines — only slipping/stale cadence rows surface here. ──
    const briefLines: BriefLine[] = cadenceRows
      .map(cadenceRowToBriefLine)
      .filter((b): b is BriefLine => b !== null);

    // ─── Inbox count ───────────────────────────────────────────────────
    const inboxCount = inboxCountRows[0]?.n ?? 0;

    // ─── Commitments anchor data ──────────────────────────────────────
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

    // ─── Routines for today (done-ness from routine_completions) ───────
    let doneIds = new Set<string>();
    if (activeRoutines.length > 0) {
      const doneRows = await db.query.routine_completions.findMany({
        columns: { routine_id: true },
        where: and(
          inArray(routine_completions.routine_id, activeRoutines.map((r) => r.id)),
          eq(routine_completions.completed_date, today),
        ),
      });
      doneIds = new Set(doneRows.map((r) => r.routine_id));
    }
    const remainingRoutines = activeRoutines.filter((r) => !doneIds.has(r.id));

    // ─── Latest quote — newest by created_at, regardless of weight. ────
    // Stays put on the Today page until the user saves a newer quote;
    // distinct from Resurfaced (date-seeded daily rotation).
    const lq = latestQuoteRows[0] ?? null;
    const latestQuote: LatestQuote | null = lq
      ? {
          id: lq.id,
          text: lq.text ?? '',
          source_author: lq.source_author ?? null,
          source_reference: lq.source_reference ?? null,
          source_url: lq.source_url ?? null,
          href: `/library/quotes/${lq.id}`,
        }
      : null;

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
        total: activeRoutines.length,
        done: doneIds.size,
        remaining_names: remainingRoutines.slice(0, 3).map((r) => r.name),
      },
      latest_quote: latestQuote,
    };

    return payload;
  });

  // /api/briefing/domains — full cadence list for the Domains pulse
  // board. Returns every active non-system domain with its cadence row
  // (slip / stale / ok / unconfigured), sorted worst-first, plus a
  // per-domain workload rollup: active projects, open tasks, and the
  // time-sensitive slice (overdue / due within 7 days). One tasks scan
  // + one projects scan covers every domain — cheaper than N per-domain
  // queries and always true at load time.
  app.get('/api/briefing/domains', async () => {
    const db = getDb();
    const tz = await getAppTz();
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());
    // due_date is a plain ISO date string; UTC-anchored day math is safe.
    const soonCutoff = new Date(new Date(`${today}T00:00:00Z`).getTime() + 7 * 86_400_000)
      .toISOString()
      .slice(0, 10);

    const [rows, activeProjects, openTasks] = await Promise.all([
      computeDomainCadences(db),
      db.query.projects.findMany({
        columns: { domain_id: true },
        where: eq(projects.status, 'active'),
      }),
      db.query.tasks.findMany({
        columns: { domain_id: true, due_date: true, title: true },
        where: eq(tasks.status, 'open'),
      }),
    ]);

    const stats = new Map<string, DomainStats>();
    const statFor = (id: string): DomainStats => {
      let s = stats.get(id);
      if (!s) {
        s = { projects: 0, open_tasks: 0, overdue: 0, due_soon: 0, next_due: null };
        stats.set(id, s);
      }
      return s;
    };
    for (const p of activeProjects) {
      if (p.domain_id) statFor(p.domain_id).projects += 1;
    }
    for (const t of openTasks) {
      const s = statFor(t.domain_id);
      s.open_tasks += 1;
      if (!t.due_date) continue;
      if (t.due_date < today) s.overdue += 1;
      else if (t.due_date <= soonCutoff) s.due_soon += 1;
      if (!s.next_due || t.due_date < s.next_due.date) {
        s.next_due = { date: t.due_date, title: t.title };
      }
    }

    return {
      domains: rows.map((r) => ({
        ...r,
        stats: stats.get(r.id) ?? {
          projects: 0, open_tasks: 0, overdue: 0, due_soon: 0, next_due: null,
        },
      })),
    };
  });
};
