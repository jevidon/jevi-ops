import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { BUILTIN_WORKFLOW_PRESETS, INBOX_DOMAIN_ID } from '@jevi-ops/shared';
import { buildServer } from '../src/server.js';
import { signSession } from '../src/lib/jwt.js';
import { getDb } from '../src/lib/db.js';
import { projects, task_templates, tasks } from '../src/db/schema.js';
import { createAsset } from './helpers.js';

let app: FastifyInstance;
let token: string;
beforeAll(async () => {
  app = await buildServer();
  token = await signSession({ id: randomUUID(), email: 'templates@test.local' });
});
afterAll(async () => { await app.close(); });
beforeEach(async () => { await getDb().delete(task_templates); });

function req(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: unknown) {
  return app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, ...(payload === undefined ? {} : { payload }) });
}
function entries(titles: string[]) { return titles.map(title => ({ key: randomUUID(), title, notes: null, parent_key: null })); }
async function template() {
  const response = await req('POST', '/api/task-templates', { name: ' Flight packing ', entries: entries([' Passports ', 'Chargers']) });
  expect(response.statusCode).toBe(201);
  return response.json();
}
async function use(id: string, name: string, extra: Record<string, unknown> = {}) {
  const response = await req('POST', `/api/task-templates/${id}/projects`, { name, ...extra });
  expect(response.statusCode).toBe(201);
  return response.json();
}
async function projectTasks(id: string) {
  return getDb().select().from(tasks).where(eq(tasks.project_id, id));
}

describe('reusable task templates', () => {
  it('keeps ten template entries in project-detail order, including after a notes edit', async () => {
    const titles = Array.from({ length: 10 }, (_, i) => `Task ${i + 1}`);
    const response = await req('POST', '/api/task-templates', { name: 'Ordered list', entries: entries(titles) });
    const project = await use(response.json().id, 'Ordered project');
    const detail = (await req('GET', `/api/projects/${project.id}`)).json();
    expect(detail.tasks.map((task: { title: string }) => task.title)).toEqual(titles);
    await req('PATCH', `/api/tasks/${detail.tasks[0].id}`, { notes: 'Edited without changing the order' });
    const edited = (await req('GET', `/api/projects/${project.id}`)).json();
    expect(edited.tasks.map((task: { title: string }) => task.title)).toEqual(titles);
  });

  it('keeps project-detail order through project to template to project', async () => {
    const [source] = await getDb().insert(projects).values({ name: 'Ordered source', domain_id: INBOX_DOMAIN_ID }).returning();
    await getDb().insert(tasks).values(Array.from({ length: 10 }, (_, i) => ({
      title: `Source task ${i}`, project_id: source!.id, domain_id: INBOX_DOMAIN_ID,
      created_at: new Date(Date.UTC(2026, 10, 1, 0, 0, i)).toISOString(),
    })));
    const titles = (await req('GET', `/api/projects/${source!.id}`)).json().tasks.map((task: { title: string }) => task.title);
    const template = (await req('POST', `/api/projects/${source!.id}/task-template`, { name: 'Ordered snapshot' })).json();
    expect(template.entries.map((entry: { title: string }) => entry.title)).toEqual(titles);
    const copy = await use(template.id, 'Ordered copy');
    expect((await req('GET', `/api/projects/${copy.id}`)).json().tasks.map((task: { title: string }) => task.title)).toEqual(titles);
  });

  it('saves a project without changing it and copies completed tasks, notes and nested subtasks into fresh projects', async () => {
    const [source] = await getDb().insert(projects).values({ name: 'Finished trip', domain_id: INBOX_DOMAIN_ID, status: 'done' }).returning();
    const [parent] = await getDb().insert(tasks).values({ project_id: source!.id, domain_id: INBOX_DOMAIN_ID, title: 'Documents', notes: '**Check** expiry\nKeep originals', status: 'done', completed_at: '2026-10-01T00:00:00Z', due_date: '2026-10-01', recurrence_rule: 'weekly', reminder_offsets: [1] }).returning();
    const [child] = await getDb().insert(tasks).values({ project_id: source!.id, domain_id: INBOX_DOMAIN_ID, title: 'Passport', notes: 'In the front pocket', parent_task_id: parent!.id, status: 'done' }).returning();
    await getDb().insert(tasks).values({ project_id: source!.id, domain_id: INBOX_DOMAIN_ID, title: 'Copy', notes: 'Paper backup', parent_task_id: child!.id, status: 'waiting', waiting_on: 'Printer', waiting_since: '2026-09-01' });
    const before = await projectTasks(source!.id);
    const response = await req('POST', `/api/projects/${source!.id}/task-template`, { name: 'Travel documents' });
    expect(response.statusCode).toBe(201);
    const saved = response.json();
    expect(saved.entries).toHaveLength(3);
    const a = await use(saved.id, 'Next trip');
    const b = await use(saved.id, 'Another trip');
    for (const project of [a, b]) {
      const copied = await projectTasks(project.id);
      const root = copied.find(t => t.title === 'Documents')!;
      const sub = copied.find(t => t.title === 'Passport')!;
      const leaf = copied.find(t => t.title === 'Copy')!;
      expect(root).toMatchObject({ parent_task_id: null, notes: '**Check** expiry\nKeep originals' });
      expect(sub).toMatchObject({ parent_task_id: root.id, notes: 'In the front pocket' });
      expect(leaf).toMatchObject({ parent_task_id: sub.id, notes: 'Paper backup' });
      for (const task of copied) {
        expect(before.some(original => original.id === task.id)).toBe(false);
        expect(task).toMatchObject({ status: 'open', completed_at: null, due_date: null, due_time: null, recurrence_rule: null, reminder_offsets: [], reminders_sent: {}, waiting_on: null, waiting_since: null, workflow_status_id: null });
      }
    }
    expect(await projectTasks(source!.id)).toEqual(before);
    expect((await getDb().select().from(projects).where(eq(projects.id, source!.id)))[0]!.status).toBe('done');
    // Subsequent source edits don't alter the saved template.
    await req('PATCH', `/api/tasks/${parent!.id}`, { notes: 'Changed later' });
    expect((await req('GET', '/api/task-templates')).json().templates[0]).toEqual(saved);
  });

  it('rejects empty or oversized source projects without silently truncating', async () => {
    const [source] = await getDb().insert(projects).values({ name: 'Source', domain_id: INBOX_DOMAIN_ID }).returning();
    expect((await req('POST', `/api/projects/${source!.id}/task-template`, { name: 'Empty' })).json().error).toBe('empty_project');
    await getDb().insert(tasks).values(Array.from({ length: 201 }, (_, i) => ({ title: `Task ${i}`, project_id: source!.id, domain_id: INBOX_DOMAIN_ID })));
    expect((await req('POST', `/api/projects/${source!.id}/task-template`, { name: 'Too large' })).json().error).toBe('too_many_tasks');
    expect((await req('POST', `/api/projects/${randomUUID()}/task-template`, { name: 'Missing' })).statusCode).toBe(404);
    expect((await req('GET', '/api/task-templates')).json().templates).toEqual([]);
  });

  it('rejects missing parents, duplicate keys and cycles before saving', async () => {
    const [a, b] = entries(['A', 'B']);
    for (const invalid of [
      [a, a], [{ ...a, parent_key: randomUUID() }],
      [{ ...a, parent_key: a!.key }],
      [{ ...a, parent_key: b!.key }, { ...b, parent_key: a!.key }],
    ]) expect((await req('POST', '/api/task-templates', { name: 'Invalid', entries: invalid })).statusCode).toBe(400);
    expect((await req('GET', '/api/task-templates')).json().templates).toEqual([]);
  });

  it('creates independent projects, preserves progress, and applies template edits only to future projects', async () => {
    const t = await template();
    expect(t).toMatchObject({ name: 'Flight packing', entries: [{ title: 'Passports' }, { title: 'Chargers' }], revision: 1 });
    const a = await use(t.id, 'December trip');
    const b = await use(t.id, 'January trip');
    const aTasks = await projectTasks(a.id);
    const bTasks = await projectTasks(b.id);
    expect(aTasks.map(t => t.id)).not.toEqual(bTasks.map(t => t.id));
    for (const task of [...aTasks, ...bTasks]) {
      expect(task).toMatchObject({ status: 'open', completed_at: null, due_date: null, recurrence_rule: null, workflow_status_id: null, domain_id: INBOX_DOMAIN_ID });
    }
    expect((await req('PATCH', `/api/tasks/${aTasks[0]!.id}`, { status: 'done', title: 'Passport packed' })).statusCode).toBe(200);
    expect((await req('DELETE', `/api/tasks/${aTasks[1]!.id}`)).statusCode).toBe(204);
    expect((await req('POST', '/api/tasks', { project_id: a.id, title: 'Extra bag' })).statusCode).toBe(201);
    const updated = await req('PUT', `/api/task-templates/${t.id}`, { name: 'Travel essentials', entries: entries(['Passport', 'Medicines', 'Tickets']), expected_revision: 1 });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().revision).toBe(2);
    const c = await use(t.id, 'February trip');
    expect((await projectTasks(c.id)).map(t => t.title).sort()).toEqual(['Medicines', 'Passport', 'Tickets']);
    expect((await projectTasks(a.id)).find(t => t.title === 'Passport packed')).toMatchObject({ status: 'done' });
    expect((await projectTasks(a.id)).map(t => t.title).sort()).toEqual(['Extra bag', 'Passport packed']);
    expect((await projectTasks(b.id)).map(t => t.title).sort()).toEqual(['Chargers', 'Passports']);
    expect((await projectTasks(b.id)).every(t => t.status === 'open')).toBe(true);
    expect((await req('GET', '/api/task-templates')).json().templates).toEqual([updated.json()]);
  });

  it('rejects stale edits, invalid input and missing records without creating projects', async () => {
    const t = await template();
    expect((await req('PUT', `/api/task-templates/${t.id}`, { name: 'New name', entries: entries(['New task']), expected_revision: 1 })).statusCode).toBe(200);
    const stale = await req('PUT', `/api/task-templates/${t.id}`, { name: 'Stale name', entries: entries(['Old task']), expected_revision: 1 });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toEqual({ error: 'template_changed', current_revision: 2 });
    for (const payload of [
      { name: ' ', entries: entries(['One']) }, { name: 'Valid', entries: entries([]) },
      { name: 'Valid', entries: entries([' ']) }, { name: 'Valid', entries: entries(['x'.repeat(501)]) },
      { name: 'Valid', entries: entries(Array(201).fill('Task')) },
      { name: 'Valid', entries: entries(['One']), status: 'done' },
    ]) expect((await req('POST', '/api/task-templates', payload)).statusCode).toBe(400);
    const before = await getDb().select({ id: projects.id }).from(projects);
    expect((await req('POST', `/api/task-templates/${t.id}/projects`, { name: ' ' })).statusCode).toBe(400);
    expect((await req('POST', `/api/task-templates/${t.id}/projects`, { name: 'Bad domain', domain_id: randomUUID() })).statusCode).toBe(400);
    expect((await req('POST', `/api/task-templates/${randomUUID()}/projects`, { name: 'Missing' })).statusCode).toBe(404);
    expect((await req('POST', '/api/task-templates/nope/projects', { name: 'Invalid' })).statusCode).toBe(400);
    expect((await req('PUT', `/api/task-templates/${randomUUID()}`, { name: 'Missing', entries: entries(['One']), expected_revision: 1 })).statusCode).toBe(404);
    expect(await getDb().select({ id: projects.id }).from(projects)).toEqual(before);
    expect((await req('GET', '/api/task-templates')).json().templates[0]).toMatchObject({ name: 'New name', entries: [{ title: 'New task' }], revision: 2 });
  });

  it('routes tasks to the chosen domain without inheriting its direct-task workflow', async () => {
    const domainResponse = await req('POST', '/api/domains', { name: 'Trips' });
    expect(domainResponse.statusCode).toBe(201);
    const domain = domainResponse.json();
    const configured = await req('PUT', `/api/task-workflows/domain/${domain.id}`, { definition: BUILTIN_WORKFLOW_PRESETS[0]!.definition, expected_revision: 0 });
    expect(configured.statusCode).toBe(200);
    const t = await template();
    const project = await use(t.id, 'Family trip', { domain_id: domain.id });
    expect(project).toMatchObject({ domain_id: domain.id, kind: 'project', status: 'active', task_workflow: null });
    for (const task of await projectTasks(project.id)) expect(task).toMatchObject({ domain_id: domain.id, status: 'open', workflow_status_id: null });
  });

  it('rolls back the project and all tasks if any task insert fails', async () => {
    const t = await template();
    const db = getDb();
    await db.execute(`create function reject_template_test_task() returns trigger language plpgsql as $$ begin if new.title = 'Chargers' then raise exception 'test insert failure'; end if; return new; end $$`);
    await db.execute(`create trigger reject_template_test_task before insert on tasks for each row execute function reject_template_test_task()`);
    try {
      const response = await req('POST', `/api/task-templates/${t.id}/projects`, { name: 'Must roll back' });
      expect(response.statusCode).toBe(500);
      expect(await db.select().from(projects).where(eq(projects.name, 'Must roll back'))).toHaveLength(0);
      expect(await db.select().from(tasks)).toHaveLength(0);
    } finally {
      await db.execute('drop trigger reject_template_test_task on tasks');
      await db.execute('drop function reject_template_test_task()');
    }
  });

  it('deletes only the template and updates the work count, preserving generated projects and progress', async () => {
    const t = await template();
    const project = await use(t.id, 'Keep this project');
    const [task] = await projectTasks(project.id);
    await req('PATCH', `/api/tasks/${task!.id}`, { status: 'done', notes: 'Keep these notes' });
    const before = (await req('GET', `/api/projects/${project.id}`)).json();
    expect((await req('GET', '/api/work')).json().templatesCount).toBe(1);
    const response = await req('DELETE', `/api/task-templates/${t.id}`);
    expect(response.statusCode).toBe(204);
    expect(response.body).toBe('');
    expect((await req('GET', '/api/task-templates')).json().templates).toEqual([]);
    expect((await req('GET', '/api/work')).json().templatesCount).toBe(0);
    expect((await req('GET', `/api/projects/${project.id}`)).json()).toEqual(before);
    const missing = await req('DELETE', `/api/task-templates/${t.id}`);
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({ error: 'not_found' });
  });

  it('returns one template by id, and 404 or 400 for a missing or malformed id', async () => {
    const t = await template();
    const found = await req('GET', `/api/task-templates/${t.id}`);
    expect(found.statusCode).toBe(200);
    expect(found.json()).toEqual((await req('GET', '/api/task-templates')).json().templates[0]);
    const missing = await req('GET', `/api/task-templates/${randomUUID()}`);
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({ error: 'not_found' });
    expect((await req('GET', '/api/task-templates/not-a-uuid')).statusCode).toBe(400);
  });

  describe('starting a project from a template through project create', () => {
    const nested = () => {
      const [documents, passport, keys] = entries(['Documents', 'Passport', 'Keys']);
      return [documents!, { ...passport!, parent_key: documents!.key, notes: 'Check expiry' }, keys!];
    };
    const createTemplate = async () => (await req('POST', '/api/task-templates', { name: 'Flight', entries: nested() })).json();

    it('creates the project with all of its own fields and the copied tasks, in order and reset', async () => {
      const t = await createTemplate();
      const response = await req('POST', '/api/projects', { name: 'December trip', description: 'Two weeks away', target_date: '2026-12-20', type: 'internal', template_id: t.id });
      expect(response.statusCode).toBe(201);
      const project = response.json();
      // Fields the old "Use template" form could not set arrive with the tasks.
      expect(project).toMatchObject({ name: 'December trip', description: 'Two weeks away', target_date: '2026-12-20', type: 'internal', kind: 'project', status: 'active', task_workflow: null });
      expect(project).not.toHaveProperty('template_id');
      const detail = (await req('GET', `/api/projects/${project.id}`)).json();
      expect(detail.tasks.map((task: { title: string }) => task.title)).toEqual(['Documents', 'Passport', 'Keys']);
      const [documents, passport] = detail.tasks;
      expect(passport).toMatchObject({ parent_task_id: documents.id, notes: 'Check expiry', status: 'open', due_date: null, completed_at: null, source: 'manual' });
      // Same copy as the template's own endpoint, which still works.
      const viaTemplate = await use(t.id, 'Other trip');
      expect((await req('GET', `/api/projects/${viaTemplate.id}`)).json().tasks.map((task: { title: string }) => task.title)).toEqual(['Documents', 'Passport', 'Keys']);
    });

    it('puts tasks in the project domain: chosen, inherited from an asset, or Inbox', async () => {
      const t = await createTemplate();
      const domain = (await req('POST', '/api/domains', { name: 'Travel' })).json();
      const chosen = (await req('POST', '/api/projects', { name: 'Chosen', domain_id: domain.id, template_id: t.id })).json();
      for (const task of await projectTasks(chosen.id)) expect(task.domain_id).toBe(domain.id);
      const asset = await createAsset({ domain_id: domain.id });
      const inherited = (await req('POST', '/api/projects', { name: 'Inherited', asset_id: asset.id, template_id: t.id })).json();
      expect(inherited.domain_id).toBe(domain.id);
      for (const task of await projectTasks(inherited.id)) expect(task.domain_id).toBe(domain.id);
      const none = (await req('POST', '/api/projects', { name: 'No domain', template_id: t.id })).json();
      expect(none.domain_id).toBeNull();
      const loose = await projectTasks(none.id);
      expect(loose).toHaveLength(3);
      for (const task of loose) expect(task.domain_id).toBe(INBOX_DOMAIN_ID);
    });

    it('rejects an unknown template and a template on an area without creating anything', async () => {
      const t = await createTemplate();
      const missing = await req('POST', '/api/projects', { name: 'No such template', template_id: randomUUID() });
      expect(missing.statusCode).toBe(400);
      expect(missing.json()).toEqual({ error: 'template_not_found' });
      const area = await req('POST', '/api/projects', { name: 'An area', kind: 'area', template_id: t.id });
      expect(area.statusCode).toBe(400);
      expect(area.json()).toEqual({ error: 'template_requires_project' });
      expect((await req('POST', '/api/projects', { name: 'Bad id', template_id: 'nope' })).statusCode).toBe(400);
      const names = (await getDb().select({ name: projects.name }).from(projects)).map(row => row.name);
      expect(names).not.toEqual(expect.arrayContaining(['No such template', 'An area', 'Bad id']));
      expect(await getDb().select().from(tasks)).toHaveLength(0);
    });

    it('rolls back the project if any task insert fails', async () => {
      const t = await createTemplate();
      const db = getDb();
      await db.execute(`create function reject_template_test_task() returns trigger language plpgsql as $$ begin if new.title = 'Keys' then raise exception 'test insert failure'; end if; return new; end $$`);
      await db.execute(`create trigger reject_template_test_task before insert on tasks for each row execute function reject_template_test_task()`);
      try {
        const response = await req('POST', '/api/projects', { name: 'Must roll back too', template_id: t.id });
        expect(response.statusCode).toBe(500);
        expect(await db.select().from(projects).where(eq(projects.name, 'Must roll back too'))).toHaveLength(0);
        expect(await db.select().from(tasks)).toHaveLength(0);
      } finally {
        await db.execute('drop trigger reject_template_test_task on tasks');
        await db.execute('drop function reject_template_test_task()');
      }
    });

    it('ignores template_id on update: an existing project never gains template tasks', async () => {
      const t = await createTemplate();
      const [existing] = await getDb().insert(projects).values({ name: 'Existing', domain_id: INBOX_DOMAIN_ID }).returning();
      const response = await req('PATCH', `/api/projects/${existing!.id}`, { name: 'Renamed', template_id: t.id });
      expect(response.statusCode).toBe(200);
      expect(await projectTasks(existing!.id)).toHaveLength(0);
    });
  });

  it('requires authentication for every template operation', async () => {
    for (const [method, url, payload] of [
      ['GET', '/api/task-templates', undefined],
      ['GET', `/api/task-templates/${randomUUID()}`, undefined],
      ['DELETE', `/api/task-templates/${randomUUID()}`, undefined],
      ['POST', '/api/task-templates', { name: 'Test', entries: entries(['Task']) }],
      ['PUT', `/api/task-templates/${randomUUID()}`, { name: 'Test', entries: entries(['Task']), expected_revision: 1 }],
      ['POST', `/api/task-templates/${randomUUID()}/projects`, { name: 'Trip' }],
      ['POST', `/api/projects/${randomUUID()}/task-template`, { name: 'Trip' }],
    ] as const) {
      const response = await app.inject({ method, url, ...(payload ? { payload } : {}) });
      expect(response.statusCode).toBe(401);
    }
  });
});
