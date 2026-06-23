import type { SupabaseClient } from '@supabase/supabase-js';

// Per-domain cadence computation. Source of truth for the Briefing's
// "X days since Y" facts and the Domains pulse board's worst-first sort.
//
// We read each domain's failure_patterns array to find its primary
// cadence rule (days_since_journal, days_since_publish, or
// no_activity_days), then run the corresponding "max(date)" rollup
// across journal_entries, content_items, or activity_log. Rules we
// don't know how to handle here surface via the observations cron
// instead — this helper is only for "days since X" semantics.

export interface CadenceRow {
  id: string;
  name: string;
  rule: 'days_since_journal' | 'days_since_publish' | 'no_activity_days' | null;
  // Days since the last relevant event. Null if the rule fired but the
  // domain has never been touched (a different "set this up first" case
  // we don't surface as slippage).
  metric: number | null;
  cadence: number | null;
  // ratio > 1 → past the cadence threshold. > 0.7 → stale, getting close.
  // <= 0.7 → healthy / on cadence.
  ratio: number;
  status: 'slip' | 'stale' | 'ok' | 'unconfigured';
  last: string | null;     // pre-formatted tail, e.g. "Last entry 2026-05-31"
  unit: string;            // pre-formatted: "days since a journal entry"
  next: string;            // recommended next action
  routeTo: { href: string; label: string };
}

function daysBetween(isoA: string, isoB: string): number {
  const a = new Date(isoA).getTime();
  const b = new Date(isoB).getTime();
  return Math.max(0, Math.floor((b - a) / (24 * 60 * 60 * 1000)));
}

type Rule = NonNullable<CadenceRow['rule']>;

interface RuleHit {
  rule: Rule;
  cadence: number;
}
function pickCadenceRule(patterns: unknown): RuleHit | null {
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

function unitFor(rule: Rule): string {
  switch (rule) {
    case 'days_since_journal': return 'days since a journal entry';
    case 'days_since_publish': return 'days since publish';
    case 'no_activity_days': return 'days since project activity';
  }
}

function lastLabelFor(rule: Rule, isoDate: string): string {
  const date = isoDate.slice(0, 10);
  switch (rule) {
    case 'days_since_journal': return `Last entry ${date}`;
    case 'days_since_publish': return `Last publish ${date}`;
    case 'no_activity_days': return `Last activity ${date}`;
  }
}

function nextActionFor(rule: Rule, domainName: string): { next: string; routeTo: CadenceRow['routeTo'] } {
  switch (rule) {
    case 'days_since_journal':
      return {
        next: 'Capture a journal entry',
        routeTo: { href: '/library/journal', label: 'Journal · capture a new entry' },
      };
    case 'days_since_publish':
      return {
        next: `Ship something for ${domainName}`,
        routeTo: { href: '/content', label: 'Content · ship something →' },
      };
    case 'no_activity_days':
      return {
        next: `Pick up a project in ${domainName}`,
        routeTo: { href: '/projects', label: 'Projects · open one →' },
      };
  }
}

export async function computeDomainCadences(sb: SupabaseClient): Promise<CadenceRow[]> {
  const nowIso = new Date().toISOString();

  // Pull active, non-system domains + the three rollups in parallel.
  // Each rollup is one query — cheaper than N domain-by-domain reads.
  //
  // last_shipped_at is the manual "I shipped something" timestamp added
  // in migration 0027. For days_since_publish rules we take MAX of the
  // latest content_items.published_at and this column, so domains whose
  // work happens off-dashboard (Substack essays, etc.) can still keep
  // a real cadence by tapping the "Mark shipped" button.
  const [domainsRes, lastJournalRes, publishesRes, activitiesRes] = await Promise.all([
    sb.from('stewardship_domains')
      .select('id, name, failure_patterns, last_shipped_at')
      .eq('active', true)
      .eq('is_system', false),
    sb.from('journal_entries')
      .select('entry_date')
      .order('entry_date', { ascending: false })
      .limit(1),
    sb.from('content_items')
      .select('domain_id, published_at')
      .eq('status', 'published')
      .not('published_at', 'is', null)
      .order('published_at', { ascending: false }),
    sb.from('activity_log')
      .select('logged_at, project:projects(domain_id)')
      .order('logged_at', { ascending: false })
      .limit(500),
  ]);

  const domains = (domainsRes.data ?? []) as Array<{
    id: string;
    name: string;
    failure_patterns: unknown;
    last_shipped_at: string | null;
  }>;
  const lastJournalDate = (lastJournalRes.data?.[0]?.entry_date as string | undefined) ?? null;

  type PubRow = { domain_id: string | null; published_at: string };
  const latestPublishByDomain = new Map<string, string>();
  for (const r of (publishesRes.data ?? []) as PubRow[]) {
    if (!r.domain_id || !r.published_at) continue;
    if (!latestPublishByDomain.has(r.domain_id)) {
      latestPublishByDomain.set(r.domain_id, r.published_at);
    }
  }

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

  const rows: CadenceRow[] = [];
  for (const d of domains) {
    const hit = pickCadenceRule(d.failure_patterns);
    if (!hit) {
      // Domain has no "days since X" rule — we can't compute cadence.
      // Render it as "unconfigured" so the pulse board still lists it
      // but with no fact or routing.
      rows.push({
        id: d.id,
        name: d.name,
        rule: null,
        metric: null,
        cadence: null,
        ratio: 0,
        status: 'unconfigured',
        last: null,
        unit: '',
        next: '',
        routeTo: { href: `/domains/${d.id}`, label: 'Open domain →' },
      });
      continue;
    }

    let lastIso: string | null = null;
    switch (hit.rule) {
      case 'days_since_journal':
        lastIso = lastJournalDate;
        break;
      case 'days_since_publish': {
        // Take whichever's most recent: latest tracked content_items
        // publish OR the manual "Mark shipped" timestamp on the domain.
        // Lets domains whose work lives off-dashboard (Substack, etc.)
        // record a cadence without logging every external piece.
        const contentLatest = latestPublishByDomain.get(d.id) ?? null;
        const manualLatest = d.last_shipped_at ?? null;
        if (contentLatest && manualLatest) {
          lastIso = contentLatest > manualLatest ? contentLatest : manualLatest;
        } else {
          lastIso = contentLatest ?? manualLatest;
        }
        break;
      }
      case 'no_activity_days':
        lastIso = latestActivityByDomain.get(d.id) ?? null;
        break;
    }

    if (!lastIso) {
      // Configured but no data yet — render as unconfigured (no fact).
      rows.push({
        id: d.id,
        name: d.name,
        rule: hit.rule,
        metric: null,
        cadence: hit.cadence,
        ratio: 0,
        status: 'unconfigured',
        last: null,
        unit: unitFor(hit.rule),
        next: '',
        routeTo: { href: `/domains/${d.id}`, label: 'Open domain →' },
      });
      continue;
    }

    const metric = daysBetween(lastIso, nowIso);
    const ratio = hit.cadence > 0 ? metric / hit.cadence : 0;
    const status: CadenceRow['status'] = ratio > 1 ? 'slip' : ratio > 0.7 ? 'stale' : 'ok';
    const { next, routeTo } = nextActionFor(hit.rule, d.name);

    rows.push({
      id: d.id,
      name: d.name,
      rule: hit.rule,
      metric,
      cadence: hit.cadence,
      ratio,
      status,
      last: lastLabelFor(hit.rule, lastIso),
      unit: unitFor(hit.rule),
      next,
      routeTo,
    });
  }

  // Default sort: worst (highest ratio) first. Unconfigured at the bottom.
  rows.sort((a, b) => {
    if (a.status === 'unconfigured' && b.status !== 'unconfigured') return 1;
    if (b.status === 'unconfigured' && a.status !== 'unconfigured') return -1;
    return b.ratio - a.ratio;
  });

  return rows;
}
