import { describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import type { KnowledgeChangeInput } from '@jevi-ops/shared';
import { getDb } from '../src/lib/db.js';
import { assets, app_settings, maintenance_items, tasks } from '../src/db/schema.js';
import { source_documents, source_links } from '../src/db/source-schema.js';
import { knowledge_transitions, vehicle_assessments } from '../src/db/knowledge-schema.js';
import { createAsset, updateAsset } from '../src/lib/asset-commands.js';
import {
  applyKnowledgeChange, assessmentHistory, cancelKnowledgeTransition, createKnowledgeFollowup,
  createResponsibilityRule, previewKnowledgeChange, processKnowledgeTransitions, resolveKnowledgeEffectiveTime,
  reviseResponsibilityRule, transitionAudit, vehicleKnowledge,
} from '../src/lib/knowledge.js';
import { runMaintenanceSweep } from '../src/lib/maintenance-sweep.js';
import { createItem, daysFromToday, getItem, getTask, today } from './helpers.js';

const actor = 'session:knowledge-test';
const NOW = '2026-09-10T12:00:00.000Z';
const NEXT = '2026-09-12T12:00:00.000Z';
const ctx = { today: '2026-09-10', staleDays: 30 };
async function asset() { return createAsset(getDb(), { name: 'Vehicle', kind: 'vehicle', meter_unit: 'km', metadata: { registration_country: 'NZ', fuel_powertrain: 'petrol' } }); }
async function rule(kind: 'user_reminder' | 'regulatory' = 'user_reminder', status: 'accepted' | 'proposed' = 'accepted') {
  return createResponsibilityRule(getDb(), { title: 'Synthetic responsibility', kind, status, source_note: 'User supplied synthetic scenario; not legal guidance.', reason: 'Record known responsibility' }, actor);
}
function change(assetId: string, versionId: string, extra: Partial<KnowledgeChangeInput> = {}): KnowledgeChangeInput {
  return { asset_id: assetId, rule_version_id: versionId, assessment: { applicability: 'unknown', evidence_basis: 'user_reported', rationale: 'Knowledge remains incomplete.' }, reason: 'Owner confirmed this change', ...extra };
}
async function accept(input: KnowledgeChangeInput, key: string, now = NOW) {
  const preview = await previewKnowledgeChange(getDb(), input, actor, now);
  const request = { preview_id: preview.id, operation_key: key, fingerprint: preview.fingerprint };
  return { receipt: await applyKnowledgeChange(getDb(), request, actor, ctx, now), preview, request };
}

async function getAssessment(assetId: string) {
  const [row] = await getDb().select().from(vehicle_assessments).where(eq(vehicle_assessments.asset_id, assetId));
  return row!;
}

// All policy names and dates are synthetic, fixed software fixtures.
describe('manual vehicle responsibility knowledge without a worker', () => {
  it('returns the original responsibility version for an identical creation retry after later revisions', async () => {
    const input = { creation_key: 'manual-definition', title: 'Original manual reminder', kind: 'user_reminder' as const, reason: 'Create one definition' };
    const initial = await createResponsibilityRule(getDb(), input, actor);
    await reviseResponsibilityRule(getDb(), initial.rule_id, { expected_version: 1, title: 'Later version', kind: 'user_reminder', reason: 'Owner revised the definition' }, actor);
    expect((await createResponsibilityRule(getDb(), input, actor)).id).toBe(initial.id);
    await expect(createResponsibilityRule(getDb(), { ...input, title: 'Conflicting retry' }, actor)).rejects.toMatchObject({ code: 'operation_key_conflict' });
  });

  it('uses normal policy tracking while keeping unknown applicability honest', async () => {
    const vehicle = await asset();
    for (const policy of ['expiry', 'prepaid_meter', 'interval'] as const) {
      const reference = await rule();
      const { receipt } = await accept(change(vehicle.id, reference.id, { tracking: { action: 'create', item: { name: `Manual ${policy}`, policy, ...(policy === 'interval' ? { interval_months: 12 } : {}), ...(policy === 'expiry' ? { next_due_date: '2027-01-01' } : {}), ...(policy === 'prepaid_meter' ? { next_due_meter: 100000 } : {}) } } }), `manual-${policy}`);
      const item = await getItem(receipt.item_id!);
      expect(item.policy).toBe(policy);
      expect(item.asset_id).toBe(vehicle.id);
    }
    const knowledge = await vehicleKnowledge(getDb(), vehicle.id, NOW);
    expect(knowledge.assessments).toHaveLength(3);
    expect(knowledge.assessments.every((a) => a.applicability === 'unknown' && a.knowledge_label === 'Applicability not established')).toBe(true);
  });

  it('retains dated negative decisions and invalidates relevant facts and shared-rule revisions', async () => {
    const first = await asset(), second = await asset();
    const reference = await rule('regulatory');
    await accept(change(first.id, reference.id, { assessment: { applicability: 'not_applicable', rationale: 'Prior synthetic decision', last_checked_at: NOW, review_due_at: NEXT } }), 'assessment-first');
    await accept(change(second.id, reference.id), 'assessment-second');
    await updateAsset(getDb(), first.id, { metadata_patch: { set: { registration_country: { value: 'US', expected: 'NZ' } } } }, ctx, actor);
    let current = await getAssessment(first.id);
    expect(current.review_state).toBe('needs_review');
    expect(current.applicability).toBe('not_applicable');
    expect(current.relevant_facts.registration_country).toBe('NZ');
    expect((await assessmentHistory(getDb(), current.id)).map((h) => h.revision)).toEqual([2, 1]);
    await reviseResponsibilityRule(getDb(), reference.rule_id, { expected_version: 1, title: 'Revised synthetic rule', kind: 'regulatory', reason: 'New source version', source_note: 'Unverified user note' }, actor);
    current = await getAssessment(first.id);
    expect(current.revision).toBe(3);
    expect((await getAssessment(second.id)).review_state).toBe('needs_review');
    expect(current.rule_version_id).toBe(reference.id);
    expect((await vehicleKnowledge(getDb(), first.id, '2026-10-01T00:00:00Z')).assessments[0]?.freshness).toBe('review_due');
  });

  it('rejects unreviewed/proposed regulation activation and records a pending watch assessment', async () => {
    const vehicle = await asset(), proposed = await rule('regulatory', 'proposed');
    const operation = change(vehicle.id, proposed.id, { assessment: { applicability: 'applicable', rationale: 'Synthetic future proposal' }, tracking: { action: 'create', item: { name: 'Possible charge', policy: 'prepaid_meter', next_due_meter: 100000 } } });
    await expect(previewKnowledgeChange(getDb(), operation, actor, NOW)).rejects.toMatchObject({ code: 'rule_not_accepted' });
    const { receipt } = await accept(change(vehicle.id, proposed.id, { assessment: { applicability: 'unknown', review_state: 'unreviewed', rationale: 'Watch proposed legislation; no obligation established.' } }), 'watch');
    expect(receipt.item_id).toBeNull();
    const reference = await rule('regulatory');
    await expect(previewKnowledgeChange(getDb(), change(vehicle.id, reference.id, { tracking: operation.tracking }), actor, NOW)).rejects.toMatchObject({ code: 'applicability_unknown' });
  });

  it('requires retained evidence for a document-supported assertion and keeps follow-ups idempotent', async () => {
    const vehicle = await asset(), reference = await rule();
    await expect(previewKnowledgeChange(getDb(), change(vehicle.id, reference.id, { assessment: { applicability: 'unknown', evidence_basis: 'document_supported', rationale: 'No document actually retained' } }), actor, NOW)).rejects.toMatchObject({ code: 'evidence_required' });
    const { receipt } = await accept(change(vehicle.id, reference.id), 'gap');
    const first = await createKnowledgeFollowup(getDb(), receipt.assessment_id!, actor);
    const retry = await createKnowledgeFollowup(getDb(), receipt.assessment_id!, actor);
    expect(retry.id).toBe(first.id);
    expect(first.source).toBe('manual');
    expect(first.source_ref).toBe(`knowledge-assessment:${receipt.assessment_id}`);
    expect(first.due_date).toBeNull();
  });

  it('binds reviewed state and operation key, rejecting stale schedule or fact changes', async () => {
    const vehicle = await asset(), reference = await rule();
    const item = await createItem({ asset_id: vehicle.id, interval_meter: null });
    const operation = change(vehicle.id, reference.id, { tracking: { action: 'update', item_id: item.id, patch: { next_due_date: '2027-01-01' } } });
    const preview = await previewKnowledgeChange(getDb(), operation, actor, NOW);
    await getDb().update(maintenance_items).set({ next_due_date: '2028-01-01' }).where(eq(maintenance_items.id, item.id));
    await expect(applyKnowledgeChange(getDb(), { preview_id: preview.id, operation_key: 'stale', fingerprint: preview.fingerprint }, actor, ctx, NOW)).rejects.toMatchObject({ code: 'precondition_conflict' });
    const accepted = await accept(operation, 'accepted');
    expect(await applyKnowledgeChange(getDb(), accepted.request, actor, ctx, NEXT)).toEqual(accepted.receipt);
    await expect(applyKnowledgeChange(getDb(), { ...accepted.request, operation_key: 'another-key' }, actor, ctx, NEXT)).rejects.toMatchObject({ code: 'operation_key_conflict' });
    await expect(previewKnowledgeChange(getDb(), change(vehicle.id, reference.id, { facts_patch: { set: { fuel_powertrain: { value: 'diesel' } } } }), actor, NOW)).rejects.toThrow();
  });

  it('rechecks displayed tracking effects across scheduling days and settings changes', async () => {
    const vehicle = await asset(), reference = await rule();
    const operation = change(vehicle.id, reference.id, { tracking: { action: 'create', item: { name: 'Reviewed expiry', policy: 'expiry', next_due_date: '2027-01-01' } } });
    const preview = await previewKnowledgeChange(getDb(), operation, actor, NOW);
    const request = { preview_id: preview.id, operation_key: 'reviewed-context', fingerprint: preview.fingerprint };
    await expect(applyKnowledgeChange(getDb(), request, actor, ctx, NEXT)).rejects.toMatchObject({ code: 'tracking_effects_changed' });
    await getDb().update(app_settings).set({ timezone: 'Pacific/Auckland', meter_stale_days: 7 }).where(eq(app_settings.id, true));
    await expect(applyKnowledgeChange(getDb(), request, actor, ctx, NOW)).rejects.toMatchObject({ code: 'precondition_conflict' });
    expect(await getDb().select().from(maintenance_items).where(eq(maintenance_items.asset_id, vehicle.id))).toHaveLength(0);
  });

  it('preserves annotated work while deactivating linked tracking with an accepted assessment change', async () => {
    const vehicle = await asset(), reference = await rule();
    const item = await createItem({ asset_id: vehicle.id, interval_meter: null, next_due_date: await daysFromToday(0) });
    await runMaintenanceSweep(getDb());
    const generatedId = (await getItem(item.id)).generated_task_id!;
    await getDb().update(tasks).set({ notes: 'Keep my booking details' }).where(eq(tasks.id, generatedId));
    const { receipt } = await accept(change(vehicle.id, reference.id, { tracking: { action: 'update', item_id: item.id, patch: { active: false } }, assessment: { applicability: 'not_applicable', rationale: 'Owner retired synthetic tracking' } }), 'retire');
    expect(receipt.item_id).toBe(item.id);
    expect((await getItem(item.id)).active).toBe(false);
    expect(await getTask(generatedId)).toMatchObject({ notes: 'Keep my booking details', source_ref: null });
  });
});

describe('accepted future transitions run locally', () => {
  it('requires review when scheduling settings change but retains explicitly dynamic late-activation behavior', async () => {
    const vehicle = await asset(), reference = await rule();
    const accepted = await accept(change(vehicle.id, reference.id, { tracking: { action: 'create', item: { name: 'Future interval', interval_months: 12 } }, effective: { kind: 'instant', at: NEXT } }), 'future-settings');
    expect(accepted.preview.changes.find((entry) => entry.kind === 'tracking')!.after).toMatchObject({ derive_date_on_activation: true, item: { next_due_date: null } });
    await getDb().update(app_settings).set({ meter_stale_days: 1 }).where(eq(app_settings.id, true));
    expect(await processKnowledgeTransitions(getDb(), ctx, '2026-09-20T12:00:00.000Z')).toMatchObject({ needs_review: 1, applied: 0 });
    expect(await getDb().select().from(maintenance_items).where(eq(maintenance_items.asset_id, vehicle.id))).toHaveLength(0);
  });

  it('compares offset timestamps and database round-trips by their actual instant', async () => {
    const vehicle = await asset(), reference = await rule();
    const sameInstant = '2026-09-11T00:00:00+12:00';
    const accepted = await accept(change(vehicle.id, reference.id, {
      assessment: { applicability: 'unknown', rationale: 'Offset timestamp supplied by the owner', assessed_at: sameInstant, last_checked_at: sameInstant, review_due_at: '2026-09-12T00:00:00+12:00' },
    }), 'offset-assessment');
    const row = await getAssessment(vehicle.id);
    expect(Date.parse(row.assessed_at)).toBe(Date.parse(NOW));
    expect((await vehicleKnowledge(getDb(), vehicle.id, '2026-09-12T01:00:00+12:00')).assessments[0]?.freshness).toBe('review_due');
    const pending = await accept(change(vehicle.id, reference.id, { effective: { kind: 'instant', at: '2026-09-12T00:00:00+12:00' } }), 'offset-transition');
    expect(pending.receipt.status).toBe('pending');
    expect(await processKnowledgeTransitions(getDb(), ctx, '2026-09-12T00:00:00+12:00')).toMatchObject({ applied: 1 });
    expect(accepted.receipt.assessment_id).toBe(row.id);
  });
  it('resolves a date only in its explicitly recorded timezone and retains unresolved times', () => {
    expect(resolveKnowledgeEffectiveTime({ kind: 'date', date: '2026-09-12' })).toBeNull();
    expect(resolveKnowledgeEffectiveTime({ kind: 'date', date: '2026-09-12', timezone: 'Pacific/Auckland' })).toBe('2026-09-11T12:00:00.000Z');
    expect(resolveKnowledgeEffectiveTime({ kind: 'date', date: '2026-01-12', timezone: 'Pacific/Auckland' })).toBe('2026-01-11T11:00:00.000Z');
    expect(resolveKnowledgeEffectiveTime({ kind: 'date', date: '2011-12-30', timezone: 'Pacific/Apia' })).toBeNull();
    expect(() => resolveKnowledgeEffectiveTime({ kind: 'date', date: '2026-09-12', timezone: 'Not/AZone' })).toThrow();
  });

  it('does not activate early; restart catch-up applies exactly once and keeps the original receipt', async () => {
    const vehicle = await asset(), reference = await rule('regulatory');
    const operation = change(vehicle.id, reference.id, { assessment: { applicability: 'applicable', rationale: 'Accepted synthetic applicability' }, tracking: { action: 'create', item: { name: 'Synthetic issued expiry', policy: 'expiry', next_due_date: '2027-01-01' } }, effective: { kind: 'instant', at: NEXT } });
    const accepted = await accept(operation, 'future');
    expect(accepted.receipt.status).toBe('pending');
    expect(await getDb().select().from(maintenance_items).where(eq(maintenance_items.asset_id, vehicle.id))).toHaveLength(0);
    expect(await processKnowledgeTransitions(getDb(), ctx, NOW)).toEqual({ examined: 0, applied: 0, needs_review: 0 });
    expect(await processKnowledgeTransitions(getDb(), ctx, '2026-09-20T12:00:00.000Z')).toEqual({ examined: 1, applied: 1, needs_review: 0 });
    expect(await processKnowledgeTransitions(getDb(), ctx, '2026-09-21T12:00:00.000Z')).toEqual({ examined: 0, applied: 0, needs_review: 0 });
    expect(await getDb().select().from(maintenance_items).where(eq(maintenance_items.asset_id, vehicle.id))).toHaveLength(1);
    expect((await transitionAudit(getDb(), accepted.receipt.transition_id!)).map((h) => h.snapshot.status)).toEqual(['applied', 'pending']);
    expect(await applyKnowledgeChange(getDb(), accepted.request, actor, ctx, NEXT)).toEqual(accepted.receipt);
  });

  it('sends changed facts and inactive lifecycles for review instead of inferring a replacement', async () => {
    for (const field of ['fuel_powertrain', 'lifecycle'] as const) {
      const vehicle = await asset(), reference = await rule();
      const accepted = await accept(change(vehicle.id, reference.id, { tracking: { action: 'create', item: { name: 'Future service', interval_months: 12 } }, effective: { kind: 'instant', at: NEXT } }), `conflict-${field}`);
      await updateAsset(getDb(), vehicle.id, field === 'lifecycle' ? { lifecycle: 'sold' } : { metadata_patch: { set: { fuel_powertrain: { value: 'diesel', expected: 'petrol' } } } }, ctx, actor);
      expect(await processKnowledgeTransitions(getDb(), ctx, NEXT)).toMatchObject({ applied: 0, needs_review: 1 });
      const [transition] = await getDb().select().from(knowledge_transitions).where(eq(knowledge_transitions.id, accepted.receipt.transition_id!));
      expect(transition?.status).toBe('needs_review');
      expect(await getDb().select().from(maintenance_items).where(eq(maintenance_items.asset_id, vehicle.id))).toHaveLength(0);
    }
  });

  it('requires a new review when accepted evidence is superseded and cancellation wins deterministically', async () => {
    const vehicle = await asset(), reference = await rule();
    const accepted = await accept(change(vehicle.id, reference.id, { tracking: { action: 'create', item: { name: 'Future service', interval_months: 12 } }, effective: { kind: 'instant', at: NEXT } }), 'new-evidence');
    await reviseResponsibilityRule(getDb(), reference.rule_id, { expected_version: 1, title: 'Changed', kind: 'user_reminder', reason: 'New supporting evidence' }, actor);
    expect(await processKnowledgeTransitions(getDb(), ctx, NEXT)).toMatchObject({ applied: 0, needs_review: 1 });
    const cancelled = await cancelKnowledgeTransition(getDb(), accepted.receipt.transition_id!, { expected_revision: 2, reason: 'Owner decided to replace the proposal' }, actor);
    expect(cancelled.status).toBe('cancelled');
    expect(await processKnowledgeTransitions(getDb(), ctx, NEXT)).toMatchObject({ examined: 0 });
    await expect(cancelKnowledgeTransition(getDb(), accepted.receipt.transition_id!, { expected_revision: 2, reason: 'Stale cancellation' }, actor)).rejects.toMatchObject({ code: 'transition_conflict' });
  });

  it('keeps unknown activation time pending and retains source association upon approval', async () => {
    const vehicle = await asset();
    const [source] = await getDb().insert(source_documents).values({ kind: 'text', content_hash: `knowledge-${vehicle.id}`, media_type: 'text/plain', size_bytes: 9, text_content: 'Synthetic' }).returning();
    const reference = await createResponsibilityRule(getDb(), { title: 'Future rule', kind: 'regulatory', source_ids: [source!.id], reason: 'Owner retained the source', effective_from: { kind: 'date', date: '2027-01-01' } }, actor);
    const accepted = await accept(change(vehicle.id, reference.id, { assessment: { applicability: 'applicable', evidence_basis: 'document_supported', rationale: 'Time basis awaits confirmation' }, tracking: { action: 'create', item: { name: 'Future responsibility', policy: 'expiry' } }, effective: { kind: 'unknown' } }), 'unknown-time');
    expect(accepted.receipt.status).toBe('pending');
    expect(await processKnowledgeTransitions(getDb(), ctx, '2030-01-01T00:00:00.000Z')).toMatchObject({ examined: 0 });
    expect(await getDb().select().from(source_links).where(and(eq(source_links.asset_id, vehicle.id), eq(source_links.source_id, source!.id)))).toHaveLength(1);
  });

  it('prohibits early activation before the source rule becomes effective', async () => {
    const vehicle = await asset();
    const reference = await createResponsibilityRule(getDb(), { title: 'Future synthetic rule', kind: 'regulatory', effective_from: { kind: 'instant', at: NEXT }, reason: 'Source establishes its future date' }, actor);
    const operation = change(vehicle.id, reference.id, { assessment: { applicability: 'applicable', rationale: 'Synthetic future applicability' }, tracking: { action: 'create', item: { name: 'Later obligation', policy: 'expiry' } } });
    await expect(previewKnowledgeChange(getDb(), operation, actor, NOW)).rejects.toMatchObject({ code: 'rule_not_effective' });
    await expect(accept({ ...operation, effective: { kind: 'instant', at: NEXT } }, 'right-date')).resolves.toMatchObject({ receipt: { status: 'pending' } });
  });
});
