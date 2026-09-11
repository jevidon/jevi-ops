import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb } from '../src/lib/db.js';
import { assets, asset_meter_readings } from '../src/db/schema.js';
import { source_documents } from '../src/db/source-schema.js';
import { vehicle_assessments } from '../src/db/knowledge-schema.js';
import { research_jobs, research_proposals, research_workers } from '../src/db/research-schema.js';
import { monitoring_notifications, monitoring_policies, monitoring_review_runs } from '../src/db/monitoring-schema.js';
import { createAsset, updateAsset } from '../src/lib/asset-commands.js';
import { applyKnowledgeChange, createResponsibilityRule, previewKnowledgeChange } from '../src/lib/knowledge.js';
import { claimResearchJob, createResearchWorker, recordResearchWorkerHealth, rejectResearchProposal, researchJobContext, submitResearchResult } from '../src/lib/research.js';
import { createMonitoringPolicy, listMonitoringPolicies, monitoringPolicyDetail, runMonitoringSweep, signalMonitoringReview, updateMonitoringPolicy } from '../src/lib/monitoring.js';

const NOW = '2026-09-11T12:00:00.000Z', LATER = '2026-09-11T12:00:05.000Z';
const owner = 'session:monitoring-test', ctx = { today: '2026-09-11', staleDays: 30 };
async function vehicle() { return createAsset(getDb(), { name: 'Synthetic test vehicle', kind: 'vehicle', meter_unit: 'km', metadata: { registration_country: 'NZ', fuel_powertrain: 'petrol' } }); }
async function worker(ready = true, now = NOW) {
  const row = await createResearchWorker(getDb(), { name: 'Synthetic monitor', adapter: 'hermes', adapter_version: 'test', capabilities: ['external_fetch'], allowed_task_types: ['source_verification', 'responsibility_review'] });
  if (ready) await readyWorker(row.id, now);
  return row;
}
async function readyWorker(id: string, now: string) { await getDb().update(research_workers).set({ configuration_verified: true, last_health_ok: true, last_seen_at: now, last_successful_at: now }).where(eq(research_workers.id, id)); }
async function policy(assetIds: string[], workerId: string, overrides: Record<string, unknown> = {}) {
  return createMonitoringPolicy(getDb(), { name: 'Synthetic regulatory review', asset_ids: assetIds, worker_id: workerId, question: 'Review the synthetic example rule.', allowed_domains: ['example.org'], cadence_hours: 24, enabled: true, ...overrides }, owner, NOW);
}
async function negative(assetId: string, kind: 'regulatory' | 'user_reminder' = 'regulatory') {
  const rule = await createResponsibilityRule(getDb(), { title: `Synthetic ${kind}`, kind, reason: 'Manual dated knowledge', source_note: 'Synthetic fixture, not a real rule.' }, owner);
  const preview = await previewKnowledgeChange(getDb(), { asset_id: assetId, rule_version_id: rule.id, assessment: { applicability: 'not_applicable', rationale: 'Earlier synthetic negative decision', last_checked_at: NOW, review_due_at: '2026-09-12T12:00:00.000Z' }, reason: 'Retain decision' }, owner, NOW);
  const receipt = await applyKnowledgeChange(getDb(), { preview_id: preview.id, operation_key: `negative-${rule.id}`, fingerprint: preview.fingerprint }, owner, ctx, NOW);
  return receipt.assessment_id!;
}
async function complete(workerId: string, outcome: 'no_supported_change' | 'insufficient_evidence' | 'findings' = 'no_supported_change', now = NOW, sourceTime = NOW, chrome = '', checkedIds?: string[]) {
  const leased = await claimResearchJob(getDb(), workerId, now);
  expect(leased.job).not.toBeNull();
  const content = `Synthetic test source: only ExampleEngine is supported. ${chrome}`;
  const supported = outcome !== 'insufficient_evidence';
  const result = {
    run_id: leased.job!.run_id, lease_token: leased.lease_token, operation_key: `result-${leased.job!.id}`, outcome, summary: supported ? 'Checked synthetic source evidence.' : 'Evidence was unavailable.',
    sources: supported ? [{ citation_id: 's1', url: 'https://example.org/rule', publisher: 'Synthetic publisher', title: 'Synthetic rule', retrieved_at: sourceTime, content, content_hash: createHash('sha256').update(content).digest('hex'), supporting_locations: [{ location: 'Paragraph 1', excerpt: 'only ExampleEngine is supported' }] }] : [],
    claims: supported ? [{ kind: 'fact', statement: 'The synthetic source supports ExampleEngine.', citation_ids: ['s1'] }] : [],
    proposed_changes: outcome === 'findings' ? [{ type: 'profile_facts', facts: [{ key: 'engine', expected: null, value: 'ExampleEngine' }], citation_ids: ['s1'], reason: 'Synthetic cited specification.' }] : [],
    checked_assessment_ids: supported ? checkedIds ?? leased.job!.request.review_assessment_ids : [],
    missing_facts: supported ? [] : ['engine'], uncertainty: [], checked_question: supported,
  };
  const receipt = await submitResearchResult(getDb(), leased.job!.id, workerId, result, now);
  return { leased, receipt, result };
}
async function row(id: string) { return (await getDb().select().from(monitoring_policies).where(eq(monitoring_policies.id, id)))[0]!; }
async function assessment(id: string) { return (await getDb().select().from(vehicle_assessments).where(eq(vehicle_assessments.id, id)))[0]!; }

describe('explicit bounded vehicle monitoring', () => {
  it('starts paused by default, retries creation idempotently, and requires the current revision to enable', async () => {
    const a = await vehicle(), w = await worker();
    const input = { creation_key: 'create-once', name: 'Optional monitor', asset_ids: [a.id], worker_id: w.id, question: 'Review synthetic sources', allowed_domains: ['example.org'] };
    const p = await createMonitoringPolicy(getDb(), input, owner, NOW);
    expect(p.config.enabled).toBe(false);
    expect((await createMonitoringPolicy(getDb(), input, owner, NOW)).id).toBe(p.id);
    await expect(createMonitoringPolicy(getDb(), { ...input, name: 'Changed retry' }, owner, NOW)).rejects.toMatchObject({ code: 'operation_key_conflict' });
    expect(await runMonitoringSweep(getDb(), NOW)).toMatchObject({ started: 0 });
    const enabled = await updateMonitoringPolicy(getDb(), p.id, { expected_revision: 1, enabled: true }, owner, NOW);
    expect(enabled.revision).toBe(2);
    await expect(updateMonitoringPolicy(getDb(), p.id, { expected_revision: 1, enabled: false }, owner, NOW)).rejects.toMatchObject({ code: 'monitoring_conflict' });
    expect(await runMonitoringSweep(getDb(), NOW)).toMatchObject({ started: 1 });
    expect(await runMonitoringSweep(getDb(), NOW)).toMatchObject({ started: 0 });
    expect(await getDb().select().from(monitoring_review_runs)).toHaveLength(1);
  });

  it('fetches shared source evidence once then evaluates vehicles separately without new network requests', async () => {
    const a = await vehicle(), b = await vehicle(), w = await worker();
    const firstNegative = await negative(a.id), secondNegative = await negative(b.id), unrelatedReminder = await negative(a.id, 'user_reminder');
    const p = await policy([a.id, b.id], w.id);
    await runMonitoringSweep(getDb(), NOW);
    expect(await getDb().select().from(research_jobs)).toHaveLength(1);
    const shared = await complete(w.id);
    expect(shared.leased.job!.request).toMatchObject({ task_type: 'source_verification', allow_proposals: false });
    await runMonitoringSweep(getDb(), LATER);
    const jobs = await getDb().select().from(research_jobs);
    expect(jobs).toHaveLength(3);
    for (const job of jobs.filter((entry) => entry.request.task_type === 'responsibility_review')) expect(job.request).toMatchObject({ source_result_id: shared.receipt.result_id, budget: { max_requests: 0 } });
    const first = await complete(w.id, 'no_supported_change', LATER);
    const second = await complete(w.id, 'insufficient_evidence', LATER);
    await runMonitoringSweep(getDb(), LATER);
    const successfulAssessment = first.leased.job!.asset_id === a.id ? firstNegative : secondNegative;
    const failedAssessment = second.leased.job!.asset_id === a.id ? firstNegative : secondNegative;
    expect(Date.parse((await assessment(successfulAssessment)).last_checked_at!)).toBe(Date.parse(LATER));
    expect((await assessment(successfulAssessment)).applicability).toBe('not_applicable');
    expect(Date.parse((await assessment(failedAssessment)).last_checked_at!)).toBe(Date.parse(NOW));
    expect(Date.parse((await assessment(unrelatedReminder)).last_checked_at!)).toBe(Date.parse(NOW));
    expect((await row(p.id)).last_successful_at).toBeNull();
    expect((await monitoringPolicyDetail(getDb(), p.id)).runs[0]!.asset_reviews.map((review) => review.status).sort()).toEqual(['failed', 'succeeded']);
  });

  it('keeps successful no-change checks quiet and does not launch research for an odometer update', async () => {
    const a = await vehicle(), w = await worker();
    const id = await negative(a.id), p = await policy([a.id], w.id);
    await runMonitoringSweep(getDb(), NOW); await complete(w.id);
    await runMonitoringSweep(getDb(), LATER); await complete(w.id, 'no_supported_change', LATER);
    await runMonitoringSweep(getDb(), LATER);
    expect(Date.parse((await row(p.id)).last_successful_at!)).toBe(Date.parse(LATER));
    expect((await assessment(id)).applicability).toBe('not_applicable');
    expect(await getDb().select().from(monitoring_notifications)).toHaveLength(0);
    await getDb().insert(asset_meter_readings).values({ asset_id: a.id, reading: 120000, recorded_on: '2026-09-11', source: 'manual' });
    await readyWorker(w.id, '2026-09-11T14:00:00.000Z');
    expect(await runMonitoringSweep(getDb(), '2026-09-11T14:00:00.000Z')).toMatchObject({ started: 0 });
  });

  it('refreshes only explicitly checked assessments when a review has partial coverage', async () => {
    const a = await vehicle(), w = await worker();
    const checked = await negative(a.id), uncovered = await negative(a.id), p = await policy([a.id], w.id);
    await runMonitoringSweep(getDb(), NOW); await complete(w.id);
    await runMonitoringSweep(getDb(), LATER);
    await complete(w.id, 'no_supported_change', LATER, NOW, '', [checked]);
    await runMonitoringSweep(getDb(), LATER);
    expect(Date.parse((await assessment(checked)).last_checked_at!)).toBe(Date.parse(LATER));
    expect(Date.parse((await assessment(uncovered)).last_checked_at!)).toBe(Date.parse(NOW));
    expect((await row(p.id))).toMatchObject({ last_successful_at: null, last_outcome: 'partial_assessment_coverage' });
    expect(await getDb().select().from(monitoring_notifications)).toHaveLength(0);
  });

  it('refuses to refresh knowledge after the vehicle changes during an otherwise substantive check', async () => {
    const a = await vehicle(), w = await worker(), id = await negative(a.id), p = await policy([a.id], w.id);
    await runMonitoringSweep(getDb(), NOW); await complete(w.id);
    await runMonitoringSweep(getDb(), LATER);
    await updateAsset(getDb(), a.id, { metadata_patch: { set: { fuel_powertrain: { expected: 'petrol', value: 'diesel' } } } }, ctx, owner);
    await complete(w.id, 'no_supported_change', LATER); await runMonitoringSweep(getDb(), LATER);
    expect((await row(p.id))).toMatchObject({ last_successful_at: null, last_outcome: 'vehicle_changed_during_review' });
    expect((await assessment(id))).toMatchObject({ applicability: 'not_applicable', review_state: 'needs_review' });
    expect(Date.parse((await assessment(id)).last_checked_at!)).toBe(Date.parse(NOW));
  });

  it('backs off outages, retains the successful-check timestamp, and coalesces recovery to one current review', async () => {
    const a = await vehicle(), w = await worker(false), p = await policy([a.id], w.id);
    for (const now of [NOW, '2026-09-11T13:00:00.000Z', '2026-09-11T15:00:00.000Z']) await runMonitoringSweep(getDb(), now);
    expect((await row(p.id))).toMatchObject({ failure_count: 3, last_successful_at: null, last_outcome: 'monitoring_unavailable' });
    expect(await getDb().select().from(research_jobs)).toHaveLength(0);
    expect(await getDb().select().from(monitoring_notifications)).toHaveLength(1);
    expect((await listMonitoringPolicies(getDb(), a.id, '2026-09-11T15:00:00.000Z'))[0]).toMatchObject({ monitoring_state: 'monitoring_unavailable' });
    await runMonitoringSweep(getDb(), '2026-09-11T15:01:00.000Z');
    expect((await row(p.id)).failure_count).toBe(3);
    const recovery = '2026-09-11T19:00:00.000Z'; await readyWorker(w.id, recovery);
    await runMonitoringSweep(getDb(), recovery); await runMonitoringSweep(getDb(), recovery);
    expect(await getDb().select().from(monitoring_review_runs)).toHaveLength(1);
    expect(await getDb().select().from(research_jobs)).toHaveLength(1);
  });

  it('cancels active work on explicit pause and skips sold vehicles without removing history', async () => {
    const a = await vehicle(), w = await worker(), p = await policy([a.id], w.id);
    await runMonitoringSweep(getDb(), NOW);
    await updateMonitoringPolicy(getDb(), p.id, { expected_revision: 1, enabled: false }, owner, LATER);
    expect((await getDb().select().from(research_jobs))[0]!.status).toBe('cancelled');
    expect((await getDb().select().from(monitoring_review_runs))[0]!.status).toBe('cancelled');
    await updateAsset(getDb(), a.id, { lifecycle: 'sold' }, ctx, owner);
    await updateMonitoringPolicy(getDb(), p.id, { expected_revision: 2, enabled: true }, owner, LATER);
    expect(await runMonitoringSweep(getDb(), LATER)).toMatchObject({ started: 0 });
    expect((await row(p.id)).last_outcome).toBe('paused_inactive_assets');
    expect(await getDb().select().from(monitoring_review_runs)).toHaveLength(1);
  });

  it('permits bounded retry with a degraded tested configuration and blocks an untested replacement', async () => {
    const a = await vehicle(), w = await worker(), p = await policy([a.id], w.id);
    await recordResearchWorkerHealth(getDb(), w.id, { adapter_version: 'test', capabilities: ['external_fetch'], ready: false, configuration_verified: true, detail: 'Temporary source outage; configuration was previously tested.' }, NOW);
    expect((await listMonitoringPolicies(getDb(), a.id, NOW))[0]!.connection_state).toBe('degraded');
    expect(await runMonitoringSweep(getDb(), NOW)).toMatchObject({ started: 1 });
    await updateMonitoringPolicy(getDb(), p.id, { expected_revision: 1, enabled: false }, owner, LATER);
    await recordResearchWorkerHealth(getDb(), w.id, { adapter_version: 'test', capabilities: ['external_fetch'], ready: false, configuration_verified: false, detail: 'Model credential changed; needs a fresh test.' }, '2026-09-11T13:00:00.000Z');
    await updateMonitoringPolicy(getDb(), p.id, { expected_revision: 2, enabled: true }, owner, '2026-09-11T13:00:00.000Z');
    expect(await runMonitoringSweep(getDb(), '2026-09-11T13:00:00.000Z')).toMatchObject({ started: 0, unavailable: 1 });
    expect((await listMonitoringPolicies(getDb(), a.id, '2026-09-11T13:00:00.000Z'))[0]).toMatchObject({ connection_state: 'configured_not_tested', monitoring_state: 'monitoring_unavailable' });
  });

  it('retains unverified user reports idempotently and exposes only their explicitly shared source to the job', async () => {
    const a = await vehicle(), w = await worker(), p = await policy([a.id], w.id);
    const [source] = await getDb().insert(source_documents).values({ kind: 'text', content_hash: 'monitor-supplied', media_type: 'text/plain', size_bytes: 22, text_content: 'Owner supplied notice.' }).returning();
    const input = { operation_key: 'notice-1', kind: 'user_report', reason: 'Possibly relevant synthetic notice', source_id: source!.id };
    const signal = await signalMonitoringReview(getDb(), p.id, input, owner);
    expect((await signalMonitoringReview(getDb(), p.id, input, owner)).id).toBe(signal.id);
    await runMonitoringSweep(getDb(), NOW);
    const leased = await claimResearchJob(getDb(), w.id, NOW);
    const context = await researchJobContext(getDb(), leased.job!.id, w.id, { run_id: leased.job!.run_id, lease_token: leased.lease_token }, 0, NOW);
    expect(context.owner_supplied_sources).toMatchObject([{ id: source!.id, text: 'Owner supplied notice.' }]);
    expect((await monitoringPolicyDetail(getDb(), p.id)).signals).toHaveLength(1);
    expect((await getDb().select().from(assets).where(eq(assets.id, a.id)))[0]!.metadata.engine).toBeUndefined();
  });

  it('suppresses unchanged rejected proposals when only page chrome changes', async () => {
    const a = await vehicle(), w = await worker(), p = await policy([a.id], w.id);
    await runMonitoringSweep(getDb(), NOW); await complete(w.id);
    await runMonitoringSweep(getDb(), LATER); const first = await complete(w.id, 'findings', LATER);
    await runMonitoringSweep(getDb(), LATER);
    await rejectResearchProposal(getDb(), first.receipt.proposal_id as string, { expected_revision: 1, reason: 'Owner declined this unchanged suggestion.' }, owner);
    const tomorrow = '2026-09-12T12:00:05.000Z'; await readyWorker(w.id, tomorrow);
    await runMonitoringSweep(getDb(), tomorrow); await complete(w.id, 'no_supported_change', tomorrow, tomorrow, 'New navigation footer.');
    await runMonitoringSweep(getDb(), tomorrow); await complete(w.id, 'findings', tomorrow, tomorrow, 'New navigation footer.');
    await runMonitoringSweep(getDb(), tomorrow);
    expect((await getDb().select().from(research_proposals)).map((proposal) => proposal.status).sort()).toEqual(['rejected', 'superseded']);
    expect(await getDb().select().from(monitoring_notifications)).toHaveLength(1);
    expect((await monitoringPolicyDetail(getDb(), p.id)).runs).toHaveLength(2);
  });

  it('rotates bounded batches fairly across enabled policies while sharing equivalent public source work', async () => {
    const a = await vehicle(), w = await worker();
    for (let i = 0; i < 4; i++) await policy([a.id], w.id, { name: `Paused ${i}`, enabled: false });
    for (let i = 0; i < 4; i++) await policy([a.id], w.id, { name: `Enabled ${i}` });
    expect(await runMonitoringSweep(getDb(), NOW, 2)).toMatchObject({ considered: 2, started: 2 });
    expect(await runMonitoringSweep(getDb(), NOW, 2)).toMatchObject({ considered: 2, started: 2 });
    expect(await getDb().select().from(monitoring_review_runs)).toHaveLength(4);
    expect(await getDb().select().from(research_jobs)).toHaveLength(1);
  });

  it('bounds report batches without losing remaining reports or overflowing the generated research question', async () => {
    const a = await vehicle(), w = await worker(), p = await policy([a.id], w.id, { question: 'Q'.repeat(10_000) });
    for (let i = 0; i < 21; i++) await signalMonitoringReview(getDb(), p.id, { operation_key: `report-${i}`, kind: 'user_report', reason: `${i}: ${'R'.repeat(9000)}` }, owner);
    expect(await runMonitoringSweep(getDb(), NOW)).toMatchObject({ started: 1 });
    const detail = await monitoringPolicyDetail(getDb(), p.id);
    expect(detail.signals.filter((signal) => signal.processed_at === null)).toHaveLength(1);
    const [job] = await getDb().select().from(research_jobs);
    expect(job!.request.question).toContain('Q'.repeat(10_000));
    expect(job!.request.question.length).toBeLessThanOrEqual(20_000);
    expect(detail.signals[0]!.reason.length).toBeGreaterThan(9000);
  });
});
