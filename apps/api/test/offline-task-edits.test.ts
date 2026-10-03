import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { signSession } from '../src/lib/jwt.js';
import { getDb } from '../src/lib/db.js';
import { tasks } from '../src/db/schema.js';
import { INBOX_DOMAIN_ID } from '@jevi-ops/shared';
import { createItem, logsFor } from './helpers.js';

let app: FastifyInstance, token: string;
beforeAll(async () => { app = await buildServer(); token = await signSession({ id: randomUUID(), email: 'offline@test.local' }); });
afterAll(async () => { await app.close(); });
const headers = () => ({ authorization: `Bearer ${token}` });
async function create(extra: Record<string, unknown> = {}) {
  const r = await app.inject({ method: 'POST', url: '/api/tasks', headers: headers(), payload: { title: 'Offline task', ...extra } });
  expect(r.statusCode).toBe(201);
  return r.json();
}
async function offlineHeaders(task: { updated_at: string }, id = randomUUID()) {
  const state = (await app.inject({ method: 'GET', url: '/api/tasks/sync-state', headers: headers() })).json();
  return { ...headers(), 'x-operation-id': id, 'x-task-version': task.updated_at, 'x-sync-identity': `${state.dataSpaceId}:${state.serverEpoch}` };
}

describe('offline task edits', () => {
  it('applies and replays the same edit without overwriting a later change', async () => {
    const task = await create();
    const h = await offlineHeaders(task);
    const request = { method: 'PATCH' as const, url: `/api/tasks/${task.id}`, headers: h, payload: { title: 'Saved offline', notes: 'Keep this' } };
    const first = await app.inject(request);
    expect(first.statusCode).toBe(200);
    expect(first.json().title).toBe('Saved offline');
    await app.inject({ ...request, headers: headers(), payload: { title: 'Later online edit', notes: 'Newer notes' } });
    const replay = await app.inject(request);
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual(first.json());
    const current = (await app.inject({ method: 'GET', url: request.url, headers: headers() })).json();
    expect(current.title).toBe('Later online edit');
  });

  it('preserves both versions when the cached task is stale', async () => {
    const task = await create();
    await app.inject({ method: 'PATCH', url: `/api/tasks/${task.id}`, headers: headers(), payload: { notes: 'Changed elsewhere' } });
    const r = await app.inject({ method: 'PATCH', url: `/api/tasks/${task.id}`, headers: await offlineHeaders(task), payload: { notes: 'Phone notes' } });
    expect(r.statusCode).toBe(409);
    expect(r.json()).toMatchObject({ error: 'task_changed', current: { notes: 'Changed elsewhere' } });
  });

  it('advances a recurring task exactly once across simultaneous retries', async () => {
    const task = await create({ recurrence_rule: 'daily', due_date: '2026-09-25' });
    const h = await offlineHeaders(task);
    const request = { method: 'PATCH' as const, url: `/api/tasks/${task.id}`, headers: h, payload: { status: 'done' } };
    const results = await Promise.all([app.inject(request), app.inject(request)]);
    expect(results.map(r => r.statusCode)).toEqual([200, 200]);
    expect(results[0]!.json()).toEqual(results[1]!.json());
    expect(results[0]!.json().recurred).toBe(true);
  });

  it('rejects operation reuse, partial headers, changed installation and deleted tasks', async () => {
    const task = await create();
    const h = await offlineHeaders(task);
    const request = { method: 'PATCH' as const, url: `/api/tasks/${task.id}`, headers: h, payload: { title: 'First' } };
    expect((await app.inject(request)).statusCode).toBe(200);
    expect((await app.inject({ ...request, payload: { title: 'Different' } })).json().error).toBe('operation_id_reused');
    expect((await app.inject({ ...request, headers: { ...headers(), 'x-operation-id': randomUUID() } })).statusCode).toBe(400);
    expect((await app.inject({ ...request, headers: { ...headers(), 'x-operation-id': '', 'x-task-version': '', 'x-sync-identity': '' } })).statusCode).toBe(400);
    expect((await app.inject({ ...request, headers: { ...h, 'x-operation-id': randomUUID(), 'x-sync-identity': `${randomUUID()}:9` } })).json().error).toBe('installation_changed');
    await app.inject({ method: 'DELETE', url: request.url, headers: headers() });
    expect((await app.inject({ ...request, headers: await offlineHeaders(task) })).statusCode).toBe(404);
  });

  it('keeps evidence-requiring maintenance completion pending without partial writes', async () => {
    const task = await create();
    const item = await createItem({ policy: 'expiry', interval_months: null, interval_meter: null, generated_task_id: task.id, next_due_date: '2026-09-25' });
    const request = { method: 'PATCH' as const, url: `/api/tasks/${task.id}`, headers: await offlineHeaders(task), payload: { status: 'done', title: 'Must remain unchanged' } };
    const first = await app.inject(request);
    expect(first.statusCode).toBe(409);
    expect(first.json().error).toBe('needs_details');
    expect((await app.inject(request)).json()).toEqual(first.json());
    const current = (await app.inject({ method: 'GET', url: request.url, headers: headers() })).json();
    expect(current.status).toBe('open');
    expect(current.title).toBe(task.title);
    expect(await logsFor(item.id)).toHaveLength(0);
  });

  it('lets only one of two independent edits based on the same version win', async () => {
    const task = await create();
    const a = await offlineHeaders(task), b = await offlineHeaders(task);
    const results = await Promise.all([
      app.inject({ method: 'PATCH', url: `/api/tasks/${task.id}`, headers: a, payload: { title: 'Phone A' } }),
      app.inject({ method: 'PATCH', url: `/api/tasks/${task.id}`, headers: b, payload: { title: 'Phone B' } }),
    ]);
    expect(results.map(r => r.statusCode).sort()).toEqual([200, 409]);
  });

  it('downloads beyond 500 tasks without duplicates and leaves legacy ordering intact', async () => {
    await getDb().insert(tasks).values(Array.from({ length: 503 }, (_, i) => ({ title: `Task ${i}`, domain_id: INBOX_DOMAIN_ID })));
    const first = (await app.inject({ method: 'GET', url: '/api/tasks?offline_page=1', headers: headers() })).json();
    expect(first.tasks).toHaveLength(500);
    const second = (await app.inject({ method: 'GET', url: `/api/tasks?offline_page=1&before_id=${first.next_cursor}`, headers: headers() })).json();
    expect(second.tasks).toHaveLength(3);
    expect(second.next_cursor).toBeNull();
    expect(new Set([...first.tasks, ...second.tasks].map(t => t.id)).size).toBe(503);
    const legacy = (await app.inject({ method: 'GET', url: '/api/tasks', headers: headers() })).json();
    expect(legacy.next_cursor).toBeUndefined();
  });
});
