import { and, desc, eq, inArray, isNotNull, isNull, lt, lte, max } from 'drizzle-orm';
import type { Db } from './db.js';
import {
  activity_log,
  attention_items,
  companies,
  content_items,
  conversations,
  people,
  person_facts,
  projects,
  stewardship_domains,
  tasks,
} from '../db/schema.js';
import { getAppTz } from './app-settings.js';

// The Attention Engine — ported from upstream jerad-ops v2.0.0 (Addendum 05
// §10), re-expressed against Drizzle. Modeled on observations.ts: rule
// handlers each return CandidateItem[]; runAttention reconciles them against
// stored items and manages the snooze/dismiss/acted lifecycle.
//
// Fork scope: upstream ships 13 rules; we port the 5 whose entities exist in
// this fork (person facts, due tasks, stalled projects, stuck content, stale
// domains). The conversation/company rules (follow-ups, silent clients,
// reviews), waiting-task aging, and ideas aging depend on the CRM/Content-
// Manager/Daily-Rule subsystems that haven't been ported — add them alongside
// those ports, not before.
//
// Correctness model (upstream learned this the hard way in review):
//   * Liveness + auto-resolve key on the OCCURRENCE identity (rule_type +
//     entity id), NOT the bucketed dedup_key — so a snoozed item that
//     reactivates under a new time bucket isn't mistaken for a resolved one
//     and expired.
//   * dedup_key (with its time bucket) is used only to scope a DISMISS to one
//     occurrence, so dismissing this year's birthday still resurfaces next year.
//   * Every rule THROWS on a query error (Drizzle's default), so a transient
//     DB failure is caught as a rule error and that rule's items are left
//     untouched — never mass-expired by an accidental empty result.

export interface CandidateItem {
  rule_type: string;
  source_type: 'person' | 'company' | 'domain' | 'project' | 'conversation' | 'task' | 'content';
  source_id: string;
  title: string;
  detail: string | null;
  suggested_action: string | null;
  score: number;
  dedup_key: string;
}

interface Ctx {
  todayYmd: string; // YYYY-MM-DD in app tz
  nowIso: string;
  // App timezone. Needed by any rule aging a TIMESTAMPTZ column: slicing the
  // UTC date off such a value and diffing it against todayYmd is off by one
  // for anything stamped after ~17:00 local in a behind-UTC zone.
  tz: string;
}

// Live-clear the attention items a mutation just resolved — so acting on the
// underlying thing (logging activity, shipping a domain, completing a task)
// removes its attention item immediately instead of waiting for the daily
// cron. NEW items still only arrive via the cron. Deletes the live (active/
// snoozed) items for a source + rule set; dismissed/acted/expired history is
// left alone. Best-effort at the call sites.
export async function clearAttentionForSource(
  db: Db,
  sourceType: string,
  sourceId: string,
  ruleTypes: string[],
): Promise<void> {
  await db
    .delete(attention_items)
    .where(
      and(
        eq(attention_items.source_type, sourceType),
        eq(attention_items.source_id, sourceId),
        inArray(attention_items.rule_type, ruleTypes),
        inArray(attention_items.status, ['active', 'snoozed']),
      ),
    );
}

// ─── Date helpers (string-based, tz-safe via UTC anchoring) ───────────────

function ymdParts(s: string): [number, number, number] {
  const parts = s.slice(0, 10).split('-');
  return [Number(parts[0]), Number(parts[1]), Number(parts[2])];
}
function daysBetween(fromYmd: string, toYmd: string): number {
  const [fy, fm, fd] = ymdParts(fromYmd);
  const [ty, tm, td] = ymdParts(toYmd);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
}
function daysUntil(dateYmd: string, todayYmd: string): number {
  return daysBetween(todayYmd, dateYmd);
}
// Next occurrence of a month/day, this year or next — for recurring facts
// (birthdays, anniversaries) where the stored year is the original event.
function daysUntilRecurring(dateYmd: string, todayYmd: string): number {
  const [, m, d] = ymdParts(dateYmd);
  const [ty] = ymdParts(todayYmd);
  let diff = daysBetween(todayYmd, `${ty}-${pad(m)}-${pad(d)}`);
  if (diff < 0) diff = daysBetween(todayYmd, `${ty + 1}-${pad(m)}-${pad(d)}`);
  return diff;
}
const pad = (n: number) => String(n).padStart(2, '0');
function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}
// A TIMESTAMPTZ ISO string → the calendar date it fell on in tz.
function ymdInTz(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
}
function isoWeekBucket(todayYmd: string): string {
  const [y, m, d] = ymdParts(todayYmd);
  const date = new Date(Date.UTC(y, m - 1, d));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${pad(week)}`;
}
const monthBucket = (ymd: string) => ymd.slice(0, 7);
const yearBucket = (ymd: string) => ymd.slice(0, 4);
const dayBucket = (ymd: string) => ymd.slice(0, 10);

function urgencyFor(score: number): 'low' | 'normal' | 'high' {
  if (score >= 80) return 'high';
  if (score >= 30) return 'normal';
  return 'low';
}
function inDays(days: number): string {
  if (days <= 0) return 'today';
  if (days === 1) return 'tomorrow';
  return `in ${days} days`;
}

// The occurrence identity of a dedup_key: `rule_type:entity_id`, dropping any
// trailing `:time_bucket`. rule_type has no colons, entity_id is a UUID (no
// colons), buckets use hyphens — so the first two colon-segments are the base.
// Used for liveness + auto-resolve so a snoozed item that reactivates under a
// new bucket still matches its regenerated candidate.
function baseKey(dedupKey: string): string {
  const parts = dedupKey.split(':');
  return parts.length >= 2 ? `${parts[0]}:${parts[1]}` : dedupKey;
}

// ─── Time-triggered rules ─────────────────────────────────────────────────

// Person facts with a relevant date — birthdays, anniversaries, follow-ups.
// This fork keeps birthdays/anniversaries as person_facts rows (fact_type +
// date_relevant + recurring), not as people columns like upstream — so one
// rule covers what upstream splits into three, with per-fact-type scoring.
async function rulePersonFact(db: Db, ctx: Ctx): Promise<CandidateItem[]> {
  const facts = await db
    .select({
      id: person_facts.id,
      person_id: person_facts.person_id,
      fact_type: person_facts.fact_type,
      fact_value: person_facts.fact_value,
      date_relevant: person_facts.date_relevant,
      recurring: person_facts.recurring,
      name: people.name,
    })
    .from(person_facts)
    .innerJoin(people, eq(person_facts.person_id, people.id))
    .where(isNotNull(person_facts.date_relevant));

  const out: CandidateItem[] = [];
  for (const f of facts) {
    if (!f.date_relevant) continue;
    const days = f.recurring
      ? daysUntilRecurring(f.date_relevant, ctx.todayYmd)
      : daysUntil(f.date_relevant, ctx.todayYmd);
    if (days < 0 || days > 14) continue;

    let rule_type = 'person_fact_upcoming';
    let title: string;
    let detail: string | null = null;
    let score: number;
    if (f.fact_type === 'birthday') {
      rule_type = 'birthday_upcoming';
      title = days === 0 ? `${f.name}'s birthday is today` : `${f.name}'s birthday ${inDays(days)}`;
      detail = 'Consider a call or a note.';
      score = 50 + (days <= 1 ? 50 : 0);
    } else if (f.fact_type === 'anniversary') {
      rule_type = 'anniversary_upcoming';
      title = days === 0 ? `${f.name}'s anniversary is today` : `${f.name}'s anniversary ${inDays(days)}`;
      score = 40 + (days <= 3 ? 40 : 0);
    } else {
      title = `${f.name}: ${f.fact_value} ${inDays(days)}`;
      score = 45 + (days <= 3 ? 40 : 0);
    }
    out.push({
      rule_type,
      source_type: 'person',
      source_id: f.person_id,
      title,
      detail,
      suggested_action: f.fact_type === 'birthday' || f.fact_type === 'anniversary' ? 'Create task' : 'Open person',
      score,
      // Recurring facts recur yearly → year bucket (dismiss covers this
      // year's occurrence). One-shot facts → month bucket like upstream.
      dedup_key: `${rule_type}:${f.id}:${f.recurring ? yearBucket(ctx.todayYmd) : monthBucket(ctx.todayYmd)}`,
    });
  }
  return out;
}

async function ruleTaskDueSoon(db: Db, ctx: Ctx): Promise<CandidateItem[]> {
  const open = await db.query.tasks.findMany({
    columns: { id: true, title: true, due_date: true },
    where: and(eq(tasks.status, 'open'), isNotNull(tasks.due_date)),
  });
  const out: CandidateItem[] = [];
  for (const t of open) {
    if (!t.due_date) continue;
    const days = daysUntil(t.due_date, ctx.todayYmd);
    if (days > 3) continue;
    out.push({
      rule_type: 'task_due_soon',
      source_type: 'task',
      source_id: t.id,
      title: `${days < 0 ? 'Overdue' : 'Due'}: ${t.title}`,
      detail: days < 0 ? `Due ${t.due_date}` : inDays(days),
      suggested_action: 'Complete task',
      score: 55 + (days === 0 ? 50 : 0) + (days < 0 ? 100 : 0),
      dedup_key: `task_due_soon:${t.id}:${dayBucket(ctx.todayYmd)}`,
    });
  }
  return out;
}

// ─── Inactivity-triggered rules ───────────────────────────────────────────

async function ruleProjectStalled(db: Db, ctx: Ctx): Promise<CandidateItem[]> {
  const cutoff = daysAgoIso(14);
  // One grouped query (project + its latest activity) instead of upstream's
  // per-project N+1 — same semantics: no activity_log row in 14 days.
  const rows = await db
    .select({
      id: projects.id,
      name: projects.name,
      lastActivity: max(activity_log.logged_at),
    })
    .from(projects)
    .leftJoin(activity_log, eq(activity_log.project_id, projects.id))
    .where(and(eq(projects.status, 'active'), eq(projects.kind, 'project')))
    .groupBy(projects.id, projects.name);

  const out: CandidateItem[] = [];
  for (const p of rows) {
    if (p.lastActivity && p.lastActivity >= cutoff) continue;
    out.push({
      rule_type: 'project_stalled',
      source_type: 'project',
      source_id: p.id,
      title: `Stalled: ${p.name}`,
      detail: 'No activity logged in 14+ days',
      suggested_action: 'Open project',
      score: 40,
      dedup_key: `project_stalled:${p.id}:${isoWeekBucket(ctx.todayYmd)}`,
    });
  }
  return out;
}

async function ruleContentStuck(db: Db, ctx: Ctx): Promise<CandidateItem[]> {
  // Sharpened per upstream Addendum 08 §9 (migration 0038): fire only when
  // the EDITOR has held it ≥10 days, anchored on holder_since — a true
  // clock — instead of raw editing-status age. Self-edited items
  // (holder='me') are my-move work, surfaced elsewhere, not "stuck".
  const cutoff = daysAgoIso(10);
  const stuck = await db.query.content_items.findMany({
    columns: { id: true, title: true, holder_since: true },
    where: and(
      eq(content_items.status, 'editing'),
      eq(content_items.holder, 'editor'),
      isNotNull(content_items.holder_since),
      lt(content_items.holder_since, cutoff),
    ),
  });
  const out: CandidateItem[] = [];
  for (const c of stuck) {
    // holder_since is TIMESTAMPTZ — convert to the app-tz date before
    // diffing (a UTC slice reads a day early for evening hand-offs).
    const days = c.holder_since
      ? Math.abs(daysBetween(ymdInTz(c.holder_since, ctx.tz), ctx.todayYmd))
      : 10;
    out.push({
      rule_type: 'content_stuck_in_editing',
      source_type: 'content',
      source_id: c.id,
      title: `With editor: ${c.title}`,
      detail: `In the editor's hands ${days}d`,
      suggested_action: 'Nudge editor',
      score: 45 + Math.min(35, Math.floor((days - 10) / 7) * 15),
      dedup_key: `content_stuck_in_editing:${c.id}:${isoWeekBucket(ctx.todayYmd)}`,
    });
  }
  return out;
}

// Waiting ≥7 days (Addendum 08 §9): a task blocked on someone else long
// enough to warrant a nudge-or-move-on. waiting_since is the anchor.
// Waiting tasks are excluded from task_due_soon (that rule filters
// status='open'), so there's no double surface. Score ramps weekly past
// the 7-day mark.
async function ruleTaskWaitingAging(db: Db, ctx: Ctx): Promise<CandidateItem[]> {
  const rows = await db.query.tasks.findMany({
    columns: { id: true, title: true, waiting_on: true, waiting_since: true },
    where: and(eq(tasks.status, 'waiting'), isNotNull(tasks.waiting_since)),
  });
  const out: CandidateItem[] = [];
  for (const t of rows) {
    const days = t.waiting_since ? Math.abs(daysBetween(t.waiting_since, ctx.todayYmd)) : 0;
    if (days < 7) continue;
    const who = t.waiting_on?.trim() || 'someone';
    out.push({
      rule_type: 'task_waiting_aging',
      source_type: 'task',
      source_id: t.id,
      title: `Waiting ${days}d: ${t.title}`,
      detail: `Waiting on ${who} · ${days}d — nudge or move on?`,
      suggested_action: 'Nudge or move on',
      score: 30 + Math.min(40, Math.floor((days - 7) / 7) * 20),
      dedup_key: `task_waiting_aging:${t.id}:${isoWeekBucket(ctx.todayYmd)}`,
    });
  }
  return out;
}

// Idea resurfacing (Addendum 09 §5). Fires only when the backlog is
// genuinely stale: ≥3 ideas with no review in 30+ days. Emits exactly ONE
// item a week — the count is the signal, so N items would be noise —
// anchored on the OLDEST un-reviewed idea, because attention_items.source_id
// must be a real uuid (there is no roll-up source). Keep/Archive is what
// clears them; idea_reviewed_at is the "reviewed" stamp, falling back to
// created_at for never-reviewed ideas.
const IDEAS_AGING_MIN_COUNT = 3;
const IDEAS_AGING_MIN_DAYS = 30;

async function ruleIdeasAging(db: Db, ctx: Ctx): Promise<CandidateItem[]> {
  const rows = await db.query.content_items.findMany({
    columns: { id: true, title: true, created_at: true, idea_reviewed_at: true },
    where: and(eq(content_items.status, 'idea'), isNull(content_items.archived_at)),
  });

  // "Last looked at" = the review stamp, else when it was captured. Both are
  // TIMESTAMPTZ, so convert to the app-tz calendar date before diffing.
  const stale = rows
    .map((c) => ({ ...c, lastSeen: ymdInTz(c.idea_reviewed_at ?? c.created_at, ctx.tz) }))
    .filter((c) => Math.abs(daysBetween(c.lastSeen, ctx.todayYmd)) >= IDEAS_AGING_MIN_DAYS)
    .sort((a, b) => a.lastSeen.localeCompare(b.lastSeen));

  if (stale.length < IDEAS_AGING_MIN_COUNT) return [];

  const oldest = stale[0]!;
  const days = Math.abs(daysBetween(oldest.lastSeen, ctx.todayYmd));
  return [{
    rule_type: 'ideas_aging',
    source_type: 'content',
    source_id: oldest.id,
    title: `${stale.length} ideas aging — review`,
    detail: `Oldest untouched ${days}d: "${oldest.title}". Keep the ones worth keeping, archive the rest.`,
    suggested_action: 'Review ideas',
    score: 25,
    // Occurrence identity is the WEEK, not the anchor idea. Keying on
    // oldest.id would change the dedup identity the moment you Keep or
    // Archive anything — inserting a SECOND item in the same week and
    // resurrecting one you just dismissed. source_id still carries the real
    // idea uuid so the row deep-links and satisfies the not-null column.
    dedup_key: `ideas_aging:all:${isoWeekBucket(ctx.todayYmd)}`,
  }];
}

// Observations cadence rules — a domain with any of these is already tracked
// for staleness on the "Slipping" panel, so Attention skips it (no double
// surface). See lib/observations.ts.
const OBSERVATION_CADENCE_RULES = new Set([
  'days_since_journal',
  'days_since_publish',
  'no_activity_days',
]);

async function ruleDomainStale(db: Db, ctx: Ctx): Promise<CandidateItem[]> {
  const domains = await db.query.stewardship_domains.findMany({
    columns: {
      id: true, name: true, last_shipped_at: true, failure_patterns: true,
      stale_enabled: true, stale_days: true,
    },
    where: and(eq(stewardship_domains.active, true), eq(stewardship_domains.is_system, false)),
  });
  const out: CandidateItem[] = [];
  for (const d of domains) {
    // Per-domain off switch (migration 0040).
    if (d.stale_enabled === false) continue;
    // Skip domains the Observations engine already tracks for staleness.
    const patterns = Array.isArray(d.failure_patterns) ? d.failure_patterns : [];
    if (patterns.some((p) => OBSERVATION_CADENCE_RULES.has((p as { rule?: string })?.rule ?? ''))) continue;
    // Per-domain threshold; null/invalid → the default 21.
    const thresholdDays = typeof d.stale_days === 'number' && d.stale_days > 0 ? d.stale_days : 21;
    const cutoff = daysAgoIso(thresholdDays);
    if (d.last_shipped_at && d.last_shipped_at > cutoff) continue;
    out.push({
      rule_type: 'domain_stale',
      source_type: 'domain',
      source_id: d.id,
      title: `${d.name}: nothing shipped recently`,
      detail: d.last_shipped_at
        ? `Last shipped ${ymdInTz(d.last_shipped_at, ctx.tz)} · ${thresholdDays}d threshold`
        : 'No ship logged yet',
      suggested_action: 'Open domain',
      score: 30,
      dedup_key: `domain_stale:${d.id}:${isoWeekBucket(ctx.todayYmd)}`,
    });
  }
  return out;
}

// Silent clients (CRM port, 0041/0043). Active client companies whose
// last_interaction_at is older than their per-company cadence (null →
// 30 days). Never-contacted clients are the MOST urgent, not exempt.
// Dedup is stable per company (no time bucket): the item persists until
// a conversation is logged — the conversations route live-reconciles it
// to acted_on, and the DB trigger advances last_interaction_at so the
// next sweep doesn't re-raise until the cadence lapses again.
async function ruleCompanySilent(db: Db, _ctx: Ctx): Promise<CandidateItem[]> {
  const rows = await db.query.companies.findMany({
    columns: {
      id: true, name: true, last_interaction_at: true, checkin_interval_days: true,
    },
    where: and(eq(companies.active, true), eq(companies.relationship_type, 'active_client')),
  });
  const out: CandidateItem[] = [];
  for (const c of rows) {
    const interval = typeof c.checkin_interval_days === 'number' && c.checkin_interval_days > 0
      ? c.checkin_interval_days
      : 30;
    const cutoff = daysAgoIso(interval);
    if (c.last_interaction_at && c.last_interaction_at > cutoff) continue;
    const daysSilent = c.last_interaction_at
      ? Math.floor((Date.now() - Date.parse(c.last_interaction_at)) / 86_400_000)
      : null;
    out.push({
      rule_type: 'company_silent',
      source_type: 'company',
      source_id: c.id,
      title: `Silent client: ${c.name}`,
      detail: daysSilent != null ? `No conversation in ${daysSilent} days` : 'No conversation logged yet',
      suggested_action: 'Log a check-in',
      // Score scales with lapse: base 40 + 10/interval overdue, cap 80.
      // Never-contacted reads as maximally silent.
      score: daysSilent == null
        ? 80
        : Math.min(80, 40 + Math.floor(Math.max(0, daysSilent - interval) / interval) * 10),
      dedup_key: `company_silent:${c.id}`,
    });
  }
  return out;
}

// Conversation follow-ups (Wave 2 #4a). The log-conversation form has
// written requires_followup + followup_by since the CRM port (0042) — this
// rule finally consumes them: fire the day the follow-up comes due, score
// ramping as it slips. Per the person_fact precedent, source_type/source_id
// point at the NAVIGABLE parent (company > person > project > task — the
// pages that render the conversation timeline), while the dedup_key carries
// the conversation's own id as the occurrence identity. Week bucket: a
// dismiss quiets the rest of the week, then it re-raises. Resolution is
// marking the follow-up done (requires_followup=false — timeline button or
// the PATCH route), which live-clears the item and stops regeneration;
// moving followup_by out lets auto-resolve expire it. Undated
// requires_followup rows never fire — no date, no nudge.
async function ruleConversationFollowup(db: Db, ctx: Ctx): Promise<CandidateItem[]> {
  const rows = await db.query.conversations.findMany({
    columns: {
      id: true, subject: true, summary: true, followup_by: true,
      company_id: true, person_id: true, project_id: true, task_id: true,
    },
    with: {
      company: { columns: { name: true } },
      person: { columns: { name: true } },
      project: { columns: { name: true } },
    },
    where: and(
      eq(conversations.requires_followup, true),
      isNotNull(conversations.followup_by),
      lte(conversations.followup_by, ctx.todayYmd),
    ),
  });
  const out: CandidateItem[] = [];
  for (const c of rows) {
    if (!c.followup_by) continue;
    const overdue = daysBetween(c.followup_by, ctx.todayYmd);
    const who = c.company?.name ?? c.person?.name ?? c.project?.name ?? null;
    const what = c.subject?.trim() || c.summary;
    // conversations_has_association guarantees at least one of the four.
    const [source_type, source_id]: [CandidateItem['source_type'], string] =
      c.company_id ? ['company', c.company_id]
      : c.person_id ? ['person', c.person_id]
      : c.project_id ? ['project', c.project_id]
      : ['task', c.task_id!];
    out.push({
      rule_type: 'conversation_followup',
      source_type,
      source_id,
      title: `Follow up${who ? ` with ${who}` : ''}: ${what.length > 80 ? `${what.slice(0, 77)}…` : what}`,
      detail: overdue <= 0 ? 'Due today' : `Due ${c.followup_by} · ${overdue}d overdue`,
      suggested_action: 'Open timeline',
      score: 45 + Math.min(35, Math.max(0, overdue) * 5),
      dedup_key: `conversation_followup:${c.id}:${isoWeekBucket(ctx.todayYmd)}`,
    });
  }
  return out;
}

// ─── Rule registry ────────────────────────────────────────────────────────

type RuleFn = (db: Db, ctx: Ctx) => Promise<CandidateItem[]>;
const RULES: { ruleType: string; fn: RuleFn }[] = [
  // rulePersonFact emits three rule_types; list them all so an errored run
  // protects every one of its item families from auto-resolve.
  { ruleType: 'birthday_upcoming', fn: rulePersonFact },
  { ruleType: 'task_due_soon', fn: ruleTaskDueSoon },
  { ruleType: 'task_waiting_aging', fn: ruleTaskWaitingAging },
  { ruleType: 'project_stalled', fn: ruleProjectStalled },
  { ruleType: 'content_stuck_in_editing', fn: ruleContentStuck },
  { ruleType: 'ideas_aging', fn: ruleIdeasAging },
  { ruleType: 'domain_stale', fn: ruleDomainStale },
  { ruleType: 'company_silent', fn: ruleCompanySilent },
  { ruleType: 'conversation_followup', fn: ruleConversationFollowup },
];
// rule_types that share rulePersonFact's fate (see registry note above).
const RULE_ALIASES: Record<string, string[]> = {
  birthday_upcoming: ['birthday_upcoming', 'anniversary_upcoming', 'person_fact_upcoming'],
};

export interface AttentionRunResult {
  candidates: number;
  inserted: number;
  refreshed: number;
  reactivated: number;
  auto_resolved: number;
  expired: number;
  rule_errors: string[];
}

const EXPIRE_DAYS = 60;

export async function runAttention(db: Db): Promise<AttentionRunResult> {
  const result: AttentionRunResult = {
    candidates: 0,
    inserted: 0,
    refreshed: 0,
    reactivated: 0,
    auto_resolved: 0,
    expired: 0,
    rule_errors: [],
  };

  const tz = await getAppTz();
  const todayYmd = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const nowIso = new Date().toISOString();
  const ctx: Ctx = { todayYmd, nowIso, tz };

  // 1. Reactivate snoozes whose date has arrived — they rejoin the active
  //    surface and are then reconciled by source below (so a still-valid one
  //    refreshes, a resolved one gets auto-resolved).
  {
    const reactivated = await db
      .update(attention_items)
      .set({ status: 'active', last_surfaced_at: nowIso })
      .where(and(eq(attention_items.status, 'snoozed'), lte(attention_items.snoozed_until, todayYmd)))
      .returning({ id: attention_items.id });
    result.reactivated = reactivated.length;
  }

  // 2. Run rules (isolated — a rule that throws is recorded and its items are
  //    left untouched by auto-resolve below).
  const candidates: CandidateItem[] = [];
  const ranOk = new Set<string>();
  for (const { ruleType, fn } of RULES) {
    try {
      candidates.push(...(await fn(db, ctx)));
      for (const rt of RULE_ALIASES[ruleType] ?? [ruleType]) ranOk.add(rt);
    } catch (err) {
      result.rule_errors.push(`${ruleType}: ${err instanceof Error ? err.message : 'error'}`);
    }
  }
  result.candidates = candidates.length;

  // 3. Load all stored items. Liveness + auto-resolve key on the OCCURRENCE
  //    identity — the dedup_key minus its trailing time bucket (`rule_type:
  //    entity_id`). This is NOT source_id: for person_fact the identity is the
  //    fact, but source_id is the person, so two upcoming facts for one person
  //    must stay distinct. Dismissed occurrences key on the full dedup_key so
  //    a dismiss scopes to one bucket (e.g. this year's birthday).
  const existing = await db.query.attention_items.findMany({
    columns: { id: true, dedup_key: true, rule_type: true, source_id: true, status: true },
  });
  const liveByBase = new Map<string, { id: string; status: string }>();
  const dismissedKeys = new Set<string>();
  for (const r of existing) {
    if (r.status === 'active' || r.status === 'snoozed') {
      liveByBase.set(baseKey(r.dedup_key), { id: r.id, status: r.status });
    }
    if (r.status === 'dismissed' || r.status === 'acted_on') dismissedKeys.add(r.dedup_key);
  }

  // 4. Reconcile candidates. One live item per occurrence: refresh it if
  //    active, respect it if snoozed. Otherwise honor a same-occurrence
  //    dismiss, else insert a fresh item.
  const toInsert: CandidateItem[] = [];
  const refreshIds: string[] = [];
  const candidateBases = new Set<string>();
  const insertingBases = new Set<string>();
  for (const c of candidates) {
    const bk = baseKey(c.dedup_key);
    candidateBases.add(bk);
    const live = liveByBase.get(bk);
    if (live) {
      if (live.status === 'active') refreshIds.push(live.id);
      continue; // snoozed → leave it snoozed
    }
    if (dismissedKeys.has(c.dedup_key)) continue; // dismissed for this occurrence
    if (insertingBases.has(bk)) continue; // already inserting one for this occurrence
    toInsert.push(c);
    insertingBases.add(bk);
  }

  if (toInsert.length) {
    await db
      .insert(attention_items)
      .values(
        toInsert.map((c) => ({
          rule_type: c.rule_type,
          source_type: c.source_type,
          source_id: c.source_id,
          title: c.title,
          detail: c.detail,
          suggested_action: c.suggested_action,
          score: c.score,
          urgency: urgencyFor(c.score),
          dedup_key: c.dedup_key,
        })),
      )
      .onConflictDoNothing({ target: attention_items.dedup_key });
    result.inserted = toInsert.length;
  }
  if (refreshIds.length) {
    await db
      .update(attention_items)
      .set({ last_surfaced_at: nowIso })
      .where(inArray(attention_items.id, refreshIds));
    result.refreshed = refreshIds.length;
  }

  // 5. Auto-resolve: an active item whose rule ran OK this pass but whose
  //    SOURCE produced no candidate → the situation resolved. Keyed on the
  //    occurrence (not the bucketed dedup_key) so a reactivated item under a
  //    new bucket isn't wrongly expired.
  const autoResolveIds: string[] = [];
  for (const r of existing) {
    if (r.status !== 'active') continue;
    if (!ranOk.has(r.rule_type)) continue; // rule errored → leave alone
    if (candidateBases.has(baseKey(r.dedup_key))) continue;
    autoResolveIds.push(r.id);
  }
  if (autoResolveIds.length) {
    await db
      .update(attention_items)
      .set({ status: 'expired' })
      .where(inArray(attention_items.id, autoResolveIds));
    result.auto_resolved = autoResolveIds.length;
  }

  // 6. Hard expiry: active items older than 60 days with no action.
  {
    const old = await db
      .update(attention_items)
      .set({ status: 'expired' })
      .where(
        and(
          eq(attention_items.status, 'active'),
          lt(attention_items.first_surfaced_at, daysAgoIso(EXPIRE_DAYS)),
        ),
      )
      .returning({ id: attention_items.id });
    result.expired = old.length;
  }

  return result;
}

// Ordering helper for the list route — highest score first, then most
// recently surfaced. Exported so the route and any future consumers agree.
export const ATTENTION_LIST_ORDER = [desc(attention_items.score), desc(attention_items.last_surfaced_at)];
