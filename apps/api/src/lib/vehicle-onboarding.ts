import { and, asc, eq, inArray, or } from 'drizzle-orm';
import {
  VehicleOnboardingDraftSchema, VehicleIdentitySchema, VehicleMetadataSchema, VehiclePreferencesSchema,
  VehicleOwnershipEvidenceSchema, VehicleInstalledEquipmentSchema, VehicleKnownIssuesSchema,
  CreateMaintenanceItemSchema, AssetLifecycleSchema, factValue, vehicleDisplayName,
  type OnboardingDraft, type OnboardingJson, type OnboardingChange, type VehicleOnboardingDraft,
} from '@jevi-ops/shared';
import { assets, asset_meter_readings, app_settings, maintenance_items, maintenance_logs, projects, stewardship_domains, tasks } from '../db/schema.js';
import { source_candidates, source_documents, source_links } from '../db/source-schema.js';
import { createAsset, updateAsset } from './asset-commands.js';
import { createProject } from './structure-commands.js';
import { recordReading } from './meter-readings.js';
import { assetSnapshotMarker } from './asset-context.js';
import { attachSessionSources } from './private-sources.js';
import { applyKnowledgeChange, createResponsibilityRule, previewKnowledgeChange } from './knowledge.js';
import { todayInTz } from './tz.js';
import { getCoreCapabilities } from './core-onboarding.js';
import { OnboardingError, canonicalJson, type OnboardingContext, type OnboardingModuleAdapter, type OnboardingReview } from './onboarding.js';
import type { Tx } from './maintenance-tx.js';

const json = (value: unknown): OnboardingJson => JSON.parse(JSON.stringify(value)) as OnboardingJson;
const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
const withoutAuditTimes = (rows: Record<string, unknown>[]) => rows.map(({ created_at: _created, updated_at: _updated, ...row }) => row);
const identityKeys = ['year', 'make', 'model', 'variant', 'year_basis', 'vin', 'chassis_id', 'model_code', 'plate'] as const;
const jurisdictionKeys = ['based_country', 'based_region', 'registration_country', 'registration_region'] as const;
const stateKeys = ['fuel_powertrain', 'engine', 'registration_class', 'import_origin', 'condition', 'configuration'] as const;
type Asset = typeof assets.$inferSelect;

function formMetadata(draft: VehicleOnboardingDraft): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of identityKeys) if (draft.identity && key in draft.identity) result[key] = draft.identity[key];
  for (const key of jurisdictionKeys) if (draft.jurisdiction && key in draft.jurisdiction) result[key] = draft.jurisdiction[key];
  for (const key of stateKeys) if (draft.state && key in draft.state) result[key] = draft.state[key];
  const put = (key: string, value: unknown) => { if (value !== undefined) result[key] = value; };
  put('vehicle_preferences', draft.preferences);
  put('vehicle_ownership_evidence', draft.state?.ownership);
  put('installed_equipment', draft.state?.installed_equipment);
  put('known_issues', draft.state?.known_issues);
  put('history_coverage', draft.history?.coverage);
  put('history_notes', draft.history?.notes);
  put('usage', draft.plans?.usage);
  put('estimated_usage', draft.plans?.estimated_usage);
  return result;
}
function validatedIdentity(draft: VehicleOnboardingDraft) {
  // Empty optional text is a legitimate cleared form control. Metadata changes
  // still see the original empty value so an owner can remove a known identifier.
  const identity = { ...draft.identity };
  for (const key of ['variant', 'nickname', 'vin', 'chassis_id', 'model_code', 'plate'] as const) {
    if (typeof identity[key] === 'string' && !identity[key]!.trim()) delete identity[key];
  }
  return VehicleIdentitySchema.parse(identity);
}
function completionDraft(raw: OnboardingDraft, context: OnboardingContext) {
  const draft = VehicleOnboardingDraftSchema.parse(raw);
  // Skip retains the entered values in the durable session, but postpones their
  // application. This also lets partially entered optional evidence stay saved.
  for (const key of ['preferences', 'jurisdiction', 'state', 'history', 'plans', 'tracking'] as const) {
    if (context.session.step_states[key] === 'skipped') delete draft[key];
  }
  return draft;
}
function empty(value: unknown) { return value === '' || value == null || (typeof value === 'object' && !Object.keys(value).length); }

async function settingsContext(tx: Tx) {
  const [s] = await tx.select().from(app_settings).where(eq(app_settings.id, true));
  if (!s) throw new OnboardingError('settings_unavailable', 503);
  return { today: todayInTz(s.timezone), staleDays: s.meter_stale_days, currency: s.currency, timezone: s.timezone };
}

async function captureState(tx: Tx, context: OnboardingContext, draft: VehicleOnboardingDraft) {
  const [asset] = context.session.subject_id ? await tx.select().from(assets).where(eq(assets.id, context.session.subject_id)).for('update') : [];
  if (context.session.subject_id && (!asset || asset.kind !== 'vehicle')) throw new OnboardingError('vehicle_not_found', 404);
  const itemRows = asset ? await tx.select().from(maintenance_items).where(eq(maintenance_items.asset_id, asset.id)).orderBy(asc(maintenance_items.id)).for('update') : [];
  const itemIds = itemRows.map((item) => item.id);
  const projectRows = asset ? await tx.select().from(projects).where(eq(projects.asset_id, asset.id)).orderBy(asc(projects.id)) : [];
  const taskIds = itemRows.map((item) => item.generated_task_id).filter((id): id is string => !!id);
  const taskRows = (taskIds.length || projectRows.length) ? await tx.select().from(tasks).where(or(
    taskIds.length ? inArray(tasks.id, taskIds) : undefined,
    taskIds.length ? inArray(tasks.parent_task_id, taskIds) : undefined,
    projectRows.length ? inArray(tasks.project_id, projectRows.map((p) => p.id)) : undefined,
  )).orderBy(asc(tasks.id)) : [];
  const readingRows = asset ? await tx.select().from(asset_meter_readings).where(eq(asset_meter_readings.asset_id, asset.id)).orderBy(asc(asset_meter_readings.id)) : [];
  const logRows = itemIds.length ? await tx.select().from(maintenance_logs).where(inArray(maintenance_logs.item_id, itemIds)).orderBy(asc(maintenance_logs.id)) : [];
  const links = await tx.select().from(source_links).where(or(eq(source_links.session_id, context.session.id), asset ? eq(source_links.asset_id, asset.id) : undefined)).orderBy(asc(source_links.id));
  const candidates = links.length ? await tx.select().from(source_candidates).where(inArray(source_candidates.source_link_id, links.map((s) => s.id))).orderBy(asc(source_candidates.id)) : [];
  const sourceIds = [...new Set([...links.map((s) => s.source_id), ...(draft.tracking?.items ?? []).flatMap((i) => i.source_ids)])].sort();
  const sources = sourceIds.length ? await tx.select({ id: source_documents.id, hash: source_documents.content_hash }).from(source_documents).where(inArray(source_documents.id, sourceIds)).orderBy(asc(source_documents.id)) : [];
  if (sources.length !== sourceIds.length) throw new OnboardingError('source_not_found', 400);
  const domainId = draft.plans?.domain_id;
  const [domain] = domainId ? await tx.select().from(stewardship_domains).where(eq(stewardship_domains.id, domainId)).for('share') : [];
  if (domainId && !domain) throw new OnboardingError('domain_not_found', 400);
  return { asset: asset ?? null, items: itemRows, projects: projectRows, tasks: taskRows, readings: readingRows, logs: logRows,
    links, candidates, sources, domain: domain ?? null, settings: await settingsContext(tx),
    asset_snapshot: asset ? await assetSnapshotMarker(tx, asset.id) : null };
}

function changesForAsset(draft: VehicleOnboardingDraft, current: Asset | null, context: OnboardingContext) {
  const baseline = draft.review.baseline;
  const original = baseline.asset as Asset | null;
  const initialForm = (baseline.form_metadata ?? {}) as Record<string, unknown>;
  const values = formMetadata(draft);
  const set: Record<string, { value: unknown; expected: unknown }> = {};
  const unset: Record<string, { expected: unknown }> = {};
  for (const [key, value] of Object.entries(values)) {
    if (original && same(value, initialForm[key])) continue;
    if (!original && empty(value)) continue;
    const expected = original?.metadata?.[key] ?? null;
    if (current && !same(current.metadata?.[key] ?? null, expected)) throw new OnboardingError('fact_conflict', 409, { keys: [key] });
    if (empty(value)) { if (expected !== null) unset[key] = { expected }; }
    else set[key] = { expected, value: ['string', 'number', 'boolean'].includes(typeof value)
      ? { value, source_kind: 'user', confidence: 'reported', verified: false, recorded_at: new Date(context.session.updated_at).toISOString() }
      : value };
  }
  const suppliedStates = draft.review.answer_states ?? {};
  const deferred = Object.entries(context.session.step_states).filter(([, state]) => state === 'skipped').map(([key]) => key);
  const previous = original?.metadata?.vehicle_answer_states as Record<string, unknown> | undefined;
  const previousDeferred = Array.isArray(previous?.deferred_sections) ? previous.deferred_sections as string[] : [];
  const stillDeferred = previousDeferred.filter((key) => context.session.step_states[key] !== 'confirmed');
  if (!original || deferred.length || Object.keys(suppliedStates).length || !same(previousDeferred, stillDeferred)) {
    const states = { ...previous, ...suppliedStates, deferred_sections: [...new Set([...stillDeferred, ...(suppliedStates.deferred_sections ?? []), ...deferred])] };
    if (!same(states, previous)) {
      if (current && !same(current.metadata?.vehicle_answer_states, previous)) throw new OnboardingError('fact_conflict', 409, { keys: ['vehicle_answer_states'] });
      set.vehicle_answer_states = { value: states, expected: previous ?? null };
    }
  }
  const identity = validatedIdentity(draft);
  const name = vehicleDisplayName(identity);
  const desired = { name,
    domain_id: draft.plans?.domain_id !== undefined ? draft.plans.domain_id : original?.domain_id ?? null,
    meter_unit: draft.identity?.meter_unit !== undefined ? draft.identity.meter_unit : original?.meter_unit ?? null,
    lifecycle: draft.state?.lifecycle ?? AssetLifecycleSchema.parse(original?.lifecycle ?? 'active'), doc_md: draft.review.doc_md };
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(desired)) {
    if (value === undefined || (original && same(value, original[key as keyof Asset]))) continue;
    if (current && !same(current[key as keyof Asset], original?.[key as keyof Asset])) throw new OnboardingError('asset_conflict', 409, { keys: [key] });
    patch[key] = value;
  }
  if ('doc_md' in patch && current && current.doc_version !== original?.doc_version) throw new OnboardingError('doc_conflict');
  return { identity, desired, patch, set, unset };
}

function validateCompletion(raw: OnboardingDraft) {
  const draft = VehicleOnboardingDraftSchema.parse(raw);
  validatedIdentity(draft);
  if (draft.identity?.reading != null && (!draft.identity.meter_unit || !draft.identity.recorded_on)) throw new OnboardingError('reading_unit_and_date_required', 400);
}

function validateOptionalCompletion(draft: VehicleOnboardingDraft) {
  for (const key of ['based_country', 'registration_country'] as const) {
    const value = draft.jurisdiction?.[key];
    if (value && !/^[A-Z]{2}$/.test(value)) throw new OnboardingError('country_code_required', 400);
  }
  for (const list of [draft.tracking?.items ?? [], draft.plans?.projects ?? []]) {
    if (new Set(list.map((item) => item.key)).size !== list.length) throw new OnboardingError('duplicate_draft_key', 400);
    if (list.some((item) => !item.name.trim())) throw new OnboardingError('item_name_required', 400);
  }
  for (const item of draft.tracking?.items ?? []) {
    if (!item.source_note.trim()) throw new OnboardingError('tracking_source_required', 400);
    if (item.track) CreateMaintenanceItemSchema.parse(item);
  }
}

async function executeDraft(tx: Tx, raw: OnboardingDraft, context: OnboardingContext) {
  const draft = completionDraft(raw, context);
  validateOptionalCompletion(draft);
  const state = await captureState(tx, context, draft);
  const planned = changesForAsset(draft, state.asset, context);
  const actor = `session:${context.actor_id}`;
  let asset = state.asset;
  if (!asset) {
    const metadata = Object.fromEntries(Object.entries(planned.set).map(([key, entry]) => [key, entry.value]));
    const doc = draft.review.doc_md ?? `# ${vehicleDisplayName(planned.identity)}\n\nOwner-created vehicle record.\n\nService history and regulatory responsibilities require the evidence and assessments recorded separately in Jevi Ops.\n`;
    asset = await createAsset(tx, { name: planned.desired.name, kind: 'vehicle', domain_id: planned.desired.domain_id,
      meter_unit: planned.desired.meter_unit, metadata, doc_md: doc });
    if (planned.desired.lifecycle !== 'active') asset = await updateAsset(tx, asset.id, { lifecycle: planned.desired.lifecycle }, state.settings, actor);
  } else if (Object.keys(planned.patch).length || Object.keys(planned.set).length || Object.keys(planned.unset).length) {
    asset = await updateAsset(tx, asset.id, { ...planned.patch, metadata_patch: { set: planned.set, unset: planned.unset },
      ...('doc_md' in planned.patch ? { doc_version: state.asset!.doc_version } : {}) }, state.settings, actor);
  }
  let readingId: string | null = null;
  if (draft.identity?.reading != null) {
    if (!asset.meter_unit || !draft.identity.recorded_on) throw new OnboardingError('reading_unit_and_date_required', 400);
    const reading = await recordReading(tx, { assetId: asset.id, reading: draft.identity.reading, recordedOn: draft.identity.recorded_on,
      today: state.settings.today, source: 'manual', actor, eventKey: `onboarding:${context.session.id}:reading` });
    readingId = reading.row.id;
  }
  const madeProjects = [];
  for (const project of draft.plans?.projects ?? []) madeProjects.push(await createProject(tx, {
    name: project.name.trim(), status: project.state === 'approved' ? 'active' : 'idea', asset_id: asset.id,
    description: project.state === 'ordered' ? `Ordered; not installed.\n${project.description ?? ''}` : project.description ?? null,
  }));
  await attachSessionSources(tx, context.session.id, asset.id, context.actor_id, actor);
  const knowledge = [];
  for (const item of draft.tracking?.items ?? []) {
    const rule = await createResponsibilityRule(tx, { title: item.name.trim(), kind: item.kind, source_ids: item.source_ids,
      source_note: item.source_note, reason: 'Owner supplied this reference during vehicle setup.' }, actor);
    const preview = await previewKnowledgeChange(tx, { asset_id: asset.id, rule_version_id: rule.id,
      assessment: { applicability: item.applicability, evidence_basis: item.evidence_basis, source_ids: item.source_ids,
        rationale: item.source_note, assessed_at: new Date(context.session.updated_at).toISOString() },
      // The shared owner form displays zero for an omitted lead time, including
      // older saved drafts. Preserve that reviewed value over the generic
      // maintenance-create default used by other entry points.
      ...(item.track ? { tracking: { action: 'create' as const, item: CreateMaintenanceItemSchema.parse({ ...item, lead_days: item.lead_days ?? 0, name: item.name.trim(), asset_id: asset.id }) } } : {}),
      reason: 'Owner confirmed this vehicle setup and its tracking.' }, actor);
    const receipt = await applyKnowledgeChange(tx, { preview_id: preview.id, fingerprint: preview.fingerprint,
      operation_key: `onboarding:${context.session.id}:tracking:${item.key}` }, actor, state.settings);
    const [tracking] = receipt.item_id ? await tx.select().from(maintenance_items).where(eq(maintenance_items.id, receipt.item_id)) : [];
    knowledge.push({ receipt, title: item.name, kind: item.kind, applicability: item.applicability, source_note: item.source_note,
      tracking: tracking ? { name: tracking.name, policy: tracking.policy, interval_days: tracking.interval_days, interval_months: tracking.interval_months,
        interval_meter: tracking.interval_meter, next_due_date: tracking.next_due_date, next_due_meter: tracking.next_due_meter, lead_days: tracking.lead_days, lead_meter: tracking.lead_meter } : null });
  }
  const afterProjects = state.projects.length ? await tx.select().from(projects).where(inArray(projects.id, state.projects.map((p) => p.id))).orderBy(asc(projects.id)) : [];
  const afterTasks = state.tasks.length ? await tx.select().from(tasks).where(inArray(tasks.id, state.tasks.map((t) => t.id))).orderBy(asc(tasks.id)) : [];
  const changes: OnboardingChange[] = [];
  const domainNames = new Map<string, string>();
  for (const domainId of new Set([state.asset?.domain_id, asset.domain_id].filter((id): id is string => !!id))) {
    const [domain] = await tx.select({ name: stewardship_domains.name }).from(stewardship_domains).where(eq(stewardship_domains.id, domainId));
    if (domain) domainNames.set(domainId, domain.name);
  }
  const assetSummary = (row: Asset) => ({ name: row.name, lifecycle: row.lifecycle, domain_id: row.domain_id,
    domain: row.domain_id ? domainNames.get(row.domain_id) ?? 'Unavailable domain' : 'Unassigned',
    meter_unit: row.meter_unit, metadata: row.metadata, doc_md: row.doc_md });
  if (!state.asset || !same(assetSummary(state.asset), assetSummary(asset))) changes.push({ kind: 'vehicle', label: state.asset ? 'Update the reviewed vehicle fields and overview' : `Create ${asset.name}`, before: state.asset ? json(assetSummary(state.asset)) : null, after: json(assetSummary(asset)) });
  if (readingId) changes.push({ kind: 'reading', label: `Record ${draft.identity!.reading!.toLocaleString('en-US')} ${asset.meter_unit} on ${draft.identity!.recorded_on}`, after: json({ reading: draft.identity!.reading, unit: asset.meter_unit, date: draft.identity!.recorded_on }) });
  for (const p of madeProjects) changes.push({ kind: 'project', label: `${p.status === 'idea' ? 'Retain idea' : 'Create project'}: ${p.name}`, after: json({ name: p.name, status: p.status, description: p.description }) });
  for (const entry of knowledge) { const { receipt: _receipt, ...summary } = entry; changes.push({ kind: 'responsibility', label: `${entry.tracking ? 'Track' : 'Record assessment'}: ${entry.title}`, after: json(summary) }); }
  if (state.links.some((link) => link.session_id)) changes.push({ kind: 'sources', label: `Attach ${state.links.filter((link) => link.session_id).length} retained source(s); candidate history remains awaiting review`, after: json(state.links.filter((link) => link.session_id).map((link) => ({ label: link.label, source_id: link.source_id }))) });
  if (!same(withoutAuditTimes(state.projects), withoutAuditTimes(afterProjects))) changes.push({ kind: 'routing', label: 'Update domain routing on linked projects', before: json(withoutAuditTimes(state.projects)), after: json(withoutAuditTimes(afterProjects)) });
  if (!same(withoutAuditTimes(state.tasks), withoutAuditTimes(afterTasks))) changes.push({ kind: 'tasks', label: 'Reconcile existing work with the reviewed lifecycle, name and domain; retain owner annotations', before: json(withoutAuditTimes(state.tasks)), after: json(withoutAuditTimes(afterTasks)) });
  return { changes, receipt: { subject_id: asset.id, reading_id: readingId, project_ids: madeProjects.map((p) => p.id), knowledge: knowledge.map((entry) => entry.receipt),
    source_candidates_awaiting_review: state.candidates.filter((candidate) => candidate.status === 'pending').length } };
}

class VehicleProjection extends Error { constructor(public changes: OnboardingChange[]) { super('rollback_vehicle_projection'); } }
export const vehicleOnboardingModule: OnboardingModuleAdapter = {
  definition: { id: 'vehicle', version: 1, title: 'Set up a vehicle', entry_points: ['first_run', 'settings', 'add_asset', 'asset_detail'], steps: [
    { id: 'preferences', title: 'How should Jevi Ops help?', optional: true }, { id: 'identity', title: 'Which vehicle?' },
    { id: 'jurisdiction', title: 'Based and registered', optional: true }, { id: 'state', title: 'Current state', optional: true },
    { id: 'history', title: 'History and documents', optional: true }, { id: 'plans', title: 'Use and future plans', optional: true },
    { id: 'tracking', title: 'Dates and responsibilities', optional: true }, { id: 'review', title: 'Review and save' },
  ] },
  draftSchema: VehicleOnboardingDraftSchema.transform((draft) => json(draft) as OnboardingDraft),
  readonlyDraftFields: { review: ['baseline'] },
  getCapabilities: getCoreCapabilities,
  async initialDraft(input, _actor, tx) {
    const [asset] = input.subject_id ? await tx.select().from(assets).where(eq(assets.id, input.subject_id)).for('update') : [];
    if (input.subject_id && (!asset || asset.kind !== 'vehicle')) throw new OnboardingError('vehicle_not_found', 404);
    const settings = await settingsContext(tx);
    const draft: VehicleOnboardingDraft = { identity: { meter_unit: asset?.meter_unit === 'km' || asset?.meter_unit === 'mi' ? asset.meter_unit : null, recorded_on: settings.today },
      state: { lifecycle: AssetLifecycleSchema.parse(asset?.lifecycle ?? 'active') }, plans: { domain_id: asset?.domain_id ?? null }, review: { baseline: {} } };
    if (asset) {
      for (const [step, keys] of [['identity', identityKeys], ['jurisdiction', jurisdictionKeys], ['state', stateKeys]] as const) {
        for (const key of keys) {
          const value = factValue(asset.metadata[key]);
          if (value == null) continue;
          const parsed = VehicleOnboardingDraftSchema.safeParse({ ...draft, [step]: { ...draft[step], [key]: value } });
          // One legacy field must not hide other valid facts. Invalid values
          // remain unchanged in the baseline until the owner corrects that key.
          if (parsed.success) Object.assign(draft, { [step]: parsed.data[step] });
        }
      }
      draft.identity!.nickname = asset.name;
      const prefs = VehiclePreferencesSchema.safeParse(asset.metadata.vehicle_preferences); if (prefs.success) draft.preferences = prefs.data;
      const ownership = VehicleOwnershipEvidenceSchema.safeParse(asset.metadata.vehicle_ownership_evidence); if (ownership.success) draft.state!.ownership = ownership.data;
      const equipment = VehicleInstalledEquipmentSchema.safeParse(asset.metadata.installed_equipment); if (equipment.success) draft.state!.installed_equipment = equipment.data;
      const issues = VehicleKnownIssuesSchema.safeParse(asset.metadata.known_issues); if (issues.success) draft.state!.known_issues = issues.data;
      const coverage = factValue(asset.metadata.history_coverage);
      if (['none', 'partial', 'extensive', 'unknown'].includes(String(coverage))) draft.history = { coverage: coverage as 'none' | 'partial' | 'extensive' | 'unknown' };
      const notes = factValue(asset.metadata.history_notes);
      if (typeof notes === 'string' && notes.length <= 20000) draft.history = { ...draft.history, notes };
      const usage = factValue(asset.metadata.usage); if (typeof usage === 'string' && usage.length <= 1000) draft.plans!.usage = usage;
      const estimatedUsage = factValue(asset.metadata.estimated_usage);
      if (typeof estimatedUsage === 'string' && estimatedUsage.length <= 1000) draft.plans!.estimated_usage = estimatedUsage;
      draft.review.doc_md = asset.doc_md;
    }
    const readings = asset ? await tx.select({ id: asset_meter_readings.id }).from(asset_meter_readings).where(eq(asset_meter_readings.asset_id, asset.id)) : [];
    draft.review.baseline = { asset: asset ?? null, form_metadata: formMetadata(draft), today: settings.today, currency: settings.currency,
      timezone: settings.timezone, meter_unit_locked: readings.length > 0 };
    return json(draft) as OnboardingDraft;
  },
  validateCompletion,
  validateStep(raw, step, status) { if (step === 'identity' && status === 'confirmed') validatedIdentity(VehicleOnboardingDraftSchema.parse(raw)); },
  async preview(raw, context, tx): Promise<OnboardingReview> {
    const draft = completionDraft(raw, context);
    const before = await captureState(tx, context, draft);
    let changes: OnboardingChange[] = [];
    try { await tx.transaction(async (nested) => { const result = await executeDraft(nested, raw, context); throw new VehicleProjection(result.changes); }); }
    catch (error) { if (error instanceof VehicleProjection) changes = error.changes; else throw error; }
    return { changes, preconditions: { state: json(before) } };
  },
  async commit(raw, context, tx) { return json((await executeDraft(tx, raw, context)).receipt) as Record<string, OnboardingJson>; },
};
