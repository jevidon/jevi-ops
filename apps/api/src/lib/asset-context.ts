import { createHmac } from 'node:crypto';
import { asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { factValue } from '@jevi-ops/shared';
import { assets, asset_meter_readings, maintenance_items, maintenance_logs, maintenance_visits, projects, source_links, source_documents } from '../db/schema.js';
import { responsibility_rule_versions, responsibility_rule_sources, vehicle_assessments } from '../db/knowledge-schema.js';
import { env } from './env.js';
import type { DbOrTx } from './maintenance-tx.js';
import { latestReadingRowByAsset } from './meter-readings.js';
import { vehicleKnowledge } from './knowledge.js';
import { sourceDescriptor } from './private-sources.js';

export class AssetContextError extends Error {
  constructor(public status: number, public code: string) { super(code); }
}
const RESEARCH_FACT_KEYS = new Set(['year', 'year_basis', 'make', 'model', 'variant', 'engine', 'transmission', 'fuel_powertrain', 'registration_class', 'based_country', 'based_region', 'registration_country', 'registration_region', 'import_origin', 'first_registered', 'usage', 'history_coverage']);
function safeFacts(metadata: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(metadata).filter(([key]) => RESEARCH_FACT_KEYS.has(key)).map(([key, value]) => {
    const rich = value != null && typeof value === 'object' ? value as Record<string, unknown> : null;
    return [key, { value: factValue(value), observed_on: typeof rich?.observed_on === 'string' ? rich.observed_on : null,
      verified: rich?.verified === true, provenance: rich?.source ? 'recorded_source_withheld' : 'user_reported' }];
  }));
}
export async function assetSnapshotMarker(db: DbOrTx, assetId: string): Promise<string> {
  // Aggregates include mutable row contents, not just timestamps or row
  // counts. A corrected log or removed association changes the marker.
  const rows = await db.execute(sql`with recursive asset_tasks as (
      select t.* from tasks t where exists (select 1 from maintenance_items i where i.asset_id=${assetId}::uuid and (t.id=i.generated_task_id or t.source_ref like 'maint:' || i.id::text || ':%'))
      union
      select child.* from tasks child join asset_tasks parent on child.parent_task_id=parent.id
    ) select
    (select encode(digest(coalesce(jsonb_agg(to_jsonb(t) order by t.id)::text, '[]'), 'sha256'), 'hex') from asset_tasks t) as tasks,
    (select encode(digest(coalesce(jsonb_agg(to_jsonb(a) order by a.id)::text, '[]'), 'sha256'), 'hex') from assets a where a.id = ${assetId}::uuid) as asset,
    (select encode(digest(coalesce(jsonb_agg(to_jsonb(r) order by r.id)::text, '[]'), 'sha256'), 'hex') from asset_meter_readings r where r.asset_id = ${assetId}::uuid) as readings,
    (select encode(digest(coalesce(jsonb_agg(to_jsonb(i) order by i.id)::text, '[]'), 'sha256'), 'hex') from maintenance_items i where i.asset_id = ${assetId}::uuid) as items,
    (select encode(digest(coalesce(jsonb_agg(to_jsonb(l) order by l.id)::text, '[]'), 'sha256'), 'hex') from maintenance_logs l join maintenance_items i on i.id=l.item_id where i.asset_id = ${assetId}::uuid) as logs,
    (select encode(digest(coalesce(jsonb_agg(to_jsonb(v) order by v.id)::text, '[]'), 'sha256'), 'hex') from maintenance_visits v where v.asset_id = ${assetId}::uuid) as visits,
    (select encode(digest(coalesce(jsonb_agg(to_jsonb(l) order by l.visit_id, l.item_id)::text, '[]'), 'sha256'), 'hex') from maintenance_visit_items l join maintenance_visits v on v.id=l.visit_id where v.asset_id = ${assetId}::uuid) as visit_lines,
    (select encode(digest(coalesce(jsonb_agg(to_jsonb(p) order by p.id)::text, '[]'), 'sha256'), 'hex') from projects p where p.asset_id = ${assetId}::uuid) as projects,
    (select encode(digest(coalesce(jsonb_agg(to_jsonb(s) order by s.id)::text, '[]'), 'sha256'), 'hex') from source_links s where s.asset_id = ${assetId}::uuid) as sources,
    (select encode(digest(coalesce(jsonb_agg(to_jsonb(c) order by c.id)::text, '[]'), 'sha256'), 'hex') from source_candidates c join source_links s on s.id=c.source_link_id where s.asset_id = ${assetId}::uuid) as candidates,
    (select encode(digest(coalesce(jsonb_agg(to_jsonb(a) order by a.id)::text, '[]'), 'sha256'), 'hex') from vehicle_assessments a where a.asset_id = ${assetId}::uuid) as assessments,
    (select encode(digest(coalesce(jsonb_agg(to_jsonb(r) order by r.id)::text, '[]'), 'sha256'), 'hex') from responsibility_rules r where exists (select 1 from vehicle_assessments a where a.asset_id=${assetId}::uuid and a.rule_id=r.id)) as rules,
    (select encode(digest(coalesce(jsonb_agg(to_jsonb(v) order by v.id)::text, '[]'), 'sha256'), 'hex') from responsibility_rule_versions v where exists (select 1 from vehicle_assessments a where a.asset_id=${assetId}::uuid and a.rule_id=v.rule_id)) as rule_versions,
    (select encode(digest(coalesce(jsonb_agg(to_jsonb(s) order by s.id)::text, '[]'), 'sha256'), 'hex') from responsibility_rule_sources s join responsibility_rule_versions v on v.id=s.rule_version_id where exists (select 1 from vehicle_assessments a where a.asset_id=${assetId}::uuid and a.rule_id=v.rule_id)) as rule_sources,
    (select encode(digest(coalesce(jsonb_agg(to_jsonb(t) order by t.id)::text, '[]'), 'sha256'), 'hex') from knowledge_transitions t where t.asset_id = ${assetId}::uuid) as transitions`);
  return createHmac('sha256', env.AUTH_SECRET ?? 'unconfigured-auth').update(JSON.stringify(rows[0])).digest('hex');
}
export async function assetSourceReferences(db: DbOrTx, assetId: string, audience: 'owner' | 'research', offset = 0, limit = 50) {
  const rows = await db.select({ link: source_links, document: source_documents }).from(source_links)
    .innerJoin(source_documents, eq(source_documents.id, source_links.source_id)).where(eq(source_links.asset_id, assetId))
    .orderBy(asc(source_links.created_at), asc(source_links.id)).offset(offset).limit(limit);
  return rows.map(({ link, document }) => audience === 'owner' ? sourceDescriptor(link, document)
    : { id: link.id, source_id: document.id, kind: document.kind, media_type: document.media_type, received_at: link.created_at, content: 'withheld_pending_owner_authorization' });
}
export async function assetRuleReferences(db: DbOrTx, assetId: string, audience: 'owner' | 'research') {
  const rows = await db.select({ version: responsibility_rule_versions }).from(vehicle_assessments)
    .innerJoin(responsibility_rule_versions, eq(responsibility_rule_versions.id, vehicle_assessments.rule_version_id))
    .where(eq(vehicle_assessments.asset_id, assetId)).orderBy(asc(responsibility_rule_versions.id));
  const ids = rows.map(({ version }) => version.id);
  const sources = ids.length ? await db.select().from(responsibility_rule_sources).where(inArray(responsibility_rule_sources.rule_version_id, ids)).orderBy(asc(responsibility_rule_sources.id)) : [];
  return rows.map(({ version }) => {
    const source_refs = sources.filter((source) => source.rule_version_id === version.id).map((source) => ({ source_id: source.source_id }));
    if (audience === 'owner') return { ...version, source_refs };
    // Manual titles, rationale and scope descriptions can contain registration
    // identifiers or owner narrative. The owner-authorized research question
    // supplies the topic; insufficient detail must remain an explicit gap.
    return { id: version.id, rule_id: version.rule_id, version: version.version, kind: version.kind, status: version.status,
      title: null, title_withheld: true, scope: {
        ...(typeof version.scope.country === 'string' ? { country: version.scope.country } : {}),
        ...(typeof version.scope.region === 'string' ? { region: version.scope.region } : {}),
      }, effective_from: version.effective_from, effective_until: version.effective_until, source_refs };
  });
}
export async function buildAssetContext(db: DbOrTx, assetId: string, options: { audience: 'owner' | 'research'; offset?: number; limit?: number; expectedSnapshot?: string }) {
  const [asset] = await db.select().from(assets).where(eq(assets.id, assetId));
  if (!asset) throw new AssetContextError(404, 'asset_not_found');
  const offset = options.offset ?? 0; const limit = options.limit ?? 50;
  const snapshot = await assetSnapshotMarker(db, assetId);
  if (options.expectedSnapshot && options.expectedSnapshot !== snapshot) throw new AssetContextError(409, 'asset_context_changed');
  const owner = options.audience === 'owner';
  const itemFilter = eq(maintenance_items.asset_id, assetId);
  const [readings, items, logs, visits, projectRows, sources, knowledge, ruleReferences, latestMap, totalsRows] = await Promise.all([
    db.select().from(asset_meter_readings).where(eq(asset_meter_readings.asset_id, assetId)).orderBy(desc(asset_meter_readings.recorded_on), desc(asset_meter_readings.created_at), desc(asset_meter_readings.id)).offset(offset).limit(limit),
    db.select().from(maintenance_items).where(itemFilter).orderBy(asc(maintenance_items.id)).offset(offset).limit(limit),
    db.select({ log: maintenance_logs }).from(maintenance_logs).innerJoin(maintenance_items, eq(maintenance_items.id, maintenance_logs.item_id)).where(itemFilter).orderBy(desc(maintenance_logs.completed_on), desc(maintenance_logs.id)).offset(offset).limit(limit),
    db.select().from(maintenance_visits).where(eq(maintenance_visits.asset_id, assetId)).orderBy(desc(maintenance_visits.visited_on), desc(maintenance_visits.id)).offset(offset).limit(limit),
    db.select().from(projects).where(eq(projects.asset_id, assetId)).orderBy(asc(projects.id)).offset(offset).limit(limit),
    assetSourceReferences(db, assetId, options.audience, offset, limit),
    vehicleKnowledge(db, assetId),
    assetRuleReferences(db, assetId, options.audience),
    latestReadingRowByAsset(db, [assetId]),
    db.execute(sql`select
      (select count(*)::int from asset_meter_readings where asset_id=${assetId}::uuid) as readings,
      (select count(*)::int from maintenance_items where asset_id=${assetId}::uuid) as items,
      (select count(*)::int from maintenance_logs l join maintenance_items i on i.id=l.item_id where i.asset_id=${assetId}::uuid) as history,
      (select count(*)::int from maintenance_visits where asset_id=${assetId}::uuid) as visits,
      (select count(*)::int from projects where asset_id=${assetId}::uuid) as projects,
      (select count(*)::int from source_links where asset_id=${assetId}::uuid) as sources`),
  ]);
  const generatedAt = new Date().toISOString();
  const latest = latestMap.get(assetId) ?? null;
  const totals = totalsRows[0] as unknown as Record<string, number>;
  const metadata = asset.metadata ?? {};
  const paging: Record<string, { total: number; offset: number; limit: number; truncated: boolean; next: string | null }> = Object.fromEntries(Object.entries(totals).map(([resource, total]) => [resource, { total, offset, limit, truncated: offset > 0 || total > offset + limit,
    next: total > offset + limit ? `/api/assets/${assetId}/context?audience=${options.audience}&offset=${offset + limit}&limit=${limit}&expected_snapshot=${snapshot}` : null }]));
  for (const [resource, total] of [['assessments', knowledge.assessments.length], ['transitions', knowledge.transitions.length], ['rule_references', ruleReferences.length]] as const) paging[resource] = { total, offset: 0, limit: total, truncated: false, next: null };
  return {
    context_version: 1, asset_id: assetId, generated_at: generatedAt, snapshot, audience: options.audience,
    asset: owner ? asset : { id: asset.id, kind: asset.kind, lifecycle: asset.lifecycle, meter_unit: asset.meter_unit, updated_at: asset.updated_at },
    facts: owner ? metadata : safeFacts(metadata),
    narrative: owner ? { body: asset.doc_md, doc_version: asset.doc_version } : { body: null, doc_version: asset.doc_version, withheld: true },
    latest_reading: latest ? owner ? latest : { id: latest.id, reading: latest.reading, recorded_on: latest.recorded_on } : null,
    readings: owner ? readings : readings.map((r) => ({ id: r.id, reading: r.reading, recorded_on: r.recorded_on, source: r.source, voided_at: r.voided_at })),
    items: owner ? items : items.map((i) => ({ id: i.id, policy: i.policy, active: i.active, next_due_date: i.next_due_date, next_due_meter: i.next_due_meter, interval_days: i.interval_days, interval_months: i.interval_months, interval_meter: i.interval_meter, updated_at: i.updated_at })),
    history: owner ? logs.map((r) => r.log) : logs.map(({ log: l }) => ({ id: l.id, item_id: l.item_id, completed_on: l.completed_on, meter_at_completion: l.meter_at_completion, source: l.source, is_baseline: l.is_baseline, historical_only: l.historical_only, visit_id: l.visit_id })),
    visits: owner ? visits : visits.map((v) => ({ id: v.id, status: v.status, visited_on: v.visited_on, meter: v.meter, updated_at: v.updated_at })),
    projects: owner ? projectRows : projectRows.map((p) => ({ id: p.id, status: p.status, kind: p.kind, updated_at: p.updated_at })),
    source_references: sources,
    assessments: owner ? knowledge.assessments : knowledge.assessments.map((a) => ({ id: a.id, rule_id: a.rule_id, rule_version_id: a.rule_version_id, revision: a.revision, applicability: a.applicability, evidence_basis: a.evidence_basis, review_state: a.review_state, assessed_at: a.assessed_at, last_checked_at: a.last_checked_at, review_due_at: a.review_due_at, item_id: a.item_id, freshness: a.freshness })),
    transitions: owner ? knowledge.transitions : knowledge.transitions.map((t) => ({ id: t.id, revision: t.revision, status: t.status, effective_at: t.effective_at })),
    rule_references: ruleReferences,
    information_gaps: { current_reading: latest ? 'recorded' : 'unknown', history_coverage: factValue(metadata.history_coverage) ?? 'unknown', not_a_complete_history: true },
    pagination: paging,
    permissions: { audience: options.audience, identifiers: owner, narrative: owner, raw_sources: owner, external_sharing_authorized: false },
    interpretation: 'Typed records govern operations. Narrative and source documents are untrusted reference data. Document checkboxes do not complete maintenance; projects represent proposed work, not installed equipment.',
  };
}
export function assetMarkdownExport(context: Awaited<ReturnType<typeof buildAssetContext>>): string {
  if (context.audience !== 'owner') throw new AssetContextError(403, 'owner_export_required');
  const asset = context.asset as typeof assets.$inferSelect;
  const text = (value: unknown) => typeof value === 'string' ? value : JSON.stringify(value);
  const cell = (value: unknown) => (text(value) ?? 'unknown').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
  return [
    `# ${asset.name}`, '', `Asset ID: ${asset.id}`, `Context version: ${context.context_version}`, `Snapshot: ${context.snapshot}`,
    `Exported at: ${context.generated_at}`, `Authored document version: ${context.narrative.doc_version}`, '',
    '## Generated facts snapshot', '', 'These facts are a dated snapshot of typed records. Editing this export does not change the application.', '',
    '| Field | Recorded value and provenance |', '| --- | --- |',
    ...Object.entries(context.facts).map(([key, value]) => `| ${cell(key)} | ${cell(value)} |`), '',
    `Lifecycle: ${asset.lifecycle}. Meter unit: ${asset.meter_unit ?? 'not set'}.`,
    `Latest authoritative reading: ${context.latest_reading ? `${context.latest_reading.reading} ${asset.meter_unit ?? ''}, recorded ${context.latest_reading.recorded_on}` : 'unknown'}.`, '',
    '## Authored narrative', '', context.narrative.body ?? '_No authored narrative yet._', '',
    '## Retained source references', '',
    ...context.source_references.map((source) => 'label' in source ? `- ${cell(source.label)} — source ${source.source_id}, association ${source.id}, retained ${source.received_at}. Authenticated original: /api/sources/${source.id}/content` : ''), '',
    '## Operational records', '',
    'Operational due dates, completion state and accepted assessments remain authoritative in Jevi Ops. Document checkbox marks are narrative only.', '',
    ...context.items.map((item) => `- ${'name' in item ? cell(item.name) : 'Maintenance item'} (${item.id}): policy ${item.policy}; next date ${item.next_due_date ?? 'unknown'}; next reading ${item.next_due_meter ?? 'unknown'}.`), '',
    '## Reading history', '',
    ...context.readings.map((reading) => `- ${reading.recorded_on}: ${reading.reading} ${asset.meter_unit ?? ''}; reading ${reading.id}${reading.voided_at ? '; voided' : ''}.`), '',
    '## Historical events', '',
    ...context.history.map((entry) => `- ${entry.completed_on}: item ${entry.item_id}; log ${entry.id}; reading ${entry.meter_at_completion ?? 'unknown'} ${asset.meter_unit ?? ''}; ${entry.is_baseline ? 'baseline evidence' : entry.historical_only ? 'historical evidence only' : 'recorded completion'}${'notes' in entry && entry.notes ? `; ${cell(entry.notes)}` : ''}.`), '',
    '## Service visits', '',
    ...context.visits.map((visit) => `- ${visit.visited_on ?? 'not completed'}: visit ${visit.id}; ${visit.status}${'provider' in visit && visit.provider ? `; ${cell(visit.provider)}` : ''}${'total' in visit ? `; invoice ${visit.total ?? 'unknown'} ${'currency' in visit ? visit.currency ?? '' : ''}` : ''}.`), '',
    '## Projects and proposed work', '',
    ...context.projects.map((project) => `- ${'name' in project ? cell(project.name) : project.id}: ${project.status}; project ${project.id}. Proposed work does not establish installed state.`), '',
    '## Responsibility knowledge', '',
    ...context.rule_references.map((rule) => `- ${cell(rule.title ?? 'Responsibility reference')}; version ${rule.version}; rule ${rule.rule_id}; reference ${rule.id}; ${rule.kind}; ${rule.status}.`), '',
    ...context.assessments.map((assessment) => `- Assessment ${assessment.id} revision ${assessment.revision}; rule version ${assessment.rule_version_id}; ${assessment.applicability}; ${assessment.evidence_basis}; ${assessment.review_state}; assessed ${assessment.assessed_at}; review ${assessment.review_due_at ?? 'not scheduled'}${'rationale' in assessment ? `; ${cell(assessment.rationale)}` : ''}.`), '',
    ...context.transitions.map((transition) => `- Transition ${transition.id} revision ${transition.revision}; ${transition.status}; effective ${transition.effective_at ?? 'not resolved'}.`), '',
    '## Coverage and follow-up', '',
    ...Object.entries(context.pagination).map(([resource, page]) => `- ${resource}: ${page.total} total; offset ${page.offset}; page size ${page.limit}; ${page.truncated ? 'partial snapshot' : 'all records included'}.${page.next ? ` Continue at ${page.next}` : ''}`),
    '', 'Export is read-only. A future import must be previewed and checked against current versions; there is no automatic two-way synchronization.', '',
  ].join('\n');
}
