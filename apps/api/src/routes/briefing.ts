import type { FastifyPluginAsync } from 'fastify';
import { and, asc, count, desc, eq, gte, inArray, isNull, lt, lte, or } from 'drizzle-orm';
import { getAppSettings, getAppTz } from '../lib/app-settings.js';
import { computeDomainCadences, type CadenceRow } from '../lib/cadence.js';
import { getDb } from '../lib/db.js';
import { addDays, dayWindowUtc, todayInTz } from '../lib/tz.js';
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

// ─── Agenda bundle helpers ────────────────────────────────────────────────
// Mirror of the web's panel registry (apps/web/src/app/(authed)/_briefing/
// registry.tsx): id, column and default, in registry order. KEEP IN SYNC —
// the phone renders panels from this list in the user's stored order.
const PANEL_REGISTRY: Array<{ id: string; column: 'main' | 'rail'; defaultEnabled: boolean; moduleFlag?: 'health_module_enabled' | 'routines_module_enabled' }> = [
  { id: 'frame', column: 'main', defaultEnabled: true },
  { id: 'weather', column: 'main', defaultEnabled: true },
  { id: 'domain-pulse', column: 'main', defaultEnabled: true },
  { id: 'silent-clients', column: 'main', defaultEnabled: true },
  { id: 'attention', column: 'main', defaultEnabled: true },
  { id: 'reflection', column: 'main', defaultEnabled: true },
  { id: 'latest-quote', column: 'main', defaultEnabled: true },
  { id: 'pinned', column: 'rail', defaultEnabled: true },
  { id: 'agenda', column: 'rail', defaultEnabled: true },
  { id: 'doing', column: 'rail', defaultEnabled: true },
  { id: 'health', column: 'rail', defaultEnabled: true, moduleFlag: 'health_module_enabled' },
  { id: 'routines', column: 'rail', defaultEnabled: true, moduleFlag: 'routines_module_enabled' },
];

function mergePanels(
  stored: Array<{ id: string; enabled: boolean }> | null,
  flags: { health_module_enabled: boolean; routines_module_enabled: boolean },
) {
  const byId = new Map(PANEL_REGISTRY.map((p) => [p.id, p]));
  const out: Array<{ id: string; column: 'main' | 'rail'; enabled: boolean }> = [];
  for (const e of stored ?? []) {
    const def = byId.get(e.id);
    if (def && !out.some((x) => x.id === def.id)) {
      out.push({ id: def.id, column: def.column, enabled: e.enabled && (!def.moduleFlag || flags[def.moduleFlag]) });
    }
  }
  for (const p of PANEL_REGISTRY) {
    if (!out.some((x) => x.id === p.id)) {
      out.push({ id: p.id, column: p.column, enabled: p.defaultEnabled && (!p.moduleFlag || flags[p.moduleFlag]) });
    }
  }
  return out;
}

function mastheadDate(tz: string): string {
  const d = new Date();
  const isoDate = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  const w = new Date(isoDate + 'T00:00:00Z');
  w.setUTCDate(w.getUTCDate() + 4 - (w.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(w.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((w.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return d.toLocaleDateString('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: '2-digit' }).toUpperCase() + ` · WEEK ${week}`;
}

// The frame's data bundle (weather), fetched server-side with a short cache
// so a phone refresh never hammers the device.
const frameCache = new Map<string, { at: number; value: unknown }>();
async function fetchFrameBundle(url: string): Promise<unknown> {
  const cached = frameCache.get(url);
  if (cached && Date.now() - cached.at < 5 * 60_000) return cached.value;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    const value = res.ok ? await res.json() : null;
    frameCache.set(url, { at: Date.now(), value });
    return value;
  } catch {
    return null;
  }
}

interface AttentionRow { rule_type: string; urgency: string; [key: string]: unknown }
interface RoutineRow { active: boolean; archived_at: string | null; stats?: { done_today?: boolean }; [key: string]: unknown }
interface FocusRow { target_type: string; target_id: string; title: string; note?: string | null }
interface TaskRow { id: string; status: string; due_date: string | null; top3_for_date: string | null; created_at: string; [key: string]: unknown }

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
      // Timed events use the app-tz day window, not a raw UTC one — a
      // `${today}T00:00:00Z` window is the UTC day, which dropped evening
      // events in America/Denver. All-day events are stored AT UTC midnight
      // of their calendar date, so they match by UTC date instead.
      db.query.calendar_events.findMany({
        columns: { start_at: true, title: true, all_day: true },
        where: or(
          and(
            eq(calendar_events.all_day, false),
            gte(calendar_events.start_at, dayWindowUtc(today, tz).start),
            lt(calendar_events.start_at, dayWindowUtc(today, tz).end),
          ),
          and(
            eq(calendar_events.all_day, true),
            gte(calendar_events.start_at, `${today}T00:00:00Z`),
            lt(calendar_events.start_at, `${addDays(today, 1)}T00:00:00Z`),
          ),
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
    // First TIMED event — an all-day event's UTC-midnight instant would
    // format as a bogus wall-clock time.
    const firstTimed = events.find((e) => !e.all_day);
    const nextEvent = firstTimed
      ? {
          time: new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(firstTimed.start_at)),
          title: firstTimed.title,
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

  // GET /api/briefing/agenda — the unified day timeline: calendar events and
  // tasks due today, merged and sorted server-side in app-tz. Timed items
  // interleave by wall-clock time (a 14:00 task sits between the 13:00 and
  // 15:00 meetings); tasks without a due_time collect under "anytime". Time
  // labels are pre-formatted here (precedent: next_event) so the web renders
  // strings, not instants.
  app.get('/api/briefing/agenda', async () => {
    const db = getDb();
    const tz = await getAppTz();
    const today = todayInTz(tz);
    const window = dayWindowUtc(today, tz);

    const [events, taskRows] = await Promise.all([
      // Timed events by app-tz window; all-day events (stored AT UTC midnight
      // of their calendar date) by UTC date — same split as briefing/today.
      db.query.calendar_events.findMany({
        columns: { id: true, title: true, start_at: true, end_at: true, all_day: true, location: true },
        where: or(
          and(
            eq(calendar_events.all_day, false),
            gte(calendar_events.start_at, window.start),
            lt(calendar_events.start_at, window.end),
          ),
          and(
            eq(calendar_events.all_day, true),
            gte(calendar_events.start_at, `${today}T00:00:00Z`),
            lt(calendar_events.start_at, `${addDays(today, 1)}T00:00:00Z`),
          ),
        ),
        orderBy: asc(calendar_events.start_at),
      }),
      db
        .select({
          id: tasks.id,
          title: tasks.title,
          status: tasks.status,
          domain_id: tasks.domain_id,
          workflow_status_id: tasks.workflow_status_id,
          due_time: tasks.due_time,
          priority: tasks.priority,
          project_id: projects.id,
          project_name: projects.name,
        })
        .from(tasks)
        .leftJoin(projects, eq(tasks.project_id, projects.id))
        .where(and(eq(tasks.status, 'open'), eq(tasks.due_date, today))),
    ]);

    const fmtTime = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false,
    });

    const toTask = (r: (typeof taskRows)[number]) => ({
      id: r.id,
      title: r.title,
      status: r.status,
      domain_id: r.domain_id,
      project_id: r.project_id,
      workflow_status_id: r.workflow_status_id,
      due_time: r.due_time,
      priority: r.priority,
      project: r.project_id && r.project_name ? { id: r.project_id, name: r.project_name } : null,
    });

    type TimelineEntry =
      | { kind: 'event'; id: string; title: string; time_label: string; end_label: string | null; location: string | null }
      | { kind: 'task'; time_label: string; task: ReturnType<typeof toTask> };

    const timeline: TimelineEntry[] = [
      ...events
        .filter((e) => !e.all_day)
        .map((e) => ({
          kind: 'event' as const,
          id: e.id,
          title: e.title,
          time_label: fmtTime.format(new Date(e.start_at)),
          end_label: e.end_at ? fmtTime.format(new Date(e.end_at)) : null,
          location: e.location,
        })),
      ...taskRows
        .filter((r) => r.due_time != null)
        .map((r) => ({
          kind: 'task' as const,
          // time column arrives as HH:MM:SS — HH:MM both labels and sorts.
          time_label: String(r.due_time).slice(0, 5),
          task: toTask(r),
        })),
      // 24h HH:MM labels string-sort chronologically; events outrank tasks
      // on a tie so the meeting reads first and the task "belongs" to it.
    ].sort((a, b) =>
      a.time_label === b.time_label
        ? (a.kind === 'event' ? -1 : 0) - (b.kind === 'event' ? -1 : 0)
        : a.time_label.localeCompare(b.time_label),
    );

    return {
      date: today,
      all_day: events.filter((e) => e.all_day).map((e) => ({ id: e.id, title: e.title })),
      timeline,
      untimed_tasks: taskRows.filter((r) => r.due_time == null).map(toTask),
    };
  });
  // GET /api/briefing/bundle — everything the Agenda page composes, in one
  // response, for the phone's native Agenda: settings the page reads, the
  // masthead, the resolved panel list, and every panel's data. Sub-routes
  // are invoked in-process with the caller's credentials, so each panel keeps
  // one implementation; a failing panel degrades to null, as on the web.
  // Secrets in app settings are deliberately not projected.
  app.get<{ Querystring: { skip?: string } }>('/api/briefing/bundle', async (req) => {
    const authorization = req.headers.authorization ?? '';
    const get = async <T,>(url: string): Promise<T | null> => {
      try {
        const res = await app.inject({ method: 'GET', url, headers: { authorization } });
        return res.statusCode === 200 ? (res.json() as T) : null;
      } catch {
        return null;
      }
    };
    const settings = await getAppSettings();
    const tz = settings.timezone ?? 'America/Denver';
    const today = todayInTz(tz);
    const flags = {
      health_module_enabled: settings.health_module_enabled ?? false,
      routines_module_enabled: settings.routines_module_enabled ?? true,
      maintenance_module_enabled: settings.maintenance_module_enabled ?? true,
    };
    const skip = (req.query.skip ?? '').trim();
    const [briefing, domains, agenda, pins, attention, attentionCount, routines, resurfacing, focus, notifications, taskList, health, weather] =
      await Promise.all([
        get<BriefingPayload>('/api/briefing/today'),
        get<{ domains: Array<CadenceRow & { stats: DomainStats }> }>('/api/briefing/domains'),
        get<Record<string, unknown>>('/api/briefing/agenda'),
        get<{ pins: unknown[] }>('/api/pins'),
        get<{ items: AttentionRow[] }>('/api/attention?status=active&limit=50'),
        get<{ active: number }>('/api/attention/count'),
        get<{ routines: RoutineRow[] }>('/api/routines'),
        get<Record<string, unknown>>(`/api/library/resurfacing?skip=${encodeURIComponent(skip)}`),
        get<{ focus: FocusRow | null }>(`/api/focus?date=${today}`),
        get<{ unread: number }>('/api/notifications/count'),
        get<{ tasks: TaskRow[] }>('/api/tasks'),
        flags.health_module_enabled ? get<Record<string, unknown>>('/api/health/overview') : Promise.resolve(null),
        settings.agenda_data_url ? fetchFrameBundle(settings.agenda_data_url) : Promise.resolve(null),
      ]);

    const allTasks = taskList?.tasks ?? [];
    const openTasks = allTasks.filter((t) => t.status === 'open');
    const top3 = openTasks.filter((t) => t.top3_for_date === today).sort((a, b) => a.created_at.localeCompare(b.created_at));
    const top3Ids = new Set(top3.map((t) => t.id));
    const overdue = openTasks
      .filter((t) => !top3Ids.has(t.id) && t.due_date && t.due_date < today)
      .sort((a, b) => (a.due_date ?? '').localeCompare(b.due_date ?? ''));
    const railAll = [...top3, ...overdue];
    const RAIL_CAP = 10;
    const active = attention?.items ?? [];
    const activeRoutines = (routines?.routines ?? []).filter((r) => r.active && !r.archived_at);
    const rDone = briefing?.routines_today.done ?? activeRoutines.filter((r) => r.stats?.done_today).length;
    const rTotal = briefing?.routines_today.total ?? activeRoutines.length;
    const f = focus?.focus ?? null;

    return {
      protocol_version: 1,
      tz,
      today,
      masthead: { date_line: mastheadDate(tz), unread: notifications?.unread ?? 0 },
      settings: {
        timezone: tz,
        ...flags,
        agenda_image_url: settings.agenda_image_url ?? null,
        agenda_data_url: settings.agenda_data_url ?? null,
      },
      panels: mergePanels(settings.briefing_panels ?? null, flags),
      focus: f ? { href: f.target_type === 'project' ? `/projects/${f.target_id}` : `/content/${f.target_id}`, title: f.title, note: f.note ?? null } : null,
      counts: {
        overdue: briefing?.doing_today.overdue_count ?? 0,
        open: briefing?.doing_today.open_count ?? openTasks.length,
        waiting: allTasks.filter((t) => t.status === 'waiting').length,
        routines_done: rDone,
        routines_total: rTotal,
      },
      briefing,
      briefing_failed: briefing == null,
      domains: domains?.domains ?? [],
      agenda,
      pins: pins?.pins ?? [],
      attention: {
        items: active.filter((i) => i.rule_type !== 'company_silent').filter((i) => i.urgency === 'high' || i.urgency === 'normal').slice(0, 5),
        silent_clients: active.filter((i) => i.rule_type === 'company_silent').slice(0, 6),
        active_count: attentionCount?.active ?? 0,
      },
      routines: activeRoutines,
      routines_failed: routines == null,
      resurfacing: resurfacing ?? { item: null, exhausted: false },
      rail: { tasks: railAll.slice(0, RAIL_CAP), overflow: Math.max(0, railAll.length - RAIL_CAP), top3_count: top3.length },
      health,
      weather,
    };
  });
};
