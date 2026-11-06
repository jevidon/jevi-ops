import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { content_items, projects, stewardship_domains, tasks } from '../src/db/schema.js';
import { getAppTz } from '../src/lib/app-settings.js';
import { getDb } from '../src/lib/db.js';
import { signSession } from '../src/lib/jwt.js';
import { buildRecentActivity } from '../src/lib/recent-activity.js';
import { localWallTimeIso } from '../src/lib/tz.js';
import type { RecentActivityPayload } from '../src/routes/briefing.js';
import { buildServer } from '../src/server.js';
import { daysFromToday, INBOX, today } from './helpers.js';

let app: FastifyInstance;
let headers: { authorization: string };
beforeAll(async () => {
  app = await buildServer();
  const token = await signSession({ id: randomUUID(), email: 'recent-activity@test.local' });
  headers = { authorization: `Bearer ${token}` };
});
beforeEach(async () => {
  await getDb().delete(content_items);
});
afterAll(async () => {
  await app.close();
});

async function activity() {
  const response = await app.inject({ method: 'GET', url: '/api/briefing/activity', headers });
  expect(response.statusCode).toBe(200);
  return response.json<RecentActivityPayload>();
}

async function createTask(payload: { title: string; source?: string; project_id?: string }) {
  const response = await app.inject({ method: 'POST', url: '/api/tasks', headers, payload });
  expect(response.statusCode).toBe(201);
  return response.json<{ id: string }>();
}

async function patchTask(id: string, payload: { status: string; waiting_on?: string }) {
  const response = await app.inject({ method: 'PATCH', url: `/api/tasks/${id}`, headers, payload });
  expect(response.statusCode).toBe(200);
}

describe('recent activity', () => {
  it('requires authentication', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/briefing/activity' });
    expect(response.statusCode).toBe(401);
  });

  it('returns an empty week when there is no activity', async () => {
    expect(await activity()).toEqual({ window_days: 7, entries: [], truncated: false });
  });

  it('links a new unfiled task and labels it Inbox', async () => {
    const task = await createTask({ title: 'Sort the mail' });
    const { entries } = await activity();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      id: `task_added:${task.id}`,
      kind: 'task_added',
      label: 'Added',
      title: 'Sort the mail',
      href: `/tasks/${task.id}`,
      location: { label: 'Inbox', inbox: true },
      time_label: expect.stringMatching(/^\d{1,2}:\d{2} (AM|PM)$/),
      day_label: expect.stringMatching(/^Today · /),
    });
  });

  it('shows a project and its domain, omitting the Inbox prefix for projects', async () => {
    const db = getDb();
    const [domain] = await db.insert(stewardship_domains).values({ name: 'Household' }).returning();
    const newProjects = await db.insert(projects).values([
      { name: 'Kitchen', domain_id: domain!.id },
      { name: 'Unfiled project', domain_id: INBOX },
    ]).returning();
    try {
      const [filed, inbox] = await Promise.all(newProjects.map((project) =>
        createTask({ title: 'Pick paint', project_id: project.id }),
      ));
      const { entries } = await activity();
      expect(entries.find((entry) => entry.href === `/tasks/${filed!.id}`)?.location)
        .toEqual({ label: 'Household › Kitchen', inbox: false });
      expect(entries.find((entry) => entry.href === `/tasks/${inbox!.id}`)?.location)
        .toEqual({ label: 'Unfiled project', inbox: false });
    } finally {
      await db.delete(tasks).where(eq(tasks.domain_id, domain!.id));
      for (const project of newProjects) await db.delete(projects).where(eq(projects.id, project.id));
      await db.delete(stewardship_domains).where(eq(stewardship_domains.id, domain!.id));
    }
  });

  it.each(['voice', 'email'])('labels a %s capture', async (source) => {
    const task = await createTask({ title: 'Capture', source });
    expect((await activity()).entries).toMatchObject([
      { id: `task_captured:${task.id}`, kind: 'task_captured', label: 'Captured' },
    ]);
  });

  it('includes maintenance completions only', async () => {
    const task = await createTask({ title: 'Rotate tyres', source: 'maintenance' });
    expect((await activity()).entries).toEqual([]);
    await getDb().update(tasks).set({ status: 'done', completed_at: new Date().toISOString() }).where(eq(tasks.id, task.id));
    expect((await activity()).entries).toMatchObject([{ id: `task_completed:${task.id}` }]);
  });

  it('shows both creation and completion until the task is reopened', async () => {
    const task = await createTask({ title: 'Follow up' });
    await patchTask(task.id, { status: 'done' });
    expect((await activity()).entries.map((entry) => entry.kind).sort()).toEqual(['task_added', 'task_completed']);
    await patchTask(task.id, { status: 'open' });
    expect((await activity()).entries).toMatchObject([{ kind: 'task_added' }]);
  });

  it('shows a single completion after a replayed PATCH', async () => {
    const task = await createTask({ title: 'Submit invoice' });
    await patchTask(task.id, { status: 'done' });
    await patchTask(task.id, { status: 'done' });
    expect((await activity()).entries.filter((entry) => entry.kind === 'task_completed')).toHaveLength(1);
  });

  it('ignores background writes to an old task', async () => {
    const task = await createTask({ title: 'Old reminder' });
    const old = localWallTimeIso(await daysFromToday(-10), 12, 0, await getAppTz());
    const db = getDb();
    await db.update(tasks).set({ created_at: old }).where(eq(tasks.id, task.id));
    await db.update(tasks).set({ reminders_sent: { overdue: new Date().toISOString() } }).where(eq(tasks.id, task.id));
    expect((await activity()).entries).toEqual([]);
  });

  it('puts date-only waiting activity after timed activity for that day', async () => {
    const task = await createTask({ title: 'Insurance claim' });
    await patchTask(task.id, { status: 'waiting', waiting_on: 'Allianz' });
    const day = await today();
    expect((await activity()).entries).toMatchObject([
      { kind: 'task_added', day },
      { kind: 'task_waiting', label: 'Waiting', day, time_label: null, detail: 'on Allianz' },
    ]);
  });

  it('includes the first day of the week and excludes dates outside the window', async () => {
    const tz = await getAppTz();
    const days = await Promise.all([-6, -7, 1].map(daysFromToday));
    await getDb().insert(tasks).values(days.map((day) => ({
      title: day, domain_id: INBOX, created_at: localWallTimeIso(day, 12, 0, tz),
    })));
    expect((await activity()).entries).toMatchObject([
      { day: days[0], day_label: expect.stringMatching(/^[A-Z][a-z]{2} [A-Z][a-z]{2} \d{1,2}$/) },
    ]);
  });

  it('uses the local midnight on a daylight saving change day', async () => {
    const db = getDb();
    await db.insert(tasks).values([
      { title: 'Previous day', domain_id: INBOX, created_at: '2026-09-26T11:45:00Z' },
      { title: 'First day', domain_id: INBOX, created_at: '2026-09-26T12:15:00Z' },
    ]);
    const result = await buildRecentActivity(db, 'Pacific/Auckland', new Date('2026-10-03T00:00:00Z'));
    expect(result.entries).toMatchObject([{ title: 'First day', day: '2026-09-27', time_label: '12:15 AM' }]);
  });

  it('links new content and removes it after archive', async () => {
    const created = await app.inject({
      method: 'POST', url: '/api/content', headers, payload: { title: 'Field guide', type: 'article' },
    });
    expect(created.statusCode).toBe(201);
    const { id } = created.json<{ id: string }>();
    expect((await activity()).entries).toMatchObject([
      { kind: 'content_added', label: 'New content', href: `/content/${id}`, detail: 'Article', location: { label: 'Content', inbox: false } },
    ]);
    const archived = await app.inject({
      method: 'PATCH', url: `/api/content/${id}`, headers, payload: { archived_at: new Date().toISOString() },
    });
    expect(archived.statusCode).toBe(200);
    expect((await activity()).entries).toEqual([]);
  });

  it('caps the newest entries, using ids to break ties', async () => {
    const at = localWallTimeIso(await daysFromToday(-1), 12, 0, await getAppTz());
    const rows = await getDb().insert(tasks).values(Array.from({ length: 35 }, (_, i) => ({
      title: `Task ${i}`, domain_id: INBOX, created_at: at,
      source: i % 2 ? 'manual' : 'voice',
    }))).returning();
    const newest = await createTask({ title: 'Newest' });
    const expectedIds = rows.map((row) => `task_${row.source === 'manual' ? 'added' : 'captured'}:${row.id}`).sort();
    const result = await activity();
    expect(result.truncated).toBe(true);
    expect(result.entries.map((entry) => entry.id)).toEqual([`task_added:${newest.id}`, ...expectedIds.slice(0, 29)]);
  });
});
