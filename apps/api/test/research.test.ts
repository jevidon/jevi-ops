import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { RESEARCH_WORKER_SCOPES } from '@jevi-ops/shared';
import { buildServer } from '../src/server.js';
import { signSession } from '../src/lib/jwt.js';
import { hashApiToken } from '../src/routes/auth.js';
import { getDb } from '../src/lib/db.js';
import { api_tokens, assets, maintenance_items } from '../src/db/schema.js';
import { research_jobs, research_results, research_proposals, research_result_sources } from '../src/db/research-schema.js';
import { createAsset, updateAsset } from '../src/lib/asset-commands.js';
import {
  approveResearchProposal, cancelResearchJob, claimResearchJob, createResearchWorker, expireResearchLeases, failResearchJob, heartbeatResearchJob,
  previewResearchProposal, requestResearch, researchJobContext, researchJobStatus, submitResearchResult,
} from '../src/lib/research.js';

let app: FastifyInstance, session: string;
const NOW = '2026-09-11T12:00:00.000Z';
const ctx = { today: '2026-09-11', staleDays: 30 };
const owner = 'session:research-owner';
const TOKEN = 'ops_scoped_research_test_0123456789';
beforeAll(async () => { app = await buildServer(); await app.ready(); session = await signSession({ id: '00000000-0000-0000-0000-000000000001', email: 'research@test.local' }); });
afterAll(async () => { await app.close(); });
async function worker(scopes: string[] = [...RESEARCH_WORKER_SCOPES]) {
  const w = await createResearchWorker(getDb(), { name: 'Test Hermes', adapter: 'hermes', adapter_version: 'test-pinned', capabilities: ['external_fetch'], allowed_task_types: ['vehicle_question', 'responsibility_review', 'source_verification'] });
  const [token] = await getDb().insert(api_tokens).values({ name: 'Research worker', token_hash: hashApiToken(TOKEN), permission_profile: 'research_worker', worker_id: w.id, scopes }).returning();
  return { ...w, token_id: token!.id };
}
async function vehicle() { return createAsset(getDb(), { name: 'Private nickname', kind: 'vehicle', meter_unit: 'km', doc_md: '# Secret owner narrative', metadata: { year: 2015, make: 'Toyota', model: 'Prado', plate: 'SECRETPLATE', vin: 'SECRETVIN', registration_country: 'NZ', owner_private_key: 'do-not-disclose' } }); }
async function start() {
  const w = await worker(), asset = await vehicle();
  const job = await requestResearch(getDb(), { operation_key: `request-${asset.id}`, asset_id: asset.id, worker_id: w.id, question: 'Verify a synthetic engine variant using the allowed source.', allowed_domains: ['example.org'] }, owner, 'owner', NOW);
  const leased = await claimResearchJob(getDb(), w.id, NOW);
  return { w, asset, job, leased };
}
function resultFor(leased: Awaited<ReturnType<typeof claimResearchJob>>, changes?: unknown[]) {
  const content = 'Synthetic source: the engine variant is ExampleEngine. This is deterministic test data.';
  return { run_id: leased.job!.run_id!, lease_token: leased.lease_token!, operation_key: 'result-1', outcome: 'findings', summary: 'A cited synthetic engine variant.',
    sources: [{ citation_id: 'source-1', url: 'https://example.org/vehicle', publisher: 'Synthetic publisher', title: 'Synthetic specification', retrieved_at: NOW, content, content_hash: createHash('sha256').update(content).digest('hex'), supporting_locations: [{ location: 'Paragraph 1', excerpt: 'the engine variant is ExampleEngine' }] }],
    claims: [{ kind: 'fact', statement: 'The synthetic engine variant is ExampleEngine.', citation_ids: ['source-1'] }],
    proposed_changes: changes ?? [{ type: 'profile_facts', facts: [{ key: 'engine', expected: null, value: 'ExampleEngine' }], citation_ids: ['source-1'], reason: 'The retained specification supports this value.' }],
    missing_facts: [], uncertainty: [], checked_question: true };
}
function req(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, body?: unknown, token = TOKEN) { return app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, ...(body === undefined ? {} : { payload: body }) }); }

describe('dedicated research-worker credential boundaries', () => {
  it('denies existing read/write, setup, upload, settings, token and approval routes centrally', async () => {
    const { asset } = await start();
    for (const [method, path, body] of [
      ['GET', `/api/assets/${asset.id}`, undefined], ['PATCH', `/api/assets/${asset.id}`, { name: 'Forbidden' }],
      ['POST', '/api/assets', { name: 'Forbidden' }], ['GET', '/api/settings/app', undefined],
      ['POST', '/api/maintenance', { name: 'Forbidden', policy: 'expiry' }], ['POST', '/api/projects', { name: 'Forbidden' }],
      ['POST', '/api/auth/tokens', { name: 'Escalation' }], ['GET', '/api/auth/tokens', undefined],
      ['POST', '/api/research/jobs', {}], ['POST', '/api/knowledge/accept', {}],
      ['POST', '/api/research/proposals/00000000-0000-0000-0000-000000000001/approve', {}],
    ] as const) {
      const response = await req(method, path, body);
      expect(response.statusCode, `${method} ${path}: ${response.body}`).toBe(403);
      expect(response.json().error).toBe('worker_scope_denied');
    }
    expect((await getDb().select().from(assets).where(eq(assets.id, asset.id)))[0]?.name).toBe('Private nickname');
  });

  it('keeps legacy token permissions separate and honors restricted scopes and revocation', async () => {
    const w = await worker(['research:status']);
    expect((await req('POST', '/api/research/claim', {})).statusCode).toBe(403);
    const legacy = 'ops_legacy_integration_0123456789';
    await getDb().insert(api_tokens).values({ name: 'Legacy integration', token_hash: hashApiToken(legacy) });
    expect((await req('GET', '/api/assets', undefined, legacy)).statusCode).toBe(200);
    expect((await req('POST', '/api/research/claim', {}, legacy)).statusCode).toBe(403);
    await getDb().update(api_tokens).set({ revoked_at: NOW }).where(eq(api_tokens.id, w.token_id));
    expect((await req('GET', '/api/research/jobs/00000000-0000-0000-0000-000000000001/status')).statusCode).toBe(401);
  });

  it('only the owner can mint a worker token and each token is explicitly bound', async () => {
    const w = await worker();
    const response = await req('POST', '/api/auth/tokens', { name: 'New dedicated worker', permission_profile: 'research_worker', worker_id: w.id }, session);
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ permission_profile: 'research_worker', worker_id: w.id, scopes: [...RESEARCH_WORKER_SCOPES] });
    expect(response.json().token.startsWith('ops_')).toBe(true);
    expect((await req('POST', '/api/auth/tokens', { name: 'Unbound', permission_profile: 'research_worker' }, session)).statusCode).toBe(400);
  });
});

describe('leased research and evidence results', () => {
  it('returns only request-scoped context and excludes identifiers, prose and unrelated assets', async () => {
    const { w, asset, job, leased } = await start();
    const unrelated = await createAsset(getDb(), { name: 'Other household secret', kind: 'vehicle' });
    const context = await researchJobContext(getDb(), job.id, w.id, { run_id: leased.job!.run_id, lease_token: leased.lease_token }, 0, NOW);
    const raw = JSON.stringify(context);
    for (const secret of ['SECRETPLATE', 'SECRETVIN', 'Secret owner narrative', 'do-not-disclose', unrelated.id, 'Other household secret', 'Private nickname']) expect(raw).not.toContain(secret);
    expect(context.asset_id).toBe(asset.id);
    expect((context.permissions as Record<string, unknown>).external_sharing_authorized).toBe(true);
    await expect(researchJobContext(getDb(), job.id, '00000000-0000-0000-0000-000000000099', { run_id: leased.job!.run_id, lease_token: leased.lease_token }, 0, NOW)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('reclaims expired leases without accepting old callbacks and stops after the retry limit', async () => {
    const { w, job, leased } = await start();
    const again = await claimResearchJob(getDb(), w.id, '2026-09-11T12:01:01.000Z');
    expect(again.job!.id).toBe(job.id); expect(again.job!.run_id).not.toBe(leased.job!.run_id);
    await expect(submitResearchResult(getDb(), job.id, w.id, resultFor(leased), '2026-09-11T12:01:02.000Z')).rejects.toMatchObject({ code: 'lease_conflict' });
    await claimResearchJob(getDb(), w.id, '2026-09-11T12:02:02.000Z');
    expect((await claimResearchJob(getDb(), w.id, '2026-09-11T12:03:03.000Z')).job).toBeNull();
    expect((await researchJobStatus(getDb(), job.id, w.id)).status).toBe('failed');
  });

  it('caps heartbeat renewal by the request runtime and backs off retryable failures', async () => {
    const { w, job, leased } = await start();
    const lease = { run_id: leased.job!.run_id, lease_token: leased.lease_token };
    const beat = await heartbeatResearchJob(getDb(), job.id, w.id, lease, '2026-09-11T12:00:30.000Z');
    expect(beat.lease_expires_at).toBe('2026-09-11T12:01:30.000Z');
    const failed = await failResearchJob(getDb(), job.id, w.id, { ...lease, reason: 'Source timed out', retryable: true }, '2026-09-11T12:00:40.000Z');
    expect(failed.status).toBe('requested');
    expect((await claimResearchJob(getDb(), w.id, '2026-09-11T12:00:50.000Z')).job).toBeNull();
    expect((await claimResearchJob(getDb(), w.id, '2026-09-11T12:00:55.000Z')).job!.attempts).toBe(2);
  });

  it('records expired-run retries without waiting for a worker to reconnect', async () => {
    const { w, job, leased } = await start();
    expect(await expireResearchLeases(getDb(), '2026-09-11T12:01:01.000Z')).toEqual({ retried: 1, failed: 0 });
    expect(await expireResearchLeases(getDb(), '2026-09-11T12:01:01.000Z')).toEqual({ retried: 0, failed: 0 });
    expect((await researchJobStatus(getDb(), job.id, w.id)).status).toBe('requested');
    expect((await claimResearchJob(getDb(), w.id, '2026-09-11T12:01:02.000Z')).job).toBeNull();
    await expect(submitResearchResult(getDb(), job.id, w.id, resultFor(leased), '2026-09-11T12:01:02.000Z')).rejects.toMatchObject({ code: 'lease_expired' });
    expect((await claimResearchJob(getDb(), w.id, '2026-09-11T12:01:16.000Z')).job!.attempts).toBe(2);
  });

  it('accepts equivalent offset instants for live leases and source retrieval times', async () => {
    const { w, job, leased } = await start();
    const equivalent = '2026-09-12T00:00:00+12:00';
    const result = resultFor(leased);
    result.sources[0]!.retrieved_at = equivalent;
    expect(await submitResearchResult(getDb(), job.id, w.id, result, equivalent)).toMatchObject({ substantive_check: true });
  });

  it('rejects fabricated citations, out-of-scope URLs, changed hashes and unsupported excerpts', async () => {
    const { w, job, leased } = await start();
    const result = resultFor(leased);
    await expect(submitResearchResult(getDb(), job.id, w.id, { ...result, claims: [{ kind: 'fact', statement: 'Unsupported', citation_ids: ['imaginary'] }] }, NOW)).rejects.toThrow();
    await expect(submitResearchResult(getDb(), job.id, w.id, { ...result, sources: [{ ...result.sources[0], url: 'https://attacker.example/steal' }] }, NOW)).rejects.toMatchObject({ code: 'source_scope_denied' });
    await expect(submitResearchResult(getDb(), job.id, w.id, { ...result, sources: [{ ...result.sources[0], content_hash: '0'.repeat(64) }] }, NOW)).rejects.toMatchObject({ code: 'source_hash_mismatch' });
    await expect(submitResearchResult(getDb(), job.id, w.id, { ...result, sources: [{ ...result.sources[0], supporting_locations: [{ location: '1', excerpt: 'not actually fetched' }] }] }, NOW)).rejects.toMatchObject({ code: 'unsupported_excerpt' });
    expect(await getDb().select().from(research_results)).toHaveLength(0);
  });

  it('records one inert proposal/result, preserves fetched evidence and returns the original retry receipt', async () => {
    const { w, asset, job, leased } = await start();
    const result = resultFor(leased);
    const receipt = await submitResearchResult(getDb(), job.id, w.id, result, NOW);
    expect(receipt).toMatchObject({ canonical_state_changed: false, substantive_check: true });
    expect(await submitResearchResult(getDb(), job.id, w.id, result, '2026-09-11T12:09:00.000Z')).toEqual(receipt);
    await expect(submitResearchResult(getDb(), job.id, w.id, { ...result, summary: 'Different retry' }, NOW)).rejects.toMatchObject({ code: 'result_conflict' });
    expect(await getDb().select().from(research_results)).toHaveLength(1);
    expect(await getDb().select().from(research_proposals)).toHaveLength(1);
    expect(await getDb().select().from(research_result_sources)).toHaveLength(1);
    expect((await getDb().select().from(assets).where(eq(assets.id, asset.id)))[0]?.metadata.engine).toBeUndefined();
  });

  it('does not refresh substantive-check health on insufficient evidence or cancelled jobs', async () => {
    const { w, job, leased } = await start();
    const receipt = await submitResearchResult(getDb(), job.id, w.id, { ...resultFor(leased), outcome: 'insufficient_evidence', sources: [], claims: [], proposed_changes: [], checked_question: false }, NOW);
    expect(receipt.substantive_check).toBe(false);
    expect((await getDb().select().from(research_jobs).where(eq(research_jobs.id, job.id)))[0]?.last_checked_at).toBeNull();
    const another = await requestResearch(getDb(), { operation_key: 'cancelled', asset_id: job.asset_id, question: 'Other check', allowed_domains: ['example.org'] }, owner, 'owner', NOW);
    await cancelResearchJob(getDb(), another.id, owner);
    expect((await claimResearchJob(getDb(), w.id, NOW)).job).toBeNull();
  });
});

describe('owner approval uses reviewed canonical services', () => {
  it('shows a concrete diff and applies sourced facts once with an audit receipt', async () => {
    const { w, asset, job, leased } = await start();
    const resultReceipt = await submitResearchResult(getDb(), job.id, w.id, resultFor(leased), NOW);
    const proposal = await previewResearchProposal(getDb(), resultReceipt.proposal_id as string, owner, ctx);
    expect(JSON.stringify(proposal.preview)).toContain('ExampleEngine');
    expect((await getDb().select().from(assets).where(eq(assets.id, asset.id)))[0]?.metadata.engine).toBeUndefined();
    const input = { expected_revision: proposal.revision, operation_key: 'approval-1', fingerprint: proposal.fingerprint };
    const receipt = await approveResearchProposal(getDb(), proposal.id, input, owner, ctx);
    expect(await approveResearchProposal(getDb(), proposal.id, input, owner, ctx)).toEqual(receipt);
    expect((await getDb().select().from(assets).where(eq(assets.id, asset.id)))[0]?.metadata.engine).toMatchObject({ value: 'ExampleEngine', source_kind: 'research', run_id: leased.job!.run_id });
    expect((await getDb().select().from(assets).where(eq(assets.id, asset.id)))[0]?.metadata.plate).toBe('SECRETPLATE');
  });

  it('refuses a stale document or jurisdiction even after owner preview', async () => {
    const { w, asset, job, leased } = await start();
    const resultReceipt = await submitResearchResult(getDb(), job.id, w.id, resultFor(leased), NOW);
    const proposal = await previewResearchProposal(getDb(), resultReceipt.proposal_id as string, owner, ctx);
    await updateAsset(getDb(), asset.id, { metadata_patch: { set: { registration_country: { expected: 'NZ', value: 'US' } } } }, ctx, owner);
    await expect(approveResearchProposal(getDb(), proposal.id, { expected_revision: proposal.revision, operation_key: 'stale-approval', fingerprint: proposal.fingerprint }, owner, ctx)).rejects.toMatchObject({ code: 'proposal_stale' });
    expect((await getDb().select().from(assets).where(eq(assets.id, asset.id)))[0]?.metadata.engine).toBeUndefined();
  });

  it('binds the reviewed scheduling date and stale-reading settings before applying changes', async () => {
    const { w, asset, job, leased } = await start();
    const resultReceipt = await submitResearchResult(getDb(), job.id, w.id, resultFor(leased), NOW);
    const preview = await previewResearchProposal(getDb(), resultReceipt.proposal_id as string, owner, ctx);
    const input = { expected_revision: preview.revision, operation_key: 'changed-context', fingerprint: preview.fingerprint };
    await expect(approveResearchProposal(getDb(), preview.id, input, owner, { ...ctx, today: '2026-09-12' })).rejects.toMatchObject({ code: 'proposal_context_changed' });
    await expect(approveResearchProposal(getDb(), preview.id, input, owner, { ...ctx, staleDays: 14 })).rejects.toMatchObject({ code: 'proposal_context_changed' });
    expect((await getDb().select().from(assets).where(eq(assets.id, asset.id)))[0]?.metadata.engine).toBeUndefined();
  });

  it('applies a supported new manual responsibility through knowledge and maintenance services', async () => {
    const { w, asset, job, leased } = await start();
    const result = resultFor(leased, [{ type: 'knowledge', new_rule: { title: 'Manual review reminder', kind: 'user_reminder', reason: 'Owner-requested tracking' }, assessment: { applicability: 'unknown', rationale: 'Support remains incomplete; optional reminder only.' }, tracking: { action: 'create', item: { name: 'Review this issue', policy: 'on_condition', next_due_date: '2027-01-01' } }, citation_ids: ['source-1'], reason: 'Review the retained information later.' }]);
    const receipt = await submitResearchResult(getDb(), job.id, w.id, result, NOW);
    const preview = await previewResearchProposal(getDb(), receipt.proposal_id as string, owner, ctx);
    expect(await getDb().select().from(maintenance_items).where(eq(maintenance_items.asset_id, asset.id))).toHaveLength(0);
    await approveResearchProposal(getDb(), preview.id, { expected_revision: preview.revision, operation_key: 'approve-knowledge', fingerprint: preview.fingerprint }, owner, ctx);
    expect(await getDb().select().from(maintenance_items).where(eq(maintenance_items.asset_id, asset.id))).toHaveLength(1);
  });
});
