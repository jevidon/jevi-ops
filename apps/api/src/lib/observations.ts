import type { SupabaseClient } from '@supabase/supabase-js';

// Observations engine — spec §10. Each active domain has a JSONB array of
// failure_patterns. We loop those, dispatch to a rule evaluator, and write
// observation rows for any matches. Rules that need data we don't have yet
// (content_items pipeline, checklist_instances, content/journal data flows)
// are stubbed — they return [] silently so cron stays clean as the data
// model fills in.
//
// Factual only. Per spec: "Project X untouched 14 days" — NOT "you should
// work on Project X". Title is the observation; body adds supporting detail
// the user can reason about.

export interface ObservationCandidate {
  type: string;             // matches the rule name
  severity: 'info' | 'notable' | 'concerning';
  title: string;
  body: string;
  supporting_data: Record<string, unknown>;
  domain_id: string;
  project_id?: string | null;
  /** Stable key per (rule, target). Used to dedupe: existing active
   *  observation with the same source_ref skips a new insert. */
  source_ref: string;
}

interface DomainRow {
  id: string;
  name: string;
  failure_patterns: unknown;
  active: boolean;
}

interface RuleConfig {
  rule: string;
  [key: string]: unknown;
}

// ─── Helpers ─────────────────────────────────────────────────────────────

const num = (o: RuleConfig, k: string, fallback?: number): number | undefined => {
  const v = o[k];
  return typeof v === 'number' ? v : fallback;
};

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

// ─── Rule evaluators ─────────────────────────────────────────────────────

/** Find active projects in this domain with no activity_log rows in N days. */
async function ruleNoActivityDays(
  sb: SupabaseClient,
  domain: DomainRow,
  cfg: RuleConfig,
): Promise<ObservationCandidate[]> {
  const days = num(cfg, 'value', 14)!;
  const since = daysAgoIso(days);

  const { data: projects } = await sb
    .from('projects')
    .select('id, name')
    .eq('domain_id', domain.id)
    .eq('status', 'active');
  if (!projects || projects.length === 0) return [];

  const out: ObservationCandidate[] = [];
  for (const p of projects) {
    const { count } = await sb
      .from('activity_log')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', p.id)
      .gte('logged_at', since);
    if ((count ?? 0) === 0) {
      // Also exclude projects that have ZERO activity ever, since brand-new
      // projects aren't yet "stalled" — they're just unstarted.
      const { count: anyCount } = await sb
        .from('activity_log')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', p.id);
      if ((anyCount ?? 0) === 0) continue;

      out.push({
        type: 'no_activity_days',
        severity: 'notable',
        title: `${p.name} · no activity ${days}+ days`,
        body: `Last activity was more than ${days} days ago.`,
        supporting_data: { project_id: p.id, project_name: p.name, threshold_days: days },
        domain_id: domain.id,
        project_id: p.id,
        source_ref: `no_activity_days:${p.id}`,
      });
    }
  }
  return out;
}

/** Find projects where hours_logged exceeds quoted_hours by a configurable
 *  ratio (default 1.0 = exceeded at all). */
async function ruleHoursExceedQuote(
  sb: SupabaseClient,
  domain: DomainRow,
  cfg: RuleConfig,
): Promise<ObservationCandidate[]> {
  const ratio = num(cfg, 'value', 1.0)!;

  const { data: projects } = await sb
    .from('projects')
    .select('id, name, hours_logged, quoted_hours')
    .eq('domain_id', domain.id)
    .eq('status', 'active')
    .not('quoted_hours', 'is', null);
  if (!projects || projects.length === 0) return [];

  const out: ObservationCandidate[] = [];
  for (const p of projects) {
    const quoted = Number(p.quoted_hours ?? 0);
    const logged = Number(p.hours_logged ?? 0);
    if (quoted <= 0) continue;
    if (logged / quoted >= ratio) {
      out.push({
        type: 'hours_exceed_quote',
        severity: 'concerning',
        title: `${p.name} · hours over quote`,
        body: `${logged.toFixed(1)} of ${quoted.toFixed(1)} quoted hours used (${Math.round((logged / quoted) * 100)}%).`,
        supporting_data: { project_id: p.id, project_name: p.name, logged, quoted, ratio: logged / quoted },
        domain_id: domain.id,
        project_id: p.id,
        source_ref: `hours_exceed_quote:${p.id}`,
      });
    }
  }
  return out;
}

/** Find projects with target_date within N days that haven't been touched in M days. */
async function ruleDeadlineWithinDays(
  sb: SupabaseClient,
  domain: DomainRow,
  cfg: RuleConfig,
): Promise<ObservationCandidate[]> {
  const deadlineWindow = num(cfg, 'value', 7)!;
  const untouchedDays = num(cfg, 'untouched_days', 3)!;
  const today = new Date();
  const cutoff = new Date(today.getTime() + deadlineWindow * 24 * 60 * 60 * 1000)
    .toISOString().slice(0, 10);
  const since = daysAgoIso(untouchedDays);

  const { data: projects } = await sb
    .from('projects')
    .select('id, name, target_date')
    .eq('domain_id', domain.id)
    .eq('status', 'active')
    .not('target_date', 'is', null)
    .lte('target_date', cutoff);
  if (!projects || projects.length === 0) return [];

  const out: ObservationCandidate[] = [];
  for (const p of projects) {
    const { count } = await sb
      .from('activity_log')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', p.id)
      .gte('logged_at', since);
    if ((count ?? 0) === 0) {
      const daysOut = Math.ceil(
        (new Date(p.target_date!).getTime() - today.getTime()) / (24 * 60 * 60 * 1000),
      );
      out.push({
        type: 'deadline_within_days',
        severity: 'concerning',
        title: `${p.name} · deadline approaching, untouched`,
        body: `Deadline in ${daysOut} day${daysOut === 1 ? '' : 's'}; no activity in the last ${untouchedDays} days.`,
        supporting_data: {
          project_id: p.id,
          project_name: p.name,
          target_date: p.target_date,
          days_until_deadline: daysOut,
          untouched_days: untouchedDays,
        },
        domain_id: domain.id,
        project_id: p.id,
        source_ref: `deadline_within_days:${p.id}`,
      });
    }
  }
  return out;
}

/** Personal domain: no journal entries in N days. */
async function ruleDaysSinceJournal(
  sb: SupabaseClient,
  domain: DomainRow,
  cfg: RuleConfig,
): Promise<ObservationCandidate[]> {
  const days = num(cfg, 'value', 7)!;
  const since = daysAgoIso(days);

  const { count } = await sb
    .from('journal_entries')
    .select('id', { count: 'exact', head: true })
    .gte('entry_date', since.slice(0, 10));

  if ((count ?? 0) > 0) return [];

  return [
    {
      type: 'days_since_journal',
      severity: 'info',
      title: `No journal entries in ${days}+ days`,
      body: 'Cadence target is weekly minimum.',
      supporting_data: { threshold_days: days },
      domain_id: domain.id,
      source_ref: `days_since_journal:${domain.id}`,
    },
  ];
}

// ─── Stubbed evaluators ──────────────────────────────────────────────────
//
// These rules need data we don't have yet. They return [] so the cron loop
// stays clean. Wire them up properly when the relevant data flows ship.

async function ruleDaysSincePublish(): Promise<ObservationCandidate[]> {
  // Needs content_items with status='published' and a published_at timestamp.
  return [];
}
async function ruleDaysInStatus(): Promise<ObservationCandidate[]> {
  // Needs content_items entering a status (editing) with a status-change timestamp.
  return [];
}
async function ruleShootChecklist(): Promise<ObservationCandidate[]> {
  // Needs checklist_instances with shoot-context linking.
  return [];
}
async function rulePersonFactDateRelevant(): Promise<ObservationCandidate[]> {
  // Needs person_facts with date_relevant in the upcoming window AND a
  // resurfacing tracker. Skip until people / resurfacing engine lands.
  return [];
}

// ─── Dispatcher ──────────────────────────────────────────────────────────

type RuleHandler = (sb: SupabaseClient, domain: DomainRow, cfg: RuleConfig) => Promise<ObservationCandidate[]>;

const RULE_HANDLERS: Record<string, RuleHandler> = {
  no_activity_days: ruleNoActivityDays,
  hours_exceed_quote: ruleHoursExceedQuote,
  deadline_within_days: ruleDeadlineWithinDays,
  days_since_journal: ruleDaysSinceJournal,
  days_since_publish: ruleDaysSincePublish,
  days_in_status: ruleDaysInStatus,
  shoot_within_days_checklist_incomplete: ruleShootChecklist,
  person_fact_date_relevant_unsurfaced: rulePersonFactDateRelevant,
};

// ─── Orchestrator ────────────────────────────────────────────────────────

export interface ObservationsRunResult {
  domains_evaluated: number;
  rules_evaluated: number;
  candidates: number;
  inserted: number;
  skipped_dedupe: number;
  unknown_rules: string[];
}

/** Walk all active domains, evaluate every rule in their failure_patterns,
 *  dedupe against existing active observations, and insert new ones.
 *  Service-role caller (cron); RLS isn't relevant. */
export async function runObservations(sb: SupabaseClient): Promise<ObservationsRunResult> {
  const result: ObservationsRunResult = {
    domains_evaluated: 0, rules_evaluated: 0, candidates: 0,
    inserted: 0, skipped_dedupe: 0, unknown_rules: [],
  };

  const { data: domains } = await sb
    .from('stewardship_domains')
    .select('id, name, failure_patterns, active')
    .eq('active', true);
  if (!domains) return result;

  // Pre-load active observations once so we can dedupe in memory.
  const { data: existing } = await sb
    .from('observations')
    .select('supporting_data')
    .is('dismissed_at', null);
  const activeSourceRefs = new Set<string>();
  for (const row of (existing ?? []) as Array<{ supporting_data: Record<string, unknown> | null }>) {
    const ref = row.supporting_data?.source_ref;
    if (typeof ref === 'string') activeSourceRefs.add(ref);
  }

  const toInsert: ObservationCandidate[] = [];

  for (const d of domains as DomainRow[]) {
    result.domains_evaluated += 1;
    const patterns = Array.isArray(d.failure_patterns) ? d.failure_patterns : [];
    for (const raw of patterns) {
      const cfg = raw as RuleConfig;
      if (!cfg || typeof cfg.rule !== 'string') continue;
      result.rules_evaluated += 1;
      const handler = RULE_HANDLERS[cfg.rule];
      if (!handler) {
        result.unknown_rules.push(cfg.rule);
        continue;
      }
      const cands = await handler(sb, d, cfg);
      result.candidates += cands.length;
      for (const c of cands) {
        if (activeSourceRefs.has(c.source_ref)) {
          result.skipped_dedupe += 1;
          continue;
        }
        toInsert.push(c);
        activeSourceRefs.add(c.source_ref);
      }
    }
  }

  if (toInsert.length > 0) {
    const rows = toInsert.map((c) => ({
      type: c.type,
      severity: c.severity,
      title: c.title,
      body: c.body,
      // Stash source_ref inside supporting_data alongside the rule context.
      supporting_data: { ...c.supporting_data, source_ref: c.source_ref },
      domain_id: c.domain_id,
      project_id: c.project_id ?? null,
    }));
    const { error } = await sb.from('observations').insert(rows);
    if (error) throw new Error(`observations insert failed: ${error.message}`);
    result.inserted = rows.length;
  }

  // Dedup the unknown_rules list for cleaner logs.
  result.unknown_rules = Array.from(new Set(result.unknown_rules));
  return result;
}
