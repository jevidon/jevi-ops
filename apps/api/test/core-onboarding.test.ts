import Fastify, { type FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import authPlugin from '../src/plugins/auth.js';
import { onboardingRoutes } from '../src/routes/onboarding.js';
import { coreOnboardingModule, getCoreReadiness } from '../src/lib/core-onboarding.js';
import { vehicleOnboardingModule } from '../src/lib/vehicle-onboarding.js';
import { registerOnboardingModule } from '../src/lib/onboarding.js';
import { signSession } from '../src/lib/jwt.js';
import { getDb } from '../src/lib/db.js';
import { app_settings, assets, auth_user, projects, stewardship_domains } from '../src/db/schema.js';
import { installation_setup } from '../src/db/onboarding-schema.js';
import { invalidateAppSettings } from '../src/lib/app-settings.js';
import type { CoreStructure, OnboardingPreview, OnboardingSession } from '@jevi-ops/shared/schemas';

let app: FastifyInstance;
let token: string;
const ownerId = '0f7f6bb7-bc36-4bac-bca5-4a30d77ab9db';
let existingDomainIds = new Set<string>();
beforeAll(async () => {
  registerOnboardingModule(coreOnboardingModule);
  registerOnboardingModule(vehicleOnboardingModule);
  await getDb().insert(auth_user).values({ id: ownerId, email: 'core-setup@test.local', password_hash: 'test-only' }).onConflictDoNothing();
  token = await signSession({ id: ownerId, email: 'core-setup@test.local' });
  app = Fastify(); await app.register(authPlugin); await app.register(onboardingRoutes); await app.ready();
});
beforeEach(async () => {
  existingDomainIds = new Set((await getDb().select({ id: stewardship_domains.id }).from(stewardship_domains)).map((row) => row.id));
  await getDb().update(app_settings).set({ timezone: 'Pacific/Auckland', currency: 'NZD', revision: 1 }).where(eq(app_settings.id, true));
  await getDb().insert(installation_setup).values({ id: true, state: 'eligible' }).onConflictDoUpdate({ target: installation_setup.id, set: { state: 'eligible', core_session_id: null } });
  invalidateAppSettings();
});
afterEach(async () => {
  const createdIds = (await getDb().select({ id: stewardship_domains.id }).from(stewardship_domains)).filter((row) => !existingDomainIds.has(row.id)).map((row) => row.id);
  if (createdIds.length) await getDb().delete(stewardship_domains).where(inArray(stewardship_domains.id, createdIds));
});
afterAll(async () => { await app.close(); });
function request(method: 'GET' | 'POST' | 'PATCH', path: string, payload?: unknown) {
  return app.inject({ method, url: `/api/onboarding${path}`, headers: { authorization: `Bearer ${token}` }, ...(payload ? { payload } : {}) });
}
async function start(structure: CoreStructure = { domains: [], areas: [] }) {
  const result = await request('POST', '/sessions', { module_id: 'core', entry_point: 'first_run', creation_key: randomUUID(), draft: {
    welcome: { timezone: 'Pacific/Auckland', currency: 'NZD', settings_confirmed: true }, ai: { mode: 'manual' }, structure,
  } });
  expect(result.statusCode, result.body).toBe(200);
  return result.json() as OnboardingSession;
}
async function preview(session: OnboardingSession, action?: string) {
  const result = await request('POST', `/sessions/${session.id}${action ? `/actions/${action}/preview` : '/preview'}`, { expected_revision: session.revision });
  expect(result.statusCode, result.body).toBe(200);
  return result.json() as OnboardingPreview;
}
async function complete(session: OnboardingSession, view: OnboardingPreview, action?: string) {
  const result = await request('POST', `/sessions/${session.id}${action ? `/actions/${action}/apply` : '/complete'}`, { expected_revision: view.revision, preview_fingerprint: view.fingerprint, operation_key: randomUUID() });
  expect(result.statusCode, result.body).toBe(200);
  return result.json() as { session: OnboardingSession; receipt: { result: Record<string, unknown> } };
}

describe('core setup with real shared commands', () => {
  it('completes in explicit manual mode without a model, seeds or vehicle', async () => {
    const before = await getDb().select().from(stewardship_domains);
    const session = await start();
    const result = await complete(session, await preview(session));
    expect(result.session.status).toBe('completed');
    expect(result.receipt.result).toMatchObject({ ready: true, mode: 'manual' });
    expect(await getDb().select().from(stewardship_domains)).toHaveLength(before.length);
    expect((await request('GET', '/installation')).json().state).toBe('completed');
  });

  it('requires an explicit timezone/currency confirmation and AI-or-manual choice', async () => {
    const session = await start();
    const cleared = await request('PATCH', `/sessions/${session.id}/steps/welcome`, { expected_revision: 0, values: { timezone: 'Pacific/Auckland', currency: 'NZD', settings_confirmed: false } });
    expect(cleared.statusCode).toBe(200);
    expect((await request('POST', `/sessions/${session.id}/preview`, { expected_revision: 1 })).json().error).toBe('confirm_timezone_and_currency');
    expect((await request('PATCH', `/sessions/${session.id}/steps/ai`, { expected_revision: 1, values: {}, state: 'confirmed' })).json().error).toBe('choose_ai_or_manual_mode');
  });

  it('completes after skipping unfinished optional structure while retaining answers and earlier immediate saves', async () => {
    const name = `P3 saved before skip ${randomUUID()}`;
    const session = await start({ domains: [{ key: 'saved', name, selected: true }], areas: [] });
    const applied = await complete(session, await preview(session, 'structure'), 'structure');
    const skippedDraft = { domains: [{ key: 'saved', name, selected: true }, { key: 'unfinished', name: '', selected: true }], areas: [{ key: 'unfinished-area', name: '', selected: true }] };
    const response = await request('PATCH', `/sessions/${session.id}/steps/structure`, { expected_revision: applied.session.revision, values: skippedDraft, state: 'skipped', current_step_id: 'vehicle' });
    expect(response.statusCode, response.body).toBe(200);
    const skipped = response.json() as OnboardingSession;
    const before = await getDb().select().from(stewardship_domains);
    const result = await complete(skipped, await preview(skipped));
    expect(result.session.status).toBe('completed');
    expect(result.session.draft.structure).toEqual(skippedDraft);
    expect(result.session.step_states.structure).toBe('skipped');
    expect(await getDb().select().from(stewardship_domains)).toHaveLength(before.length);
    expect(await getDb().select().from(stewardship_domains).where(eq(stewardship_domains.name, name))).toHaveLength(1);
  });

  it('applies chosen domains and general areas once with stable IDs, then core completion adds nothing', async () => {
    const name = `P3 domain ${randomUUID()}`;
    const areaName = `P3 area ${randomUUID()}`;
    const session = await start({ domains: [{ key: 'home', name, selected: true }], areas: [{ key: 'area', name: areaName, domain_key: 'home', selected: true }] });
    expect((await request('POST', `/sessions/${session.id}/preview`, { expected_revision: 0 })).json().error).toBe('apply_structure_before_completion');
    const applied = await complete(session, await preview(session, 'structure'), 'structure');
    const [domain] = await getDb().select().from(stewardship_domains).where(eq(stewardship_domains.name, name));
    const [area] = await getDb().select().from(projects).where(eq(projects.name, areaName));
    expect(area).toMatchObject({ kind: 'area', domain_id: domain!.id, asset_id: null });
    const repeatedView = await preview(applied.session, 'structure');
    expect(repeatedView.changes.map((c) => c.label)).toEqual([`Reuse domain: ${name}`, `Reuse area: ${areaName}`]);
    const repeated = await complete(applied.session, repeatedView, 'structure');
    expect(await getDb().select().from(stewardship_domains).where(eq(stewardship_domains.name, name))).toHaveLength(1);
    expect(await getDb().select().from(projects).where(eq(projects.name, areaName))).toHaveLength(1);
    await complete(repeated.session, await preview(repeated.session));
    expect(await getDb().select().from(stewardship_domains).where(eq(stewardship_domains.name, name))).toHaveLength(1);
  });

  it('requires explicit reuse across reruns and never renames an existing domain or area', async () => {
    const name = `P3 preserved ${randomUUID()}`;
    const [existing] = await getDb().insert(stewardship_domains).values({ name }).returning();
    const first = await start({ domains: [{ key: 'same', name, selected: true }], areas: [] });
    const response = await request('POST', `/sessions/${first.id}/actions/structure/preview`, { expected_revision: 0 });
    expect(response.json().error).toBe('existing_domain_requires_selection');
    const saved = (await request('PATCH', `/sessions/${first.id}/steps/structure`, { expected_revision: 0,
      values: { domains: [{ key: 'same', name: 'Unrequested rename', existing_id: existing!.id, selected: true }], areas: [] } })).json() as OnboardingSession;
    const view = await preview(saved, 'structure');
    expect(view.changes[0]!.label).toBe(`Reuse domain: ${name}`);
    await complete(saved, view, 'structure');
    expect((await getDb().select().from(stewardship_domains).where(eq(stewardship_domains.id, existing!.id)))[0]!.name).toBe(name);
  });

  it('resumes a real deferred child with its core-created domain after core completion and a seed rerun', async () => {
    const name = `P3 child domain ${randomUUID()}`;
    const session = await start({ domains: [{ key: 'vehicle-domain', name, selected: true }], areas: [] });
    const applied = await complete(session, await preview(session, 'structure'), 'structure');
    const [domain] = await getDb().select().from(stewardship_domains).where(eq(stewardship_domains.name, name));
    const createdChild = await request('POST', '/sessions', { module_id: 'vehicle', entry_point: 'first_run', parent_session_id: session.id, creation_key: randomUUID(), draft: {
      identity: { year: 2020, make: 'Honda', model: 'Fit' }, plans: { domain_id: domain!.id },
    } });
    expect(createdChild.statusCode, createdChild.body).toBe(200);
    const child = createdChild.json() as OnboardingSession;
    const deferredResult = await request('POST', `/sessions/${child.id}/defer`, { expected_revision: child.revision });
    expect(deferredResult.statusCode, deferredResult.body).toBe(200);
    const deferred = deferredResult.json() as OnboardingSession;
    const reapplied = await complete(applied.session, await preview(applied.session, 'structure'), 'structure');
    await complete(reapplied.session, await preview(reapplied.session));
    const loaded = (await request('GET', `/sessions/${child.id}`)).json().session as OnboardingSession;
    expect(loaded.status).toBe('deferred');
    expect(loaded.draft.plans?.domain_id).toBe(domain!.id);
    const resumedResult = await request('POST', `/sessions/${child.id}/resume`, { expected_revision: deferred.revision });
    expect(resumedResult.statusCode, resumedResult.body).toBe(200);
    const resumed = resumedResult.json() as OnboardingSession;
    const savedVehicle = await complete(resumed, await preview(resumed));
    expect((await getDb().select().from(assets).where(eq(assets.id, savedVehicle.session.subject_id!)))[0]).toMatchObject({ name: '2020 Honda Fit', domain_id: domain!.id });
    expect(await getDb().select().from(stewardship_domains).where(eq(stewardship_domains.name, name))).toHaveLength(1);
    expect((await request('GET', '/installation')).json().state).toBe('completed');
  });

  it('rejects duplicate seed choices and catches changes to reviewed settings', async () => {
    const name = `P3 duplicate ${randomUUID()}`;
    const session = await start({ domains: [{ key: 'one', name, selected: true }, { key: 'two', name, selected: true }], areas: [] });
    expect((await request('POST', `/sessions/${session.id}/actions/structure/preview`, { expected_revision: 0 })).json().error).toBe('duplicate_structure_name');
    const saved = (await request('PATCH', `/sessions/${session.id}/steps/structure`, { expected_revision: 0, values: { domains: [], areas: [] } })).json() as OnboardingSession;
    const view = await preview(saved);
    await getDb().update(app_settings).set({ timezone: 'UTC', revision: 2 }).where(eq(app_settings.id, true));
    const stale = await request('POST', `/sessions/${session.id}/complete`, { expected_revision: view.revision, preview_fingerprint: view.fingerprint, operation_key: randomUUID() });
    expect(stale.json().error).toBe('workspace_settings_changed');
  });

  it('reports real schema/readiness separately from optional configured capabilities', async () => {
    const checks = await getCoreReadiness();
    expect(checks.find((c) => c.id === 'database')).toMatchObject({ status: 'passed', required: true });
    expect(checks.find((c) => c.id === 'migrations')?.status).not.toBe('degraded');
    expect(checks.find((c) => c.id === 'scheduling')).toMatchObject({ required: false });
    const session = await start();
    const context = await request('GET', `/sessions/${session.id}/core-context`);
    expect(context.statusCode, context.body).toBe(200);
    expect(context.json().capabilities.find((c: { id: string }) => c.id === 'external_research').status).toBe('unavailable');
    expect(context.body).not.toContain('password_hash');
  });
});
