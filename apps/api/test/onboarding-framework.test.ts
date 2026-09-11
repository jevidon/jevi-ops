import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import authPlugin from '../src/plugins/auth.js';
import { onboardingRoutes } from '../src/routes/onboarding.js';
import { registerOnboardingModule, type OnboardingModuleAdapter } from '../src/lib/onboarding.js';
import { signSession } from '../src/lib/jwt.js';
import { getDb } from '../src/lib/db.js';
import { api_tokens, assets, auth_user } from '../src/db/schema.js';
import { hashApiToken } from '../src/routes/auth.js';
import { installation_setup, onboarding_operation_receipts, onboarding_sessions } from '../src/db/onboarding-schema.js';
import type { OnboardingDraft, OnboardingPreview, OnboardingSession } from '@jevi-ops/shared/schemas';

// Deliberately isolated adapters test the framework's real DB transaction boundary.
// This file does not import server.ts or the production module registrations.
let app: FastifyInstance;
let token: string;
const ownerId = 'd395f87b-2838-4570-885b-c3d42058a011';
let failCommit = false;
const adapter: OnboardingModuleAdapter = {
  definition: { id: 'vehicle', title: 'Test vehicle', version: 1, entry_points: ['add_asset', 'asset_detail'],
    steps: [{ id: 'identity', title: 'Identity' }, { id: 'history', title: 'History', optional: true }] },
  draftSchema: z.object({ identity: z.object({ name: z.string().optional() }).strict().optional(), history: z.object({ notes: z.string().optional() }).strict().optional() }),
  validateCompletion(draft) { z.object({ identity: z.object({ name: z.string().min(1) }) }).parse(draft); },
  async preview(draft, context, tx) {
    const [asset] = context.session.subject_id ? await tx.select().from(assets).where(eq(assets.id, context.session.subject_id)).for('update') : [];
    return { changes: [{ kind: 'asset', label: 'Vehicle name', after: draft.identity?.name ?? null }],
      preconditions: { asset: asset ? { id: asset.id, name: asset.name, lifecycle: asset.lifecycle, domain_id: asset.domain_id, metadata: JSON.parse(JSON.stringify(asset.metadata)) } : null } };
  },
  async commit(draft, context, tx) {
    const [asset] = context.session.subject_id
      ? await tx.update(assets).set({ name: String(draft.identity!.name) }).where(eq(assets.id, context.session.subject_id)).returning()
      : await tx.insert(assets).values({ name: String(draft.identity!.name), kind: 'vehicle' }).returning();
    if (failCommit) throw new Error('Injected failure after entity write');
    return { subject_id: asset!.id };
  },
  actions: {
    structure: {
      async preview() { return { changes: [{ kind: 'test', label: 'Immediate saved structure', after: true }], preconditions: {} }; },
      async commit() { return { applied: true }; },
    },
  },
};
beforeAll(async () => {
  registerOnboardingModule(adapter);
  registerOnboardingModule({ ...adapter, definition: { ...adapter.definition, id: 'core', entry_points: ['first_run', 'settings'] } });
  await getDb().insert(auth_user).values({ id: ownerId, email: 'onboarding-framework@test.local', password_hash: 'test-only' }).onConflictDoNothing();
  token = await signSession({ id: ownerId, email: 'onboarding-framework@test.local' });
  app = Fastify();
  await app.register(authPlugin);
  await app.register(onboardingRoutes);
  await app.ready();
});
beforeEach(async () => {
  failCommit = false;
  adapter.definition.version = 1;
  delete adapter.migrateDraft;
  await getDb().insert(installation_setup).values({ id: true, state: 'eligible' }).onConflictDoUpdate({ target: installation_setup.id, set: { state: 'eligible', core_session_id: null } });
});
afterAll(async () => { await app.close(); });
function request(method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown, auth = token) {
  return app.inject({ method, url: `/api/onboarding${path}`, headers: { authorization: `Bearer ${auth}` }, ...(body ? { payload: body } : {}) });
}
async function start(over: Record<string, unknown> = {}): Promise<OnboardingSession> {
  const response = await request('POST', '/sessions', { module_id: 'vehicle', entry_point: 'add_asset', creation_key: crypto.randomUUID(), draft: { identity: { name: 'Prado' } }, ...over });
  expect(response.statusCode, response.body).toBe(200);
  return response.json();
}
async function preview(session: OnboardingSession): Promise<OnboardingPreview> {
  const response = await request('POST', `/sessions/${session.id}/preview`, { expected_revision: session.revision });
  expect(response.statusCode, response.body).toBe(200);
  return response.json();
}
const completion = (view: OnboardingPreview, key = crypto.randomUUID()) => ({ expected_revision: view.revision, preview_fingerprint: view.fingerprint, operation_key: key });

describe('onboarding framework persistence', () => {
  it('serialises concurrent creation retries and refuses changed creation payloads', async () => {
    const body = { module_id: 'vehicle', entry_point: 'add_asset', creation_key: 'creation-retry-key', draft: { identity: { name: 'Prado' } } };
    const results = await Promise.all([request('POST', '/sessions', body), request('POST', '/sessions', body)]);
    expect(results.map((r) => r.statusCode)).toEqual([200, 200]);
    expect(results[0]!.json().id).toBe(results[1]!.json().id);
    expect((await request('POST', '/sessions', { ...body, draft: { identity: { name: 'Other' } } })).json().error).toBe('creation_key_conflict');
    // Similar identity with an intentionally new key is an independently usable draft.
    expect((await start()).id).not.toBe(results[0]!.json().id);
  });

  it('persists drafts across reads and rejects a second tab without losing its original saved answers', async () => {
    const session = await start();
    const path = `/sessions/${session.id}/steps/identity`;
    expect((await request('PATCH', path, { expected_revision: 0, values: { name: 'Saved Prado' }, state: 'confirmed' })).json().revision).toBe(1);
    const conflict = await request('PATCH', path, { expected_revision: 0, values: { name: 'Stale name' } });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().session.draft.identity.name).toBe('Saved Prado');
    expect((await request('GET', `/sessions/${session.id}`)).json().session.draft.identity.name).toBe('Saved Prado');
  });

  it('defer/resume/abandon require revisions and preserve answers and existing assets', async () => {
    const session = await start();
    const deferred = await request('POST', `/sessions/${session.id}/defer`, { expected_revision: 0 });
    expect(deferred.json()).toMatchObject({ revision: 1, status: 'deferred', draft: session.draft });
    expect((await request('POST', `/sessions/${session.id}/resume`, { expected_revision: 0 })).statusCode).toBe(409);
    const resumed = await request('POST', `/sessions/${session.id}/resume`, { expected_revision: 1 });
    expect(resumed.json()).toMatchObject({ revision: 2, status: 'in_progress', draft: session.draft });
    expect((await request('POST', `/sessions/${session.id}/abandon`, { expected_revision: 2 })).json().status).toBe('abandoned');
    expect((await request('POST', `/sessions/${session.id}/resume`, { expected_revision: 3 })).json().error).toBe('session_finished');
  });

  it('enforces one active/deferred enrichment session while permitting a replacement after abandonment', async () => {
    const [asset] = await getDb().insert(assets).values({ name: 'Existing Prado', kind: 'vehicle' }).returning();
    const session = await start({ subject_id: asset!.id });
    await request('POST', `/sessions/${session.id}/defer`, { expected_revision: 0 });
    const next = await request('POST', '/sessions', { module_id: 'vehicle', entry_point: 'asset_detail', creation_key: 'another-session-key', subject_id: asset!.id });
    expect(next.statusCode).toBe(409);
    expect(next.json()).toMatchObject({ error: 'active_session_conflict', session: { id: session.id } });
    await request('POST', `/sessions/${session.id}/abandon`, { expected_revision: 1 });
    expect((await start({ subject_id: asset!.id })).id).not.toBe(session.id);
    expect((await getDb().select().from(assets)).map((a) => a.name)).toEqual(['Existing Prado']);
  });

  it('commits the asset and durable receipt once under double submission, and checks all retry payload fields', async () => {
    const session = await start();
    const body = completion(await preview(session));
    const results = await Promise.all([request('POST', `/sessions/${session.id}/complete`, body), request('POST', `/sessions/${session.id}/complete`, body)]);
    expect(results.map((r) => r.statusCode)).toEqual([200, 200]);
    expect(results[0]!.json().receipt).toEqual(results[1]!.json().receipt);
    expect(await getDb().select().from(assets)).toHaveLength(1);
    for (const changed of [{ operation_key: crypto.randomUUID() }, { expected_revision: 99 }, { preview_fingerprint: 'f'.repeat(64) }]) {
      expect((await request('POST', `/sessions/${session.id}/complete`, { ...body, ...changed })).json().error).toBe('operation_key_conflict');
    }
    expect(await getDb().select().from(assets)).toHaveLength(1);
  });

  it('rolls back entity writes and receipt on failure, then permits a clean retry', async () => {
    const session = await start();
    const body = completion(await preview(session));
    failCommit = true;
    expect((await request('POST', `/sessions/${session.id}/complete`, body)).statusCode).toBe(500);
    expect(await getDb().select().from(assets)).toHaveLength(0);
    const [saved] = await getDb().select().from(onboarding_sessions);
    expect(saved).toMatchObject({ status: 'in_progress', commit_receipt: null, revision: 0 });
    failCommit = false;
    expect((await request('POST', `/sessions/${session.id}/complete`, body)).statusCode).toBe(200);
    expect(await getDb().select().from(assets)).toHaveLength(1);
  });

  it('requires a new review when affected lifecycle or metadata changes', async () => {
    const [asset] = await getDb().insert(assets).values({ name: 'Existing', kind: 'vehicle' }).returning();
    const session = await start({ subject_id: asset!.id });
    const body = completion(await preview(session));
    await getDb().update(assets).set({ lifecycle: 'sold' }).where(eq(assets.id, asset!.id));
    expect((await request('POST', `/sessions/${session.id}/complete`, body)).json().error).toBe('preview_stale');
    const [saved] = await getDb().select().from(assets);
    expect(saved!.name).toBe('Existing');
  });

  it('invalidates preview after draft saves and refuses secrets without echoing them', async () => {
    const session = await start();
    const body = completion(await preview(session));
    const secret = 'sk-abcdefghijklmnopqrstuvwxyz012345';
    const rejected = await request('PATCH', `/sessions/${session.id}/steps/identity`, { expected_revision: 0, values: { name: secret } });
    expect(rejected.statusCode).toBe(400);
    expect(rejected.body).not.toContain(secret);
    await request('PATCH', `/sessions/${session.id}/steps/identity`, { expected_revision: 0, values: { name: 'Changed' } });
    expect((await request('POST', `/sessions/${session.id}/complete`, body)).json().error).toBe('revision_conflict');
    expect((await request('GET', `/sessions/${session.id}`)).json().session.preview).toBeNull();
  });

  it('refuses API tokens, invalid authentication, nonexistent owners and another owner’s session', async () => {
    expect((await request('GET', '/modules', undefined, 'invalid')).statusCode).toBe(401);
    const apiToken = 'ops_onboarding-test-token-0123456789';
    await getDb().insert(api_tokens).values({ name: 'framework-test', kind: 'agent', token_hash: hashApiToken(apiToken) });
    expect((await request('GET', '/modules', undefined, apiToken)).statusCode).toBe(403);
    const nonexistent = await signSession({ id: 'be73c8a6-d2d5-4b50-9f5c-48ff441ae93d', email: 'missing@test.local' });
    expect((await request('GET', '/modules', undefined, nonexistent)).statusCode).toBe(403);
    const session = await start();
    const [other] = await getDb().insert(auth_user).values({ email: `other-${crypto.randomUUID()}@test.local`, password_hash: 'test-only' }).returning();
    const otherToken = await signSession({ id: other!.id, email: other!.email });
    expect((await request('GET', `/sessions/${session.id}`, undefined, otherToken)).statusCode).toBe(404);
  });

  it('keeps child sessions independent of core completion and immediate action receipts', async () => {
    const core = await start({ module_id: 'core', entry_point: 'first_run' });
    const child = await start({ parent_session_id: core.id });
    await request('POST', `/sessions/${child.id}/defer`, { expected_revision: 0 });
    const view = (await request('POST', `/sessions/${core.id}/actions/structure/preview`, { expected_revision: 0 })).json();
    const body = completion(view);
    const first = await request('POST', `/sessions/${core.id}/actions/structure/apply`, body);
    expect(first.statusCode, first.body).toBe(200);
    const repeated = await request('POST', `/sessions/${core.id}/actions/structure/apply`, body);
    expect(repeated.json().receipt).toEqual(first.json().receipt);
    expect(await getDb().select().from(onboarding_operation_receipts)).toHaveLength(1);
    const coreSaved = first.json().session as OnboardingSession;
    const result = await request('POST', `/sessions/${core.id}/complete`, completion(await preview(coreSaved)));
    expect(result.statusCode, result.body).toBe(200);
    expect((await request('GET', `/sessions/${child.id}`)).json().session.status).toBe('deferred');
    expect((await request('GET', '/installation')).json().state).toBe('completed');
  });

  it('requires explicit version migration on resume and preserves earlier answers', async () => {
    const session = await start();
    await request('POST', `/sessions/${session.id}/defer`, { expected_revision: 0 });
    adapter.definition.version = 2;
    expect((await request('POST', `/sessions/${session.id}/resume`, { expected_revision: 1 })).json().error).toBe('module_version_changed');
    adapter.migrateDraft = (draft: OnboardingDraft) => ({ ...draft, history: { notes: 'Unasked' } });
    const result = await request('POST', `/sessions/${session.id}/resume`, { expected_revision: 1 });
    expect(result.statusCode, result.body).toBe(200);
    expect(result.json()).toMatchObject({ module_version: 2, draft: { identity: { name: 'Prado' }, history: { notes: 'Unasked' } } });
  });
});
