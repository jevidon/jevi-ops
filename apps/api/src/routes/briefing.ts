import type { FastifyPluginAsync } from 'fastify';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getAppTz } from '../lib/app-settings.js';

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

function daysBetween(isoA: string, isoB: string): number {
  const a = new Date(isoA).getTime();
  const b = new Date(isoB).getTime();
  return Math.max(0, Math.floor((b - a) / (24 * 60 * 60 * 1000)));
}

// Parse the failure_patterns array to find the "headline" cadence rule
// for a domain. We only know how to surface days_since_* rules right now;
// quote_exceed / shoot_within_days / etc. live in the observations cron
// and surface there, not on the Briefing's editorial column.
interface CadenceRule {
  rule: 'days_since_journal' | 'days_since_publish' | 'no_activity_days';
  cadence: number;
}
function pickCadenceRule(patterns: unknown): CadenceRule | null {
  if (!Array.isArray(patterns)) return null;
  for (const raw of patterns) {
    if (!raw || typeof raw !== 'object') continue;
    const p = raw as { rule?: string; value?: number };
    if (typeof p.rule !== 'string' || typeof p.value !== 'number') continue;
    if (p.rule === 'days_since_journal' || p.rule === 'days_since_publish' || p.rule === 'no_activity_days') {
      return { rule: p.rule, cadence: p.value };
    }
  }
  return null;
}

function unitFor(rule: CadenceRule['rule']): string {
  switch (rule) {
    case 'days_since_journal': return 'days since a journal entry';
    case 'days_since_publish': return 'days since publish';
    case 'no_activity_days': return 'days since project activity';
  }
}

function nextActionFor(rule: CadenceRule['rule']): { next: string; routeTo: BriefLine['routeTo'] } {
  switch (rule) {
    case 'days_since_journal':
      return { next: 'Capture a journal entry', routeTo: { href: '/library/journal', label: 'Journal · capture a new entry' } };
    case 'days_since_publish':
      return { next: 'Open the editing pipeline', routeTo: { href: '/content', label: 'Content · ship something →' } };
    case 'no_activity_days':
      return { next: 'Open the project list', routeTo: { href: '/projects', label: 'Projects · open one →' } };
  }
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

    // Fan out the data fetches. Each computation is independent — one DB
    // round trip per category. Keeping these in parallel matters because
    // the Today page renders synchronously off the consolidated payload.
    const [
      domainsRes,
      lastJournalRes,
      publishesRes,
      activitiesRes,
      inboxCountRes,
      eventsRes,
      openTasksRes,
      routinesRes,
    ] = await Promise.all([
      sb.from('stewardship_domains')
        .select('id, name, failure_patterns, expected_cadence')
        .eq('active', true)
        .eq('is_system', false),
      sb.from('journal_entries')
        .select('entry_date')
        .order('entry_date', { ascending: false })
        .limit(1),
      // One row per domain that has any published content_items.
      sb.from('content_items')
        .select('domain_id, published_at')
        .eq('status', 'published')
        .not('published_at', 'is', null)
        .order('published_at', { ascending: false }),
      // Activity log joined to project so we know the domain.
      sb.from('activity_log')
        .select('logged_at, project:projects(domain_id)')
        .order('logged_at', { ascending: false })
        .limit(200),
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

    const domains = domainsRes.data ?? [];
    const lastJournalDate = (lastJournalRes.data?.[0]?.entry_date as string | undefined) ?? null;

    // Roll up: latest publish per domain.
    type PubRow = { domain_id: string | null; published_at: string };
    const latestPublishByDomain = new Map<string, string>();
    for (const r of (publishesRes.data ?? []) as PubRow[]) {
      if (!r.domain_id || !r.published_at) continue;
      if (!latestPublishByDomain.has(r.domain_id)) {
        latestPublishByDomain.set(r.domain_id, r.published_at);
      }
    }

    // Roll up: latest activity per domain.
    type ActRow = { logged_at: string; project: { domain_id: string | null } | { domain_id: string | null }[] | null };
    const latestActivityByDomain = new Map<string, string>();
    for (const r of (activitiesRes.data ?? []) as ActRow[]) {
      const proj = Array.isArray(r.project) ? r.project[0] : r.project;
      const did = proj?.domain_id;
      if (!did) continue;
      if (!latestActivityByDomain.has(did)) {
        latestActivityByDomain.set(did, r.logged_at);
      }
    }

    // Compute brief lines.
    const briefLines: BriefLine[] = [];
    for (const d of domains as Array<{ id: string; name: string; failure_patterns: unknown }>) {
      const rule = pickCadenceRule(d.failure_patterns);
      if (!rule) continue;

      let lastIso: string | null = null;
      switch (rule.rule) {
        case 'days_since_journal': lastIso = lastJournalDate; break;
        case 'days_since_publish': lastIso = latestPublishByDomain.get(d.id) ?? null; break;
        case 'no_activity_days': lastIso = latestActivityByDomain.get(d.id) ?? null; break;
      }

      // No data at all → don't surface (the domain has never been touched;
      // that's a "set it up first" condition, not "slipping").
      if (!lastIso) continue;

      const metric = daysBetween(lastIso, nowIso);
      const ratio = rule.cadence > 0 ? metric / rule.cadence : 0;
      // Only surface if past the cadence threshold (slipping) or close
      // enough to be worth noting (stale = above 70% of threshold).
      if (ratio < 0.7) continue;
      const status: BriefLine['status'] = ratio > 1 ? 'slip' : 'stale';

      const { next, routeTo } = nextActionFor(rule.rule);
      const lastDateLabel = lastIso.slice(0, 10);

      briefLines.push({
        kind: 'domain',
        id: d.id,
        name: d.name,
        metric,
        big: String(metric),
        unit: unitFor(rule.rule),
        cadence: rule.cadence,
        ratio,
        status,
        last: `Last ${rule.rule === 'days_since_journal' ? 'entry' : rule.rule === 'days_since_publish' ? 'publish' : 'activity'} ${lastDateLabel}`,
        next,
        routeTo,
      });
    }

    // Sort worst-first by ratio.
    briefLines.sort((a, b) => b.ratio - a.ratio);

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
    type Task = { id: string; title: string; due_date: string | null; top3_for_date: string | null };
    const openTasks = (openTasksRes.data ?? []) as Task[];
    const top3 = openTasks.filter((t) => t.top3_for_date === today);
    const dueToday = openTasks.filter((t) => t.due_date === today && !top3.find((s) => s.id === t.id));
    const overdue = openTasks.filter((t) => t.due_date && t.due_date < today);
    const doingTitles = [...top3, ...dueToday].slice(0, 3).map((t) => t.title);

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
};
