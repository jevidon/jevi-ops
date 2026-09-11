import { randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { factValue, type OnboardingDraft, type OnboardingSession } from '@jevi-ops/shared';
import { getDb } from '../src/lib/db.js';
import { assets, app_settings, auth_user, asset_meter_readings, doc_revisions, maintenance_items, maintenance_logs, projects, source_documents, source_links, tasks } from '../src/db/schema.js';
import { responsibility_rules, responsibility_rule_versions, vehicle_assessments, knowledge_change_previews } from '../src/db/knowledge-schema.js';
import { onboarding_sessions } from '../src/db/onboarding-schema.js';
import * as assetCommands from '../src/lib/asset-commands.js';
import * as structureCommands from '../src/lib/structure-commands.js';
import * as sourceCommands from '../src/lib/private-sources.js';
import * as knowledgeCommands from '../src/lib/knowledge.js';
import * as readingCommands from '../src/lib/meter-readings.js';
import { vehicleOnboardingModule } from '../src/lib/vehicle-onboarding.js';
import { registerOnboardingModule, startOnboardingSession, saveOnboardingStep, previewOnboardingSession, completeOnboardingSession } from '../src/lib/onboarding.js';
import { createAsset, updateAsset } from '../src/lib/asset-commands.js';
import { retainSource } from '../src/lib/private-sources.js';
import { invalidateAppSettings } from '../src/lib/app-settings.js';
import { todayInTz } from '../src/lib/tz.js';

const owner = 'e79d0ee9-2f32-477a-a367-abd14658ae7e';
const identity = { year: 2015, make: 'Toyota', model: 'Land Cruiser Prado', variant: 'TX' };
beforeAll(async () => {
  registerOnboardingModule(vehicleOnboardingModule);
  await getDb().insert(auth_user).values({ id: owner, email: 'vehicle-setup@test.local', password_hash: 'test-only' }).onConflictDoNothing();
});
beforeEach(async () => {
  await getDb().update(app_settings).set({ timezone: 'Pacific/Auckland', currency: 'NZD' }).where(eq(app_settings.id, true));
  invalidateAppSettings();
});
function start(draft: OnboardingDraft = { identity }, subject_id?: string, creation_key = randomUUID()) {
  return startOnboardingSession({ module_id: 'vehicle', entry_point: subject_id ? 'asset_detail' : 'add_asset', creation_key, draft, subject_id }, owner);
}
async function save(session: OnboardingSession, step: string, values: OnboardingDraft[string]) {
  return saveOnboardingStep(session.id, step, { expected_revision: session.revision, values, state: 'draft' }, owner);
}
async function accept(session: OnboardingSession) {
  const preview = await previewOnboardingSession(session.id, session.revision, owner);
  const request = { expected_revision: session.revision, preview_fingerprint: preview.fingerprint, operation_key: randomUUID() };
  return { request, preview, result: await completeOnboardingSession(session.id, request, owner) };
}

describe('real vehicle onboarding command', () => {
  it('saves the supplied Prado exactly, with explicit units and no invented maintenance', async () => {
    const draft = await start({ identity: { ...identity, reading: 87600, meter_unit: 'km' }, jurisdiction: { based_country: 'NZ', registration_country: 'NZ' }, history: { coverage: 'unknown' } });
    expect(draft.draft.identity!.recorded_on).toBe(todayInTz('Pacific/Auckland'));
    const { result, preview, request } = await accept(draft);
    const [asset] = await getDb().select().from(assets);
    expect(asset?.name).toBe('2015 Toyota Land Cruiser Prado TX');
    expect(factValue(asset?.metadata.variant)).toBe('TX');
    expect(factValue(asset?.metadata.registration_country)).toBe('NZ');
    expect(asset?.metadata).not.toHaveProperty('engine');
    expect(await getDb().select().from(asset_meter_readings)).toHaveLength(1);
    expect((await getDb().select().from(asset_meter_readings))[0]?.reading).toBe(87600);
    expect(await getDb().select().from(maintenance_items)).toHaveLength(0);
    expect(await getDb().select().from(maintenance_logs)).toHaveLength(0);
    expect(preview.changes.some((change) => change.kind === 'reading')).toBe(true);
    expect(await completeOnboardingSession(draft.id, request, owner)).toEqual(result);
    await expect(completeOnboardingSession(draft.id, { ...request, operation_key: randomUUID() }, owner)).rejects.toMatchObject({ code: 'operation_key_conflict' });
    expect(await getDb().select().from(assets)).toHaveLength(1);
  });

  it('finishes without odometer, identifiers, trim or history and supports an intentional second vehicle', async () => {
    const key = randomUUID();
    const draft = await start({ identity: { year: 2020, make: 'Honda', model: 'Fit' } }, undefined, key);
    expect((await start({ identity: { year: 2020, make: 'Honda', model: 'Fit' } }, undefined, key)).id).toBe(draft.id);
    await accept(draft);
    await accept(await start({ identity: { year: 2019, make: 'Mazda', model: '3' } }));
    expect(await getDb().select().from(assets)).toHaveLength(2);
    expect(await getDb().select().from(asset_meter_readings)).toHaveLength(0);
    expect(await getDb().select().from(maintenance_logs)).toHaveLength(0);
  });

  it('does not let country change an explicit miles reading, and rejects a future reading atomically', async () => {
    const draft = await start({ identity: { ...identity, reading: 100, meter_unit: 'mi', recorded_on: '2099-01-01' }, jurisdiction: { based_country: 'NZ' } });
    await expect(previewOnboardingSession(draft.id, draft.revision, owner)).rejects.toMatchObject({ code: 'future_reading' });
    expect(await getDb().select().from(assets)).toHaveLength(0);
    const fixed = await save(draft, 'identity', { ...draft.draft.identity, recorded_on: todayInTz('Pacific/Auckland') });
    await accept(fixed);
    expect((await getDb().select().from(assets))[0]?.meter_unit).toBe('mi');
  });

  it('retains draft sources outside the commit and promotes their associations only on success', async () => {
    const draft = await start();
    const source = await retainSource(getDb(), { kind: 'text', subject: { session_id: draft.id }, ownerId: owner, actor: `session:${owner}`, label: 'Original receipt', text: 'Service possibly March 2024; date unknown.' });
    const preview = await previewOnboardingSession(draft.id, draft.revision, owner);
    expect((await getDb().select().from(source_links))[0]?.session_id).toBe(draft.id);
    expect(await getDb().select().from(assets)).toHaveLength(0);
    const result = await completeOnboardingSession(draft.id, { expected_revision: draft.revision, preview_fingerprint: preview.fingerprint, operation_key: randomUUID() }, owner);
    expect((await getDb().select().from(source_links))[0]).toMatchObject({ id: source.id, session_id: null, asset_id: result.session.subject_id });
  });

  it('keeps installed equipment separate from ideas, orders and approved projects', async () => {
    const draft = await start({ identity, state: { installed_equipment: [{ name: 'Roof rack', installed_on: '2024-01-01' }] }, plans: { projects: [
      { key: 'idea', name: 'Suspension', state: 'idea' }, { key: 'order', name: 'Awning', state: 'ordered' }, { key: 'approved', name: 'Tyres', state: 'approved' },
    ] } });
    await accept(draft);
    expect((await getDb().select().from(assets))[0]?.metadata.installed_equipment).toEqual([{ name: 'Roof rack', installed_on: '2024-01-01' }]);
    const rows = await getDb().select().from(projects);
    expect(rows.find((p) => p.name === 'Awning')).toMatchObject({ status: 'idea', description: 'Ordered; not installed.\n' });
    expect(rows.find((p) => p.name === 'Tyres')?.status).toBe('active');
  });

  it('previews actual pinned tracking and retains unknown legal applicability as an assessment', async () => {
    const draft = await start({ identity, tracking: { items: [
      { key: 'reminder', name: 'Owner reminder', kind: 'user_reminder', applicability: 'unknown', evidence_basis: 'user_reported', source_ids: [], source_note: 'Owner remembers this date', policy: 'expiry', next_due_date: '2027-06-01', track: true },
      { key: 'legal', name: 'Unresolved question', kind: 'regulatory', applicability: 'unknown', evidence_basis: 'user_reported', source_ids: [], source_note: 'Applicability still needs checking', policy: 'expiry', track: false },
    ] } });
    const { preview } = await accept(draft);
    expect(JSON.stringify(preview.changes)).toContain('2027-06-01');
    expect(JSON.stringify(preview.changes)).toContain('"lead_days":0');
    expect(await getDb().select().from(maintenance_items)).toHaveLength(1);
    expect((await getDb().select().from(maintenance_items))[0]?.lead_days).toBe(0);
    expect(await getDb().select().from(vehicle_assessments)).toHaveLength(2);
    expect(await getDb().select().from(maintenance_logs)).toHaveLength(0);
  });

  it('rolls the entire projection back when one unsupported regulatory item follows a valid project', async () => {
    const draft = await start({ identity, plans: { projects: [{ key: 'p', name: 'Not committed', state: 'idea' }] }, tracking: { items: [
      { key: 'bad', name: 'Unverified rule', kind: 'regulatory', applicability: 'unknown', evidence_basis: 'user_reported', source_ids: [], source_note: 'Unknown application', policy: 'expiry', track: true },
    ] } });
    await expect(previewOnboardingSession(draft.id, draft.revision, owner)).rejects.toMatchObject({ code: 'applicability_unknown' });
    expect(await getDb().select().from(assets)).toHaveLength(0);
    expect(await getDb().select().from(projects).where(eq(projects.name, 'Not committed'))).toHaveLength(0);
  });

  it('preserves rich and unrelated metadata, authored Markdown and lifecycle on enrichment', async () => {
    const asset = await createAsset(getDb(), { name: 'My Prado', kind: 'vehicle', metadata: { ...identity, make: { value: 'Toyota', source: 'Original manual', verified: true }, private_legacy: { keep: [1, 2] } }, doc_md: '# Owner text\nKeep my notes.' });
    await updateAsset(getDb(), asset.id, { lifecycle: 'stored' }, { today: todayInTz('Pacific/Auckland'), staleDays: 14 }, 'session:test');
    const draft = await start({}, asset.id);
    const edited = await save(draft, 'jurisdiction', { based_country: 'NZ' });
    await accept(edited);
    const [saved] = await getDb().select().from(assets).where(eq(assets.id, asset.id));
    expect(saved).toMatchObject({ lifecycle: 'stored', doc_md: '# Owner text\nKeep my notes.', name: 'My Prado' });
    expect(saved?.metadata.make).toEqual({ value: 'Toyota', source: 'Original manual', verified: true });
    expect(saved?.metadata.private_legacy).toEqual({ keep: [1, 2] });
  });

  it('rejects changing an originally loaded fact even before the first preview', async () => {
    const asset = await createAsset(getDb(), { name: 'Vehicle', kind: 'vehicle', metadata: identity });
    const draft = await start({}, asset.id);
    await updateAsset(getDb(), asset.id, { metadata_patch: { set: { make: { value: 'Other', expected: 'Toyota' } } } }, { today: todayInTz('Pacific/Auckland'), staleDays: 14 }, 'session:other');
    const edited = await save(draft, 'identity', { ...draft.draft.identity, make: 'My changed make' });
    await expect(previewOnboardingSession(draft.id, edited.revision, owner)).rejects.toMatchObject({ code: 'fact_conflict' });
    await expect(save(edited, 'review', { baseline: { asset: null } })).rejects.toMatchObject({ code: 'readonly_draft_field' });
  });

  it('refuses a previously reviewed commit when the related source state changes', async () => {
    const draft = await start();
    const preview = await previewOnboardingSession(draft.id, draft.revision, owner);
    await retainSource(getDb(), { kind: 'text', subject: { session_id: draft.id }, ownerId: owner, actor: `session:${owner}`, label: 'New evidence', text: 'Additional evidence added after preview' });
    await expect(completeOnboardingSession(draft.id, { expected_revision: draft.revision, preview_fingerprint: preview.fingerprint, operation_key: randomUUID() }, owner)).rejects.toMatchObject({ code: 'preview_stale' });
    expect(await getDb().select().from(assets)).toHaveLength(0);
  });

  it.each(['asset_document', 'reading', 'project', 'source_attachment', 'responsibility', 'assessment_tracking'] as const)('rolls back a real completion failure after the %s boundary and preserves source originals for retry', async (boundary) => {
    const originalDocRevisions = await getDb().select().from(doc_revisions);
    const session = await start({ identity: { ...identity, reading: 87600, meter_unit: 'km' }, plans: { projects: [{ key: 'plan', name: 'Retained future idea', state: 'idea' }] }, tracking: { items: [{
      key: 'reminder', name: 'Owner-entered check', kind: 'user_reminder', applicability: 'unknown', evidence_basis: 'user_reported', source_ids: [], source_note: 'Owner supplied this reminder', policy: 'expiry', next_due_date: '2027-06-01', track: true,
    }] } });
    const source = await retainSource(getDb(), { kind: 'text', subject: { session_id: session.id }, ownerId: owner, actor: `session:${owner}`, label: 'Original retained evidence', text: 'Service history remains uncertain.' });
    const preview = await previewOnboardingSession(session.id, session.revision, owner);
    const request = { expected_revision: session.revision, preview_fingerprint: preview.fingerprint, operation_key: randomUUID() };
    let inCommit = false;
    const failAfterCommand = () => { if (inCommit) throw new Error(`test failure after ${boundary}`); };
    // Test spies leave the real preview and shared commands intact. Only the
    // final commit throws after its selected write boundary; there are no
    // production fault switches or substitute command implementations.
    const originalCommit = vehicleOnboardingModule.commit;
    vi.spyOn(vehicleOnboardingModule, 'commit').mockImplementation(async (...args) => { inCommit = true; try { return await originalCommit(...args); } finally { inCommit = false; } });
    if (boundary === 'asset_document') { const original = assetCommands.createAsset; vi.spyOn(assetCommands, 'createAsset').mockImplementation(async (...args) => { const result = await original(...args); failAfterCommand(); return result; }); }
    if (boundary === 'reading') { const original = readingCommands.recordReading; vi.spyOn(readingCommands, 'recordReading').mockImplementation(async (...args) => { const result = await original(...args); failAfterCommand(); return result; }); }
    if (boundary === 'project') { const original = structureCommands.createProject; vi.spyOn(structureCommands, 'createProject').mockImplementation(async (...args) => { const result = await original(...args); failAfterCommand(); return result; }); }
    if (boundary === 'source_attachment') { const original = sourceCommands.attachSessionSources; vi.spyOn(sourceCommands, 'attachSessionSources').mockImplementation(async (...args) => { const result = await original(...args); failAfterCommand(); return result; }); }
    if (boundary === 'responsibility') { const original = knowledgeCommands.createResponsibilityRule; vi.spyOn(knowledgeCommands, 'createResponsibilityRule').mockImplementation(async (...args) => { const result = await original(...args); failAfterCommand(); return result; }); }
    if (boundary === 'assessment_tracking') { const original = knowledgeCommands.applyKnowledgeChange; vi.spyOn(knowledgeCommands, 'applyKnowledgeChange').mockImplementation(async (...args) => { const result = await original(...args); failAfterCommand(); return result; }); }
    try { await expect(completeOnboardingSession(session.id, request, owner)).rejects.toThrow(`test failure after ${boundary}`); }
    finally { vi.restoreAllMocks(); }
    expect(await getDb().select().from(assets)).toHaveLength(0);
    expect(await getDb().select().from(doc_revisions)).toHaveLength(originalDocRevisions.length);
    expect(await getDb().select().from(asset_meter_readings)).toHaveLength(0);
    expect(await getDb().select().from(projects).where(eq(projects.name, 'Retained future idea'))).toHaveLength(0);
    expect(await getDb().select().from(responsibility_rules)).toHaveLength(0);
    expect(await getDb().select().from(responsibility_rule_versions)).toHaveLength(0);
    expect(await getDb().select().from(knowledge_change_previews)).toHaveLength(0);
    expect(await getDb().select().from(vehicle_assessments)).toHaveLength(0);
    expect(await getDb().select().from(maintenance_items)).toHaveLength(0);
    expect(await getDb().select().from(maintenance_logs)).toHaveLength(0);
    expect(await getDb().select().from(tasks)).toHaveLength(0);
    expect((await getDb().select().from(onboarding_sessions).where(eq(onboarding_sessions.id, session.id)))[0]).toMatchObject({ status: 'in_progress', commit_receipt: null, commit_operation_key: null });
    expect(await getDb().select().from(source_documents)).toHaveLength(1);
    expect((await getDb().select().from(source_links))[0]).toMatchObject({ id: source.id, session_id: session.id, asset_id: null });
    const retry = await completeOnboardingSession(session.id, request, owner);
    expect(retry.session.status).toBe('completed');
    expect(await getDb().select().from(assets)).toHaveLength(1);
    expect((await getDb().select().from(source_links))[0]).toMatchObject({ session_id: null, asset_id: retry.session.subject_id });
  });
  it('allows optional identifiers to be cleared without blocking required identity confirmation', async () => {
    const asset = await createAsset(getDb(), { name: 'Named vehicle', kind: 'vehicle', metadata: { ...identity, vin: { value: '00001234', source: 'Owner document' }, plate: '001ABC' } });
    let session = await start({}, asset.id);
    session = await saveOnboardingStep(session.id, 'identity', { expected_revision: session.revision, state: 'confirmed', values: {
      ...session.draft.identity, vin: '', plate: '', chassis_id: '', model_code: '', variant: '',
    } }, owner);
    await accept(session);
    const [saved] = await getDb().select().from(assets).where(eq(assets.id, asset.id));
    expect(saved?.name).toBe('Named vehicle');
    expect(saved?.metadata).not.toHaveProperty('vin');
    expect(saved?.metadata).not.toHaveProperty('plate');
    expect(factValue(saved?.metadata.make)).toBe('Toyota');
  });

  it('prefills valid facts independently of one legacy field and preserves existing notes and estimates', async () => {
    // Historical data can predate validation. Simulate a populated upgrade.
    const [asset] = await getDb().insert(assets).values({ name: 'Legacy vehicle', kind: 'vehicle', metadata: {
      ...identity, plate: 123, history_notes: { value: 'Receipts begin in 2023', source: 'Original owner' },
      estimated_usage: { value: 'About 1,000 mi/month', source: 'Owner estimate' },
    } }).returning();
    const session = await start({}, asset!.id);
    expect(session.draft.identity).toMatchObject(identity);
    expect(session.draft.identity).not.toHaveProperty('plate');
    expect(session.draft.history?.notes).toBe('Receipts begin in 2023');
    expect(session.draft.plans?.estimated_usage).toBe('About 1,000 mi/month');
    const edited = await save(session, 'jurisdiction', { based_country: 'NZ' });
    await accept(edited);
    const [saved] = await getDb().select().from(assets).where(eq(assets.id, asset!.id));
    expect(saved?.metadata.plate).toBe(123);
    expect(saved?.metadata.history_notes).toEqual({ value: 'Receipts begin in 2023', source: 'Original owner' });
    expect(saved?.metadata.estimated_usage).toEqual({ value: 'About 1,000 mi/month', source: 'Owner estimate' });
  });

  it('retains incomplete skipped optional answers in the session without applying them', async () => {
    let session = await start();
    for (const [step, values] of [
      ['state', { ownership: { purchase_date: { precision: 'month' }, purchase_reading: { amount: 54000, unit: null } } }],
      ['jurisdiction', { based_country: 'N' }],
      ['plans', { projects: [{ key: 'unfinished', name: '', state: 'idea' }] }],
      ['tracking', { items: [{ key: 'unfinished', name: '', source_note: '' }] }],
    ] as const) {
      session = await saveOnboardingStep(session.id, step, { expected_revision: session.revision, values: values as unknown as OnboardingDraft[string], state: 'skipped' }, owner);
    }
    const { result } = await accept(session);
    expect(result.session.draft.state?.ownership).toMatchObject({ purchase_reading: { amount: 54000, unit: null } });
    const [saved] = await getDb().select().from(assets);
    expect(saved?.metadata).not.toHaveProperty('vehicle_ownership_evidence');
    expect(saved?.metadata).not.toHaveProperty('based_country');
    expect(saved?.metadata.vehicle_answer_states).toMatchObject({ deferred_sections: expect.arrayContaining(['state', 'jurisdiction', 'plans', 'tracking']) });
    expect(await getDb().select().from(projects)).toHaveLength(0);
    expect(await getDb().select().from(maintenance_items)).toHaveLength(0);
  });

  it('skipping edits preserves an existing lifecycle and unrelated deferred sections', async () => {
    const asset = await createAsset(getDb(), { name: 'Stored vehicle', kind: 'vehicle', metadata: { ...identity, vehicle_answer_states: { deferred_sections: ['history', 'tracking'] } } });
    await updateAsset(getDb(), asset.id, { lifecycle: 'stored' }, { today: todayInTz('Pacific/Auckland'), staleDays: 14 }, 'session:test');
    let session = await start({}, asset.id);
    session = await saveOnboardingStep(session.id, 'state', { expected_revision: session.revision, values: { lifecycle: 'sold', engine: 'unconfirmed edit' }, state: 'skipped' }, owner);
    session = await saveOnboardingStep(session.id, 'history', { expected_revision: session.revision, values: { coverage: 'partial' }, state: 'confirmed' }, owner);
    await accept(session);
    const [saved] = await getDb().select().from(assets).where(eq(assets.id, asset.id));
    expect(saved?.lifecycle).toBe('stored'); expect(saved?.metadata).not.toHaveProperty('engine');
    expect(saved?.metadata.vehicle_answer_states).toMatchObject({ deferred_sections: ['tracking', 'state'] });
  });

});
