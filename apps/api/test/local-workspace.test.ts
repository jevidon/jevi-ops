import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { signSession } from '../src/lib/jwt.js';
import { getDb } from '../src/lib/db.js';
import { projects, stewardship_domains, tasks } from '../src/db/schema.js';
import { INBOX_DOMAIN_ID } from '@jevi-ops/shared';

let app: FastifyInstance, token: string;
beforeAll(async () => { app = await buildServer(); token = await signSession({ id: randomUUID(), email: 'workspace@test.local' }); });
afterAll(async () => { await app.close(); });
const headers = () => ({ authorization: `Bearer ${token}` });
async function create() { return (await app.inject({ method: 'POST', url: '/api/tasks', headers: headers(), payload: { title: 'Original', notes: 'Original notes' } })).json(); }
async function request(base: Record<string, unknown>, patch: Record<string, unknown>, id = randomUUID()) {
  const identity = (await app.inject({ method: 'GET', url: '/api/tasks/sync-state', headers: headers() })).json();
  return { method: 'PATCH' as const, url: `/api/tasks/${base.id}`, headers: {
    ...headers(), 'x-operation-id': id, 'x-task-version': base.updated_at as string,
    'x-sync-identity': `${identity.dataSpaceId}:${identity.serverEpoch}`,
  }, payload: { ...patch, _offline_base: Object.fromEntries(['title','notes','due_date','priority','status','workflow_status_id','project_id','domain_id'].map(k => [k, base[k] ?? null])) } };
}
describe('local workspace', () => {
  it('includes empty domains and projects and all tasks, behind authentication', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/local-workspace' })).statusCode).toBe(401);
    const [domain] = await getDb().insert(stewardship_domains).values({ name: `Empty ${randomUUID()}` }).returning();
    const [project] = await getDb().insert(projects).values({ name: 'Empty project', domain_id: domain!.id }).returning();
    await getDb().insert(tasks).values(Array.from({ length: 503 }, (_, i) => ({ title: `Snapshot ${i}`, domain_id: INBOX_DOMAIN_ID })));
    const r = await app.inject({ method: 'GET', url: '/api/local-workspace', headers: headers() });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.domains.some((d: { id: string }) => d.id === domain!.id)).toBe(true);
    expect(body.projects.some((p: { id: string }) => p.id === project!.id)).toBe(true);
    expect(body.tasks).toHaveLength(503);
    expect(body.scopes.some((s: { id: string }) => s.id === project!.id)).toBe(true);
  });
  it('merges independent fields and safely replays after a lost response', async () => {
    const base = await create();
    await app.inject({ method: 'PATCH', url: `/api/tasks/${base.id}`, headers: headers(), payload: { notes: 'Other device notes' } });
    const edit = await request(base, { title: 'Offline title' });
    const first = await app.inject(edit);
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ title: 'Offline title', notes: 'Other device notes' });
    await app.inject({ method: 'PATCH', url: edit.url, headers: headers(), payload: { title: 'Later edit' } });
    expect((await app.inject(edit)).json()).toEqual(first.json());
    expect((await app.inject({ method: 'GET', url: edit.url, headers: headers() })).json().title).toBe('Later edit');
  });
  it('retains both versions for a same-field conflict', async () => {
    const base = await create();
    await app.inject({ method: 'PATCH', url: `/api/tasks/${base.id}`, headers: headers(), payload: { title: 'Remote title' } });
    const r = await app.inject(await request(base, { title: 'Local title' }));
    expect(r.statusCode).toBe(409);
    expect(r.json()).toMatchObject({ conflicting_fields: ['title'], current: { title: 'Remote title' } });
  });
  it('does not auto-rebase stale completion, nor accept base changes under one operation ID', async () => {
    const base = await create();
    await app.inject({ method: 'PATCH', url: `/api/tasks/${base.id}`, headers: headers(), payload: { notes: 'Changed' } });
    const completion = await app.inject(await request(base, { status: 'done' }));
    expect(completion.statusCode).toBe(409);
    const edit = await request(base, { title: 'Local' });
    expect((await app.inject(edit)).statusCode).toBe(200);
    edit.payload._offline_base.title = 'Forged different base';
    expect((await app.inject(edit)).json().error).toBe('operation_id_reused');
  });
});
