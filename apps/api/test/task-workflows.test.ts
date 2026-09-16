import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { createItem, logsFor } from './helpers.js';
import { randomUUID } from 'node:crypto';
import { BUILTIN_WORKFLOW_PRESETS } from '@jevi-ops/shared';
import { buildServer } from '../src/server.js';
import { signSession } from '../src/lib/jwt.js';
import { getDb } from '../src/lib/db.js';
import { projects, stewardship_domains, tasks } from '../src/db/schema.js';

let app: FastifyInstance, token: string, domainId: string, projectId: string;
const kit = BUILTIN_WORKFLOW_PRESETS[1]!.definition;
beforeAll(async () => { app = await buildServer(); token = await signSession({ id: randomUUID(), email: 'workflow@test.local' }); });
afterAll(async () => { await app.close(); });
beforeEach(async () => {
  const [domain] = await getDb().insert(stewardship_domains).values({ name: `Workflow ${randomUUID().replace(/-/g, '')}` }).returning();
  domainId = domain!.id;
  const [project] = await getDb().insert(projects).values({ name: 'Kit', domain_id: domainId }).returning();
  projectId = project!.id;
});
afterEach(async () => {
  await getDb().delete(tasks).where(eq(tasks.domain_id, domainId));
  await getDb().delete(projects).where(eq(projects.id, projectId));
  await getDb().delete(stewardship_domains).where(eq(stewardship_domains.id, domainId));
});
function req(method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, payload?: unknown) {
  return app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, ...(payload ? { payload } : {}) });
}
async function configure(definition: unknown = kit, expected_revision = 0, scope = 'project', id = projectId) {
  return req('PUT', `/api/task-workflows/${scope}/${id}`, { definition, expected_revision });
}
async function create(extra: Record<string, unknown> = {}) {
  const r = await req('POST', '/api/tasks', { title: 'Torch', project_id: projectId, ...extra });
  expect(r.statusCode).toBe(201); return r.json();
}
async function move(id: string, workflow_status_id: string, workflow_revision = 1) {
  return req('PATCH', `/api/tasks/${id}`, { workflow_status_id, workflow_revision });
}
describe('task workflows', () => {
  it('keeps siblings simple, covers direct domain tasks, projects, areas and subtasks independently', async () => {
    expect((await configure(kit, 0, 'domain', domainId)).statusCode).toBe(200);
    const direct = await create({ project_id: null, domain_id: domainId });
    expect(direct.workflow_status_id).toBe('buy');
    const parent = await create(); expect(parent.workflow_status_id).toBeNull();
    await getDb().update(projects).set({ kind: 'area' }).where(eq(projects.id, projectId));
    expect((await configure()).statusCode).toBe(200);
    const child = await create({ parent_task_id: parent.id });
    expect(child.workflow_status_id).toBe('buy');
    const updated = await move(child.id, 'pack');
    expect(updated.json()).toMatchObject({ status: 'open', workflow_status_id: 'pack', completed_at: null });
    const { scopes } = (await req('GET', '/api/task-workflows')).json();
    expect(scopes.find((s: { id: string }) => s.id === projectId).definition).toEqual(kit);
  });
  it('activation and disabling preserve canonical status and completion timestamps', async () => {
    const t = await create();
    const done = (await req('PATCH', `/api/tasks/${t.id}`, { status: 'done' })).json();
    await configure();
    expect((await req('GET', `/api/tasks/${t.id}`)).json()).toMatchObject({ status: 'done', workflow_status_id: 'packed', completed_at: done.completed_at });
    await configure(null, 1);
    expect((await req('GET', `/api/tasks/${t.id}`)).json()).toMatchObject({ status: 'done', workflow_status_id: null, completed_at: done.completed_at });
  });
  it('supports cycles and legacy status writers without restoring an obsolete stage', async () => {
    await configure(); const t = await create();
    await move(t.id, 'pack');
    const packed = await move(t.id, 'packed');
    expect(packed.json()).toMatchObject({ status: 'done', workflow_status_id: 'packed' });
    expect(packed.json().completed_at).toBeTruthy();
    await getDb().update(tasks).set({ status: 'open', completed_at: null }).where(eq(tasks.id, t.id));
    expect((await req('GET', `/api/tasks/${t.id}`)).json().workflow_status_id).toBe('buy');
    await req('PATCH', `/api/tasks/${t.id}`, { status: 'waiting' });
    expect((await req('GET', `/api/tasks/${t.id}`)).json()).toMatchObject({ status: 'waiting', workflow_status_id: null });
    expect((await move(t.id, 'buy')).json()).toMatchObject({ status: 'open', waiting_since: null });
  });
  it('blocks occupied removal or category changes, but permits renaming', async () => {
    await configure(); const t = await create(); await move(t.id, 'pack');
    expect((await configure({ statuses: kit.statuses.filter(s => s.id !== 'pack') }, 1)).statusCode).toBe(409);
    expect((await configure({ statuses: kit.statuses.map(s => s.id === 'pack' ? { ...s, category: 'done' } : s) }, 1)).statusCode).toBe(409);
    expect((await configure({ statuses: kit.statuses.map(s => ({ ...s, label: `${s.label}!` })) }, 1)).statusCode).toBe(200);
    expect((await move(t.id, 'packed', 1)).statusCode).toBe(409);
    expect((await move(t.id, 'packed', 2)).statusCode).toBe(200);
    expect((await configure(kit, 1)).statusCode).toBe(409);
  });
  it('resets scope on moves and preserves default checkbox semantics outside custom workflows', async () => {
    await configure(); const t = await create(); await move(t.id, 'pack');
    const r = await req('PATCH', `/api/tasks/${t.id}`, { project_id: null, domain_id: domainId });
    expect(r.json()).toMatchObject({ status: 'open', workflow_status_id: null });
    expect((await move(t.id, 'packed')).statusCode).toBe(409);
    expect((await req('PATCH', `/api/tasks/${t.id}`, { status: 'done' })).json().status).toBe('done');
  });
  it('recurrence rolls into the default actionable status', async () => {
    await configure(); const t = await create({ recurrence_rule: 'weekly', due_date: '2026-09-17' });
    const r = await move(t.id, 'packed');
    expect(r.json()).toMatchObject({ recurred: true, status: 'open', workflow_status_id: 'buy', completed_at: null });
    expect(r.json().due_date).not.toBe('2026-09-17');
  });
  it('keeps maintenance evidence requirements and transactional completion intact', async () => {
    await configure(); const t = await create({ source: 'maintenance' });
    await createItem({ policy: 'expiry', interval_months: null, interval_meter: null, generated_task_id: t.id, next_due_date: '2026-09-17' });
    const blocked = await move(t.id, 'packed');
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error).toBe('needs_details');
    expect((await req('GET', `/api/tasks/${t.id}`)).json()).toMatchObject({ status: 'open', workflow_status_id: 'buy' });
    const second = await create({ source: 'maintenance' });
    const item = await createItem({ interval_months: 6, interval_meter: null, generated_task_id: second.id });
    expect((await move(second.id, 'packed')).statusCode).toBe(200);
    expect(await logsFor(item.id)).toHaveLength(1);
    expect((await move(second.id, 'packed')).statusCode).toBe(200);
    expect(await logsFor(item.id)).toHaveLength(1);
  });
  it('serializes occupied status deletion with an in-flight task transition', async () => {
    await configure(); const t = await create();
    const [transition, edit] = await Promise.all([
      move(t.id, 'pack'),
      configure({ statuses: kit.statuses.filter(s => s.id !== 'pack') }, 1),
    ]);
    // One wins; the other observes either a changed revision or occupancy.
    expect([transition.statusCode, edit.statusCode].sort()).toEqual([200, 409]);
    const current = (await req('GET', `/api/tasks/${t.id}`)).json();
    const registry = (await req('GET', '/api/task-workflows')).json();
    const definition = registry.scopes.find((s: { id: string }) => s.id === projectId).definition;
    expect(definition.statuses.some((s: { id: string; category: string }) => s.id === current.workflow_status_id && s.category === current.status)).toBe(true);
  });
  it('copies presets across domains without live links', async () => {
    const r = await req('POST', '/api/task-workflow-presets', { name: 'Reusable kit', definition: kit });
    expect(r.statusCode).toBe(201); const preset = r.json();
    await configure(preset.definition); await configure(preset.definition, 0, 'domain', domainId);
    await configure({ statuses: kit.statuses.map(s => ({ ...s, label: `${s.label}!` })) }, 1);
    await req('DELETE', `/api/task-workflow-presets/${preset.id}`);
    const registry = (await req('GET', '/api/task-workflows')).json();
    expect(registry.scopes.find((s: { id: string }) => s.id === domainId).definition).toEqual(kit);
    expect(registry.presets.some((p: { id: string }) => p.id === preset.id)).toBe(false);
  });
  it('validates labels, unique IDs and an actionable default, without requiring a done state', async () => {
    const statuses = [{ id: 'a', label: 'Buy', category: 'open' }, { id: 'b', label: 'Pack', category: 'open' }];
    expect((await configure({ statuses })).statusCode).toBe(200);
    expect((await configure({ statuses: [statuses[0], statuses[0]] }, 1)).statusCode).toBe(400);
    expect((await configure({ statuses: statuses.map(s => ({ ...s, category: 'done' })) }, 1)).statusCode).toBe(400);
    const t = await create();
    expect((await req('PATCH', `/api/tasks/${t.id}`, { workflow_status_id: 'b', workflow_revision: 1, status: 'done' })).statusCode).toBe(400);
  });
});
