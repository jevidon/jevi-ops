import { createHash } from 'node:crypto';
import { and, asc, desc, eq, inArray, isNotNull, like, lte, or, sql } from 'drizzle-orm';
import {
  INBOX_DOMAIN_ID, AcceptKnowledgeChangeSchema, CancelKnowledgeTransitionSchema, KnowledgeChangeSchema,
  ResponsibilityVersionInputSchema, ReviseResponsibilitySchema,
  type KnowledgeChange, type KnowledgeChangeInput, type KnowledgeEffectiveTime,
  type KnowledgePreconditions, type KnowledgePreviewChange, type KnowledgeReceipt, type ResponsibilityVersionInput,
} from '@jevi-ops/shared';
import { assets, app_settings, asset_meter_readings, maintenance_items, maintenance_logs, tasks } from '../db/schema.js';
import { source_documents, source_links } from '../db/source-schema.js';
import {
  knowledge_change_previews, knowledge_transitions, knowledge_transition_history,
  responsibility_rules, responsibility_rule_versions, responsibility_rule_sources,
  vehicle_assessments, vehicle_assessment_history,
} from '../db/knowledge-schema.js';
import { formatInTz } from './tz.js';
import { updateAsset } from './asset-commands.js';
import { createMaintenanceItem, updateMaintenanceItem } from './maintenance-commands.js';
import { CommandError, jsonEqual } from './command-error.js';
import { recordAssessmentHistory } from './knowledge-invalidation.js';
import { inTransaction, type DbOrTx, type Tx } from './maintenance-tx.js';
import type { ScheduleContext } from './maintenance.js';

const APPLICABILITY_KEYS = ['based_country', 'based_region', 'registration_country', 'registration_region', 'fuel_powertrain', 'engine', 'registration_class', 'import_origin', 'year', 'year_basis'];
const jsonSnapshot = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
export function knowledgeFingerprint(value: unknown): string { return createHash('sha256').update(canonical(value)).digest('hex'); }

// Date-only evidence requires an explicit jurisdiction timezone. Resolve local
// midnight with Intl and verify its exact round-trip; nonexistent/ambiguous
// midnight dates are retained unresolved instead of guessing an instant.
export function resolveKnowledgeEffectiveTime(time?: KnowledgeEffectiveTime | null): string | null {
  if (!time || time.kind === 'unknown') return null;
  if (time.kind === 'instant') return new Date(time.at).toISOString();
  if (!time.timezone) return null;
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat('en-CA', { timeZone: time.timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  } catch { throw new CommandError(400, 'invalid_timezone', 'Use an explicit IANA jurisdiction timezone for this date.'); }
  const target = Date.parse(`${time.date}T00:00:00Z`);
  function wall(ms: number) {
    const parts = formatter.formatToParts(new Date(ms));
    const part = (type: string) => Number(parts.find((p) => p.type === type)?.value);
    return Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute'), part('second'));
  }
  const offsets = new Set([-36, -24, -12, 0, 12, 24, 36].map((hours) => {
    const at = target + hours * 3_600_000;
    return wall(at) - at;
  }));
  const matches = [...offsets].map((offset) => target - offset).filter((at) => wall(at) === target);
  return matches.length === 1 ? new Date(matches[0]!).toISOString() : null;
}

async function sourceState(tx: Tx, sourceIds: string[]): Promise<Array<{ id: string; content_hash: string }>> {
  const ids = [...new Set(sourceIds)].sort();
  if (!ids.length) return [];
  const rows = await tx.select({ id: source_documents.id, content_hash: source_documents.content_hash }).from(source_documents).where(inArray(source_documents.id, ids)).orderBy(asc(source_documents.id));
  if (rows.length !== ids.length) throw new CommandError(400, 'source_not_found', 'One or more evidence sources no longer exist.');
  return rows;
}

async function insertRuleVersion(tx: Tx, ruleId: string, version: number, input: ResponsibilityVersionInput, actor: string) {
  const data = ResponsibilityVersionInputSchema.parse(input);
  await sourceState(tx, data.source_ids);
  const from = resolveKnowledgeEffectiveTime(data.effective_from);
  const until = resolveKnowledgeEffectiveTime(data.effective_until);
  if (from && until && Date.parse(from) >= Date.parse(until)) throw new CommandError(400, 'invalid_effective_range', 'The effective end must be after its start.');
  const [row] = await tx.insert(responsibility_rule_versions).values({
    rule_id: ruleId, version, title: data.title, kind: data.kind, scope: data.scope ?? {}, status: data.status,
    source_note: data.source_note ?? null, published_at: data.published_at ?? null, retrieved_at: data.retrieved_at ?? null,
    effective_from: data.effective_from ?? null, effective_until: data.effective_until ?? null,
    effective_from_at: from, effective_until_at: until, reason: data.reason, actor,
  }).returning();
  if (!row) throw new Error('insert_returned_no_row');
  for (const id of new Set(data.source_ids)) await tx.insert(responsibility_rule_sources).values({ rule_version_id: row.id, source_id: id });
  return { ...row, source_ids: [...new Set(data.source_ids)] };
}

export async function createResponsibilityRule(db: DbOrTx, input: ResponsibilityVersionInput, actor: string) {
  const data = ResponsibilityVersionInputSchema.parse(input);
  const fingerprint = knowledgeFingerprint(data);
  return inTransaction(db, async (tx) => {
    if (data.creation_key) {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`responsibility:${actor}:${data.creation_key}`}, 0))`);
      const [prior] = await tx.select().from(responsibility_rules).where(and(eq(responsibility_rules.creation_actor, actor), eq(responsibility_rules.creation_key, data.creation_key)));
      if (prior) {
        if (prior.creation_fingerprint !== fingerprint) throw new CommandError(409, 'operation_key_conflict', 'This creation key belongs to a different responsibility definition.');
        const [version] = await tx.select().from(responsibility_rule_versions).where(and(eq(responsibility_rule_versions.rule_id, prior.id), eq(responsibility_rule_versions.version, 1)));
        if (!version) throw new Error('responsibility_initial_version_missing');
        const sources = await tx.select({ id: responsibility_rule_sources.source_id }).from(responsibility_rule_sources).where(eq(responsibility_rule_sources.rule_version_id, version.id));
        return { ...version, source_ids: sources.map((source) => source.id) };
      }
    }
    const [rule] = await tx.insert(responsibility_rules).values({ creation_key: data.creation_key ?? null, creation_actor: data.creation_key ? actor : null, creation_fingerprint: data.creation_key ? fingerprint : null }).returning();
    if (!rule) throw new Error('insert_returned_no_row');
    return insertRuleVersion(tx, rule.id, 1, input, actor);
  });
}

export async function reviseResponsibilityRule(db: DbOrTx, ruleId: string, input: unknown, actor: string) {
  const { expected_version, ...data } = ReviseResponsibilitySchema.parse(input);
  return inTransaction(db, async (tx) => {
    const [rule] = await tx.select().from(responsibility_rules).where(eq(responsibility_rules.id, ruleId)).for('update');
    if (!rule) throw new CommandError(404, 'not_found', 'Responsibility reference not found.');
    if (rule.current_version !== expected_version) throw new CommandError(409, 'rule_conflict', 'The responsibility reference changed. Reload its latest version.');
    const version = await insertRuleVersion(tx, ruleId, rule.current_version + 1, data, actor);
    await tx.update(responsibility_rules).set({ current_version: version.version }).where(eq(responsibility_rules.id, ruleId));
    const assessments = await tx.select().from(vehicle_assessments).where(eq(vehicle_assessments.rule_id, ruleId)).orderBy(asc(vehicle_assessments.id)).for('update');
    for (const current of assessments) {
      const [updated] = await tx.update(vehicle_assessments).set({ review_state: 'needs_review', revision: current.revision + 1, invalidation_reason: `Responsibility reference updated to version ${version.version}.`, updated_at: new Date().toISOString() }).where(eq(vehicle_assessments.id, current.id)).returning();
      if (updated) await recordAssessmentHistory(tx, updated, actor, data.reason);
    }
    return version;
  });
}

export async function listResponsibilityRules(db: DbOrTx) {
  return db.select({ rule: responsibility_rules, version: responsibility_rule_versions }).from(responsibility_rules)
    .innerJoin(responsibility_rule_versions, and(eq(responsibility_rule_versions.rule_id, responsibility_rules.id), eq(responsibility_rule_versions.version, responsibility_rules.current_version)))
    .orderBy(asc(responsibility_rule_versions.title));
}

async function capturePreconditions(tx: Tx, operation: KnowledgeChange): Promise<KnowledgePreconditions> {
  const [asset] = await tx.select().from(assets).where(eq(assets.id, operation.asset_id)).for('update');
  if (!asset) throw new CommandError(404, 'not_found', 'Asset not found.');
  const [version] = await tx.select().from(responsibility_rule_versions).where(eq(responsibility_rule_versions.id, operation.rule_version_id));
  if (!version) throw new CommandError(404, 'not_found', 'Responsibility version not found.');
  const [rule] = await tx.select().from(responsibility_rules).where(eq(responsibility_rules.id, version.rule_id)).for('update');
  if (!rule) throw new CommandError(404, 'not_found', 'Responsibility reference not found.');
  const [assessment] = await tx.select().from(vehicle_assessments).where(and(eq(vehicle_assessments.asset_id, asset.id), eq(vehicle_assessments.rule_id, rule.id)));
  const itemId = operation.tracking && operation.tracking.action !== 'create' ? operation.tracking.item_id : assessment?.item_id;
  let item: typeof maintenance_items.$inferSelect | null = null;
  let task: typeof tasks.$inferSelect | null = null;
  if (itemId) {
    const [found] = await tx.select().from(maintenance_items).where(eq(maintenance_items.id, itemId)).for('update');
    if (!found || found.asset_id !== asset.id) throw new CommandError(409, 'item_conflict', 'The tracking item is missing or belongs to another asset.');
    item = found;
    if (found.generated_task_id) {
      const [foundTask] = await tx.select().from(tasks).where(eq(tasks.id, found.generated_task_id)).for('update');
      task = foundTask ?? null;
    }
  }
  const readings = await tx.select().from(asset_meter_readings).where(eq(asset_meter_readings.asset_id, asset.id)).orderBy(asc(asset_meter_readings.id));
  const logs = item ? await tx.select().from(maintenance_logs).where(eq(maintenance_logs.item_id, item.id)).orderBy(asc(maintenance_logs.id)) : null;
  const relatedTasks = item ? await tx.select().from(tasks).where(or(and(eq(tasks.source, 'maintenance'), like(tasks.source_ref, `maint:${item.id}:%`)), task ? eq(tasks.parent_task_id, task.id) : undefined)).orderBy(asc(tasks.id)).for('update') : null;
  const ruleSources = await tx.select({ id: responsibility_rule_sources.source_id }).from(responsibility_rule_sources).where(eq(responsibility_rule_sources.rule_version_id, version.id));
  const sources = await sourceState(tx, [...ruleSources.map((s) => s.id), ...operation.assessment.source_ids]);
  const keys = [...new Set([...APPLICABILITY_KEYS, ...operation.assessment.relevant_fact_keys, ...Object.keys(operation.facts_patch?.set ?? {}), ...Object.keys(operation.facts_patch?.unset ?? {})])].sort();
  const [settings] = operation.tracking ? await tx.select({ timezone: app_settings.timezone, staleDays: app_settings.meter_stale_days }).from(app_settings).where(eq(app_settings.id, true)).for('share') : [];
  if (operation.tracking && !settings) throw new CommandError(409, 'settings_unavailable', 'Scheduling settings are unavailable.');
  return jsonSnapshot({
    scheduling: settings ? { timezone: settings.timezone ?? 'America/Denver', staleDays: settings.staleDays ?? 14 } : null,
    asset: { id: asset.id, lifecycle: asset.lifecycle, domain_id: asset.domain_id, meter_unit: asset.meter_unit, updated_at: asset.updated_at, facts: Object.fromEntries(keys.map((key) => [key, asset.metadata?.[key] ?? null])) },
    rule: { id: rule.id, current_version: rule.current_version, version_id: version.id, status: version.status },
    sources, assessment: assessment ?? null, item, task, reading_fingerprint: knowledgeFingerprint(readings),
    item_evidence_fingerprint: logs ? knowledgeFingerprint(logs) : null, task_context_fingerprint: relatedTasks ? knowledgeFingerprint(relatedTasks) : null,
  });
}

async function validateOperation(tx: Tx, operation: KnowledgeChange, state: KnowledgePreconditions, now: string, applying: boolean): Promise<void> {
  const [version] = await tx.select().from(responsibility_rule_versions).where(eq(responsibility_rule_versions.id, operation.rule_version_id));
  if (!version || state.rule.current_version !== version.version) throw new CommandError(409, 'rule_conflict', 'A newer responsibility version requires a fresh review.');
  if (operation.assessment.evidence_basis !== 'user_reported' && !state.sources.length) throw new CommandError(400, 'evidence_required', 'Document or official-source support requires a retained evidence source.');
  if (operation.assessment.assessed_at && Date.parse(operation.assessment.assessed_at) > Date.parse(now)) throw new CommandError(400, 'future_assessment', 'An assessment cannot claim it was already performed in the future.');
  if (operation.assessment.last_checked_at && Date.parse(operation.assessment.last_checked_at) > Date.parse(now)) throw new CommandError(400, 'future_check', 'A completed evidence check cannot be in the future.');
  const tracking = operation.tracking;
  if (tracking?.action === 'create' && tracking.item.asset_id && tracking.item.asset_id !== operation.asset_id) throw new CommandError(400, 'asset_mismatch', 'Tracking must belong to the assessed asset.');
  if (tracking?.action === 'update' && 'asset_id' in tracking.patch && tracking.patch.asset_id !== operation.asset_id) throw new CommandError(400, 'asset_mismatch', 'A knowledge change cannot move a tracking item to another asset.');
  if (tracking?.action === 'create' && state.assessment?.item_id) throw new CommandError(409, 'tracking_exists', 'This responsibility already has tracking. Update the linked item instead.');
  const remainsActive = tracking?.action === 'create' || (tracking?.action === 'update' ? (tracking.patch.active ?? state.item?.active) === true : state.item?.active === true);
  if (remainsActive && operation.assessment.review_state === 'accepted' &&
      (version.status !== 'accepted' || (version.kind === 'regulatory' && operation.assessment.applicability !== 'applicable'))) {
    throw new CommandError(400, tracking ? (version.status !== 'accepted' ? 'rule_not_accepted' : 'applicability_unknown') : 'tracking_change_required',
      'The accepted knowledge does not support active regulatory tracking. Include its deactivation, or record optional tracking under a user reminder.');
  }
  const activates = tracking?.action === 'create' || (tracking?.action === 'update' && tracking.patch.active !== false && (state.item?.active !== false || tracking.patch.active === true)) || (tracking?.action === 'link' && state.item?.active === true);
  if (activates) {
    if (state.asset.lifecycle !== 'active') throw new CommandError(409, 'inactive_asset', 'An inactive asset cannot activate an obligation.');
    if (operation.assessment.review_state !== 'accepted') throw new CommandError(400, 'assessment_not_accepted', 'Accept the assessment before activating tracking.');
    if (version.status !== 'accepted') throw new CommandError(400, 'rule_not_accepted', 'Proposed or withdrawn rules cannot activate tracking.');
    if (version.kind === 'regulatory' && operation.assessment.applicability !== 'applicable') throw new CommandError(400, 'applicability_unknown', 'Keep unknown or negative regulatory assessments descriptive; use a user reminder for optional tracking.');
    const plannedAt = operation.effective ? resolveKnowledgeEffectiveTime(operation.effective) : now;
    if (version.effective_from && !version.effective_from_at && (applying || plannedAt)) throw new CommandError(400, 'effective_time_unresolved', 'Establish the rule effective instant before activating its obligation.');
    if (version.effective_from_at && plannedAt && Date.parse(plannedAt) < Date.parse(version.effective_from_at)) throw new CommandError(400, 'rule_not_effective', 'Tracking cannot activate before the accepted rule takes effect.');
    if (applying && version.effective_from_at && Date.parse(now) < Date.parse(version.effective_from_at)) throw new CommandError(409, 'rule_not_effective', 'The rule is not yet effective.');
    if (version.effective_until_at && (applying ? now : plannedAt) && Date.parse((applying ? now : plannedAt)!) >= Date.parse(version.effective_until_at)) throw new CommandError(409, 'rule_expired', 'The rule is no longer in force at this activation time.');
  }
  for (const section of ['set', 'unset'] as const) for (const [key, entry] of Object.entries(operation.facts_patch?.[section] ?? {})) {
    if (!jsonEqual(state.asset.facts[key], entry.expected)) throw new CommandError(409, 'fact_conflict', `Vehicle fact ${key} changed. Reload and review it.`);
  }
}

function describeChanges(operation: KnowledgeChange, state: KnowledgePreconditions): KnowledgePreviewChange[] {
  const changes: KnowledgePreviewChange[] = [{ kind: 'assessment', label: 'Record the dated applicability assessment and its evidence basis', before: state.assessment, after: operation.assessment }];
  if (operation.facts_patch) changes.push({ kind: 'facts', label: 'Update only the accepted vehicle facts; dependent assessments require review', before: state.asset.facts, after: operation.facts_patch });
  if (operation.tracking) changes.push({ kind: 'tracking', label: operation.tracking.action === 'create' ? 'Create tracking using the maintenance engine' : 'Update the existing tracking; annotated generated work is preserved by the maintenance engine', before: { item: state.item, generated_task: state.task }, after: operation.tracking });
  if (operation.effective) changes.push({ kind: 'effective_time', label: 'Activate only at the accepted effective instant after rechecking this state', after: { time_basis: operation.effective, effective_at: resolveKnowledgeEffectiveTime(operation.effective) } });
  return changes;
}

class TrackingProjection extends Error {
  constructor(public projection: Record<string, unknown>) { super('rollback_preview_projection'); }
}
async function projectTracking(tx: Tx, operation: KnowledgeChange, state: KnowledgePreconditions, actor: string, now: string) {
  if (!operation.tracking || operation.tracking.action === 'link') return null;
  const settings = state.scheduling!;
  const effectiveAt = resolveKnowledgeEffectiveTime(operation.effective);
  const evaluationInstant = effectiveAt && Date.parse(effectiveAt) > Date.parse(now) ? effectiveAt : now;
  const context = { today: formatInTz(new Date(evaluationInstant), settings.timezone), staleDays: settings.staleDays };
  try {
    await tx.transaction(async (nested) => {
      const tracking = operation.tracking!;
      const item = tracking.action === 'create'
        ? await createMaintenanceItem(nested, { ...tracking.item, asset_id: operation.asset_id }, actor)
        : tracking.action === 'update' ? await updateMaintenanceItem(nested, tracking.item_id, tracking.patch, context) : null;
      if (!item) return;
      const priorTaskId = typeof state.task?.id === 'string' ? state.task.id : null;
      const [priorTask] = priorTaskId ? await nested.select().from(tasks).where(eq(tasks.id, priorTaskId)) : [];
      const projected = { ...item } as Record<string, unknown>;
      delete projected.created_at;
      delete projected.updated_at;
      if (tracking.action === 'create') delete projected.id;
      // A future new interval without evidence intentionally anchors when it
      // actually activates, including restart catch-up. Do not show a made-up
      // present creation date as the guaranteed future deadline.
      const deriveOnActivation = !!operation.effective && tracking.action === 'create' && !tracking.item.last_completed_on && tracking.item.next_due_date === undefined;
      if (deriveOnActivation) projected.next_due_date = null;
      throw new TrackingProjection({ requested: tracking, item: projected, previous_generated_task_after: priorTask ?? null, derive_date_on_activation: deriveOnActivation, reviewed_context: { ...context, timezone: settings.timezone }, evaluated_at: evaluationInstant });
    });
  } catch (error) {
    if (error instanceof TrackingProjection) return error.projection;
    throw error;
  }
  return null;
}

function semanticTrackingEffects(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(semanticTrackingEffects);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !['created_at', 'updated_at', 'evaluated_at'].includes(key)).map(([key, entry]) => [key, semanticTrackingEffects(entry)]));
}

export async function previewKnowledgeChange(db: DbOrTx, input: KnowledgeChangeInput, actor: string, now = new Date().toISOString()) {
  const operation = KnowledgeChangeSchema.parse(input);
  operation.assessment.assessed_at = new Date(operation.assessment.assessed_at ?? now).toISOString();
  if (operation.assessment.last_checked_at) operation.assessment.last_checked_at = new Date(operation.assessment.last_checked_at).toISOString();
  if (operation.assessment.review_due_at) operation.assessment.review_due_at = new Date(operation.assessment.review_due_at).toISOString();
  return inTransaction(db, async (tx) => {
    const preconditions = await capturePreconditions(tx, operation);
    await validateOperation(tx, operation, preconditions, now, false);
    const changes = describeChanges(operation, preconditions);
    const trackingProjection = await projectTracking(tx, operation, preconditions, actor, now);
    if (trackingProjection) { const change = changes.find((entry) => entry.kind === 'tracking'); if (change) change.after = trackingProjection; }
    const fingerprint = knowledgeFingerprint({ operation, preconditions, changes });
    const [row] = await tx.insert(knowledge_change_previews).values({ asset_id: operation.asset_id, operation, preconditions, changes, fingerprint, actor }).returning();
    if (!row) throw new Error('insert_returned_no_row');
    return row;
  });
}

async function applyOperation(tx: Tx, operation: KnowledgeChange, state: KnowledgePreconditions, actor: string, ctx: ScheduleContext, now: string): Promise<KnowledgeReceipt> {
  // Use the settings captured under the transaction's lock, including at late
  // future activation. The caller's earlier request context may have aged.
  if (state.scheduling) ctx = { today: formatInTz(new Date(now), state.scheduling.timezone), staleDays: state.scheduling.staleDays };
  await validateOperation(tx, operation, state, now, true);
  if (operation.facts_patch) await updateAsset(tx, operation.asset_id, { metadata_patch: operation.facts_patch }, ctx, actor);
  let itemId = (state.assessment?.item_id as string | null | undefined) ?? null;
  if (operation.tracking?.action === 'create') {
    itemId = (await createMaintenanceItem(tx, { ...operation.tracking.item, asset_id: operation.asset_id }, actor)).id;
  } else if (operation.tracking?.action === 'update') {
    itemId = (await updateMaintenanceItem(tx, operation.tracking.item_id, operation.tracking.patch, ctx)).id;
  } else if (operation.tracking?.action === 'link') itemId = operation.tracking.item_id;
  const [asset] = await tx.select({ metadata: assets.metadata }).from(assets).where(eq(assets.id, operation.asset_id));
  const [existing] = await tx.select().from(vehicle_assessments).where(and(eq(vehicle_assessments.asset_id, operation.asset_id), eq(vehicle_assessments.rule_id, state.rule.id))).for('update');
  const d = operation.assessment;
  const value = {
    asset_id: operation.asset_id, rule_id: state.rule.id, rule_version_id: operation.rule_version_id,
    revision: (existing?.revision ?? 0) + 1, applicability: d.applicability, evidence_basis: d.evidence_basis, review_state: d.review_state,
    relevant_facts: Object.fromEntries(Object.keys(state.asset.facts).map((key) => [key, asset?.metadata?.[key] ?? null])),
    source_ids: [...new Set(d.source_ids)], rationale: d.rationale, actor,
    assessed_at: d.assessed_at ?? now, last_checked_at: d.last_checked_at ?? null, review_due_at: d.review_due_at ?? null,
    item_id: itemId, invalidation_reason: null, updated_at: now,
  };
  const [assessment] = existing
    ? await tx.update(vehicle_assessments).set(value).where(eq(vehicle_assessments.id, existing.id)).returning()
    : await tx.insert(vehicle_assessments).values(value).returning();
  if (!assessment) throw new Error('insert_returned_no_row');
  await recordAssessmentHistory(tx, assessment, actor, operation.reason);
  // Evidence sources gain an explicit association with this assessed asset;
  // content deduplication alone never grants an association to another vehicle.
  for (const source of state.sources) await tx.insert(source_links).values({ source_id: source.id, asset_id: operation.asset_id, label: 'Responsibility evidence', actor }).onConflictDoNothing();
  return { asset_id: operation.asset_id, assessment_id: assessment.id, assessment_revision: assessment.revision, item_id: itemId, status: 'applied', applied_at: now };
}

async function transitionHistory(tx: Tx, transition: typeof knowledge_transitions.$inferSelect, actor: string, reason: string) {
  await tx.insert(knowledge_transition_history).values({ transition_id: transition.id, revision: transition.revision, snapshot: transition, actor, reason });
}

export async function applyKnowledgeChange(db: DbOrTx, input: unknown, actor: string, ctx: ScheduleContext, now = new Date().toISOString()): Promise<KnowledgeReceipt> {
  const data = AcceptKnowledgeChangeSchema.parse(input);
  return inTransaction(db, async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`knowledge:${actor}:${data.operation_key}`}, 0))`);
    const [preview] = await tx.select().from(knowledge_change_previews).where(eq(knowledge_change_previews.id, data.preview_id)).for('update');
    if (!preview || preview.actor !== actor) throw new CommandError(404, 'not_found', 'Knowledge preview not found.');
    if (preview.fingerprint !== data.fingerprint) throw new CommandError(409, 'preview_conflict', 'The accepted fingerprint differs from this preview.');
    if (preview.receipt) {
      if (preview.operation_key !== data.operation_key) throw new CommandError(409, 'operation_key_conflict', 'This preview was already accepted with another operation key.');
      return preview.receipt;
    }
    const [reused] = await tx.select({ id: knowledge_change_previews.id }).from(knowledge_change_previews).where(and(eq(knowledge_change_previews.actor, actor), eq(knowledge_change_previews.operation_key, data.operation_key)));
    if (reused) throw new CommandError(409, 'operation_key_conflict', 'This operation key belongs to another accepted preview.');
    const state = await capturePreconditions(tx, preview.operation);
    if (!jsonEqual(state, preview.preconditions)) throw new CommandError(409, 'precondition_conflict', 'The reviewed facts, rule, evidence, assessment, tracking or scheduling settings changed. Create a fresh preview.');
    await validateOperation(tx, preview.operation, state, now, false);
    const reviewedTracking = preview.changes.find((change) => change.kind === 'tracking')?.after;
    const currentTracking = await projectTracking(tx, preview.operation, state, actor, now);
    if (currentTracking && !jsonEqual(semanticTrackingEffects(currentTracking), semanticTrackingEffects(reviewedTracking))) throw new CommandError(409, 'tracking_effects_changed', 'The displayed tracking effects or scheduling day changed. Review a fresh preview before accepting.');
    // Approval retains the evidence association immediately, including when
    // application is deferred for months or its effective time is unresolved.
    for (const source of state.sources) await tx.insert(source_links).values({ source_id: source.id, asset_id: preview.asset_id, label: 'Responsibility evidence', actor }).onConflictDoNothing();
    const effective = preview.operation.effective;
    const effectiveAt = resolveKnowledgeEffectiveTime(effective);
    let receipt: KnowledgeReceipt;
    if (effective && (!effectiveAt || Date.parse(effectiveAt) > Date.parse(now))) {
      const [transition] = await tx.insert(knowledge_transitions).values({ asset_id: preview.asset_id, preview_id: preview.id, operation: preview.operation, preconditions: state, effective, effective_at: effectiveAt, actor, approved_at: now, reason: effectiveAt ? null : 'Effective time is unresolved; automatic activation is disabled.' }).returning();
      if (!transition) throw new Error('insert_returned_no_row');
      await transitionHistory(tx, transition, actor, preview.operation.reason);
      receipt = { asset_id: preview.asset_id, transition_id: transition.id, status: 'pending' };
    } else receipt = await applyOperation(tx, preview.operation, state, actor, ctx, now);
    await tx.update(knowledge_change_previews).set({ operation_key: data.operation_key, receipt }).where(eq(knowledge_change_previews.id, preview.id));
    return receipt;
  });
}

export async function processKnowledgeTransitions(db: DbOrTx, ctx: ScheduleContext, now = new Date().toISOString(), limit = 100) {
  const due = await db.select({ id: knowledge_transitions.id }).from(knowledge_transitions)
    .where(and(eq(knowledge_transitions.status, 'pending'), isNotNull(knowledge_transitions.effective_at), lte(knowledge_transitions.effective_at, now)))
    .orderBy(asc(knowledge_transitions.effective_at), asc(knowledge_transitions.id)).limit(limit);
  const result = { examined: 0, applied: 0, needs_review: 0 };
  for (const entry of due) {
    const outcome = await inTransaction(db, async (tx) => {
      const [transition] = await tx.select().from(knowledge_transitions).where(eq(knowledge_transitions.id, entry.id)).for('update');
      if (!transition || transition.status !== 'pending' || !transition.effective_at || Date.parse(transition.effective_at) > Date.parse(now)) return 'skipped';
      let state: KnowledgePreconditions | undefined;
      let conflict: string | undefined;
      try {
        state = await capturePreconditions(tx, transition.operation);
        if (!jsonEqual(state, transition.preconditions)) conflict = 'The approved facts, lifecycle, rule, evidence, assessment, tracking or scheduling settings changed.';
        else if (state.asset.lifecycle !== 'active') conflict = 'The asset lifecycle does not permit activation.';
        else await validateOperation(tx, transition.operation, state, now, true);
      } catch (error) {
        if (!(error instanceof CommandError)) throw error;
        conflict = error.message;
      }
      if (conflict || !state) {
        const [changed] = await tx.update(knowledge_transitions).set({ status: 'needs_review', revision: transition.revision + 1, reason: conflict ?? 'Approved state could not be resolved.', updated_at: now }).where(eq(knowledge_transitions.id, transition.id)).returning();
        if (changed) await transitionHistory(tx, changed, 'system:knowledge-activation', changed.reason!);
        return 'needs_review';
      }
      // A savepoint ensures command validation failures cannot retain any
      // partial fact/task change when the transition is sent for review.
      let receipt: KnowledgeReceipt;
      try {
        receipt = await tx.transaction((nested) => applyOperation(nested, transition.operation, state!, transition.actor, ctx, now));
      } catch (error) {
        if (!(error instanceof CommandError) && !(error instanceof Error && error.name === 'ZodError')) throw error;
        const [changed] = await tx.update(knowledge_transitions).set({ status: 'needs_review', revision: transition.revision + 1, reason: error.message, updated_at: now }).where(eq(knowledge_transitions.id, transition.id)).returning();
        if (changed) await transitionHistory(tx, changed, 'system:knowledge-activation', error.message);
        return 'needs_review';
      }
      receipt = { ...receipt, transition_id: transition.id };
      const [applied] = await tx.update(knowledge_transitions).set({ status: 'applied', revision: transition.revision + 1, receipt, applied_at: now, updated_at: now, reason: null }).where(eq(knowledge_transitions.id, transition.id)).returning();
      if (applied) await transitionHistory(tx, applied, 'system:knowledge-activation', 'Applied the exact owner-approved operation after rechecking preconditions.');
      return 'applied';
    });
    if (outcome !== 'skipped') result.examined++;
    if (outcome === 'applied') result.applied++;
    if (outcome === 'needs_review') result.needs_review++;
  }
  return result;
}

export async function cancelKnowledgeTransition(db: DbOrTx, id: string, input: unknown, actor: string) {
  const data = CancelKnowledgeTransitionSchema.parse(input);
  return inTransaction(db, async (tx) => {
    const [current] = await tx.select().from(knowledge_transitions).where(eq(knowledge_transitions.id, id)).for('update');
    if (!current) throw new CommandError(404, 'not_found', 'Transition not found.');
    if (current.revision !== data.expected_revision) throw new CommandError(409, 'transition_conflict', 'The transition changed. Reload its current state.');
    if (!['pending', 'needs_review'].includes(current.status)) throw new CommandError(409, 'transition_terminal', 'An applied, cancelled or superseded transition cannot be cancelled again.');
    const [changed] = await tx.update(knowledge_transitions).set({ status: data.status, revision: current.revision + 1, reason: data.reason, updated_at: new Date().toISOString() }).where(eq(knowledge_transitions.id, id)).returning();
    if (!changed) throw new Error('update_returned_no_row');
    await transitionHistory(tx, changed, actor, data.reason);
    return changed;
  });
}

export async function vehicleKnowledge(db: DbOrTx, assetId: string, now = new Date().toISOString()) {
  const assessments = await db.select().from(vehicle_assessments).where(eq(vehicle_assessments.asset_id, assetId)).orderBy(desc(vehicle_assessments.updated_at));
  const transitions = await db.select().from(knowledge_transitions).where(eq(knowledge_transitions.asset_id, assetId)).orderBy(desc(knowledge_transitions.approved_at));
  return {
    assessments: assessments.map((a) => ({ ...a, freshness: a.last_checked_at == null ? 'unchecked' : a.review_due_at && Date.parse(a.review_due_at) <= Date.parse(now) ? 'review_due' : 'checked', knowledge_label: a.applicability === 'unknown' ? 'Applicability not established' : a.evidence_basis === 'user_reported' ? 'Entered by you; not independently researched' : 'Supported by retained evidence; see the assessment' })),
    transitions,
  };
}

export async function assessmentHistory(db: DbOrTx, assessmentId: string) {
  return db.select().from(vehicle_assessment_history).where(eq(vehicle_assessment_history.assessment_id, assessmentId)).orderBy(desc(vehicle_assessment_history.revision));
}
export async function transitionAudit(db: DbOrTx, transitionId: string) {
  return db.select().from(knowledge_transition_history).where(eq(knowledge_transition_history.transition_id, transitionId)).orderBy(desc(knowledge_transition_history.revision));
}
export async function createKnowledgeFollowup(db: DbOrTx, assessmentId: string, actor: string, title?: string) {
  return inTransaction(db, async (tx) => {
    const [assessment] = await tx.select().from(vehicle_assessments).where(eq(vehicle_assessments.id, assessmentId));
    if (!assessment) throw new CommandError(404, 'not_found', 'Assessment not found.');
    const [asset] = await tx.select().from(assets).where(eq(assets.id, assessment.asset_id));
    const sourceRef = `knowledge-assessment:${assessment.id}`;
    const [created] = await tx.insert(tasks).values({ title: title ?? `Review vehicle responsibility: ${asset?.name ?? 'vehicle'}`, notes: `Knowledge follow-up requested by ${actor}. ${assessment.rationale}`, domain_id: asset?.domain_id ?? INBOX_DOMAIN_ID, source: 'manual', source_ref: sourceRef })
      .onConflictDoNothing({ target: [tasks.source, tasks.source_ref], where: sql`source_ref is not null` }).returning();
    if (created) return created;
    const [existing] = await tx.select().from(tasks).where(and(eq(tasks.source, 'manual'), eq(tasks.source_ref, sourceRef)));
    if (!existing) throw new Error('followup_not_found');
    return existing;
  });
}
