import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { signSession } from '../src/lib/jwt.js';
import { getDb } from '../src/lib/db.js';
import { milestones, projects, stewardship_domains, tasks } from '../src/db/schema.js';
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
    // No full UUID in the name: domains outlive this file, and the parser test asserts its context carries none.
    const [domain] = await getDb().insert(stewardship_domains).values({ name: `Empty ${randomUUID().slice(0, 8)}` }).returning();
    const [project] = await getDb().insert(projects).values({ name: 'Empty project', domain_id: domain!.id }).returning();
    await getDb().insert(tasks).values(Array.from({ length: 503 }, (_, i) => ({ title: `Snapshot ${i}`, domain_id: INBOX_DOMAIN_ID })));
    // Done tasks ride along only inside the recent window; older history stays server-side.
    const recent = new Date(Date.now() - 2 * 86_400_000).toISOString();
    const stale = new Date(Date.now() - 45 * 86_400_000).toISOString();
    await getDb().insert(tasks).values([
      { title: 'Recently done', domain_id: INBOX_DOMAIN_ID, status: 'done', completed_at: recent },
      { title: 'Long done', domain_id: INBOX_DOMAIN_ID, status: 'done', completed_at: stale },
    ]);
    const r = await app.inject({ method: 'GET', url: '/api/local-workspace', headers: headers() });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.domains.some((d: { id: string }) => d.id === domain!.id)).toBe(true);
    // Every domain carries art: a stored engraving or the procedural fallback.
    expect(body.domains.every((d: { illustration?: { svg?: string } }) => (d.illustration?.svg ?? '').includes('<'))).toBe(true);
    expect(body.domains.find((d: { id: string }) => d.id === domain!.id).illustration.source).toBe('procedural');
    expect(body.projects.some((p: { id: string }) => p.id === project!.id)).toBe(true);
    expect(body.tasks).toHaveLength(504);
    expect(body.tasks.some((t: { title: string }) => t.title === 'Recently done')).toBe(true);
    expect(body.tasks.some((t: { title: string }) => t.title === 'Long done')).toBe(false);
    expect(body.done_window_days).toBe(30);
    expect(body.scopes.some((s: { id: string }) => s.id === project!.id)).toBe(true);
    // The Domains board rides in the same consistent snapshot.
    expect(Array.isArray(body.work.domains)).toBe(true);
    expect(body.work.domains.some((d: { id: string }) => d.id === domain!.id)).toBe(true);
  });
  it('carries milestones and every subtask of a live parent, however old', async () => {
    const [project] = await getDb().insert(projects).values({ name: `Packing ${randomUUID()}`, domain_id: INBOX_DOMAIN_ID }).returning();
    const [milestone] = await getDb().insert(milestones).values({ project_id: project!.id, title: 'Gear', weight: 2, position: 1 }).returning();
    const stale = new Date(Date.now() - 45 * 86_400_000).toISOString();
    const [liveParent, doneParent] = await getDb().insert(tasks).values([
      { title: 'Packing: Tech', domain_id: INBOX_DOMAIN_ID, project_id: project!.id, milestone_id: milestone!.id },
      { title: 'Packing: Old trip', domain_id: INBOX_DOMAIN_ID, project_id: project!.id, status: 'done', completed_at: stale },
    ]).returning();
    await getDb().insert(tasks).values([
      { title: 'Old packed charger', domain_id: INBOX_DOMAIN_ID, project_id: project!.id, parent_task_id: liveParent!.id, status: 'done', completed_at: stale },
      { title: 'Old packed under done parent', domain_id: INBOX_DOMAIN_ID, project_id: project!.id, parent_task_id: doneParent!.id, status: 'done', completed_at: stale },
    ]);
    const body = (await app.inject({ method: 'GET', url: '/api/local-workspace', headers: headers() })).json();
    expect(body.milestones.find((m: { id: string }) => m.id === milestone!.id)).toMatchObject({ project_id: project!.id, title: 'Gear', weight: 2, position: 1, status: 'open' });
    const titles = body.tasks.map((t: { title: string }) => t.title);
    expect(body.tasks.find((t: { id: string }) => t.id === liveParent!.id).milestone_id).toBe(milestone!.id);
    expect(titles).toContain('Old packed charger');
    expect(titles).not.toContain('Old packed under done parent');
    expect(titles).not.toContain('Packing: Old trip');
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
