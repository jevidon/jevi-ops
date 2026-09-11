import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { buildServer } from '../src/server.js';
import { signSession } from '../src/lib/jwt.js';
import { getDb } from '../src/lib/db.js';
import { buildWork } from '../src/lib/work.js';
import { runMaintenanceSweep } from '../src/lib/maintenance-sweep.js';
import { projects, stewardship_domains, tasks } from '../src/db/schema.js';
import { INBOX, addReading, createAsset, createItem, daysFromToday, getItem, getTask, logsFor, tasksBySource, today } from './helpers.js';

// The findings of the 8 Sept 2026 review of PRs #40/#41, each pinned by a
// test: policy evidence, historical pins, generated-task reconciliation,
// routing that follows assignment, scope, facts patching, baselines.

let app: FastifyInstance;
let session: string;
let domainA: string;
let domainB: string;

beforeAll(async () => {
  app = await buildServer();
  await app.ready();
  session = await signSession({ id: '00000000-0000-0000-0000-000000000001', email: 'probe@test.local' });
});
afterAll(async () => {
  await app.close();
});
beforeEach(async () => {
  const rows = await getDb()
    .select({ id: stewardship_domains.id })
    .from(stewardship_domains)
    .where(eq(stewardship_domains.is_system, false))
    .limit(2);
  domainA = rows[0]!.id;
  domainB = rows[1]!.id;
  await getDb().delete(projects);
});

function req(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, body?: unknown) {
  return app.inject({ method, url, headers: { authorization: `Bearer ${session}` }, ...(body !== undefined ? { payload: body } : {}) });
}

describe('policy evidence (#7)', () => {
  it('an expiry renewal needs its new expiry; the interval is not a silent fallback', async () => {
    const item = await createItem({ policy: 'expiry', interval_meter: null, interval_months: 12, next_due_date: await daysFromToday(-1) });
    const bare = await req('POST', `/api/maintenance/${item.id}/complete`, {});
    expect(bare.statusCode).toBe(400);
    expect(bare.json()).toMatchObject({ error: 'needs_details', policy: 'expiry', fields: ['issued_until'] });
    expect(await logsFor(item.id)).toHaveLength(0);
    const past = await req('POST', `/api/maintenance/${item.id}/complete`, { issued_until: await daysFromToday(-2) });
    expect(past.statusCode).toBe(400);
    const ok = await req('POST', `/api/maintenance/${item.id}/complete`, { issued_until: '2027-03-31' });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().item.next_due_date).toBe('2027-03-31');
  });

  it('a prepaid licence needs its end distance; an inspection needs a finding or a next review', async () => {
    const asset = await createAsset();
    const ruc = await createItem({ asset_id: asset.id, policy: 'prepaid_meter', interval_months: null, interval_meter: null, next_due_meter: 100000 });
    expect((await req('POST', `/api/maintenance/${ruc.id}/complete`, { meter: 99000 })).statusCode).toBe(400);
    const bought = await req('POST', `/api/maintenance/${ruc.id}/complete`, { meter: 99000, purchased_to: 110000 });
    expect(bought.statusCode).toBe(200);
    expect(bought.json().item.next_due_meter).toBe(110000);

    const pads = await createItem({ asset_id: asset.id, policy: 'on_condition', interval_months: null, interval_meter: null, name: 'Brake pads' });
    const nothing = await req('POST', `/api/maintenance/${pads.id}/complete`, {});
    expect(nothing.statusCode).toBe(400);
    expect(nothing.json().fields).toEqual(['finding', 'next_review_on', 'next_review_meter']);
    const looked = await req('POST', `/api/maintenance/${pads.id}/complete`, { finding: 'pads at 40%', next_review_meter: 120000 });
    expect(looked.statusCode).toBe(200);
    expect(looked.json().item.next_due_meter).toBe(120000);
  });

  it('ticking the generated task of an expiry item is refused with needs_details and the task stays open', async () => {
    const asset = await createAsset({ domain_id: domainA });
    const item = await createItem({ asset_id: asset.id, policy: 'expiry', interval_meter: null, interval_months: null, next_due_date: await daysFromToday(-1) });
    await runMaintenanceSweep(getDb());
    const taskId = (await getItem(item.id)).generated_task_id!;
    const res = await req('PATCH', `/api/tasks/${taskId}`, { status: 'done' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'needs_details', item_id: item.id, policy: 'expiry', fields: ['issued_until'] });
    expect((await getTask(taskId))?.status).toBe('open');
    expect(await logsFor(item.id)).toHaveLength(0);
    expect((await getItem(item.id)).generated_task_id).toBe(taskId);
    // The form path with evidence closes it.
    const done = await req('POST', `/api/maintenance/${item.id}/complete`, { issued_until: '2027-06-30' });
    expect(done.statusCode).toBe(200);
    expect((await getTask(taskId))?.status).toBe('done');
  });
});

describe('historical entries never move current state (#8)', () => {
  it('older history preserves a manually pinned date — and a retry of it, and edits to it', async () => {
    const asset = await createAsset();
    const pinned = await daysFromToday(15);
    const item = await createItem({ asset_id: asset.id, interval_meter: null, baseline: { completed_on: await daysFromToday(-30) }, next_due_date: pinned });
    const r = await req('POST', `/api/maintenance/${item.id}/complete`, { completed_on: await daysFromToday(-60), event_key: 'old' });
    expect(r.json().historical).toBe(true);
    expect((await getItem(item.id)).next_due_date).toBe(pinned);
    // Retry of the same historical event: still history, still pinned.
    const again = await req('POST', `/api/maintenance/${item.id}/complete`, { completed_on: await daysFromToday(-60), event_key: 'old' });
    expect(again.json().logged).toBe(false);
    expect((await getItem(item.id)).next_due_date).toBe(pinned);
    // Editing / deleting the old entry: not the latest evidence → untouched.
    const oldLog = r.json().log.id;
    await req('PATCH', `/api/maintenance/${item.id}/logs/${oldLog}`, { notes: 'found the receipt', completed_on: await daysFromToday(-61) });
    expect((await getItem(item.id)).next_due_date).toBe(pinned);
    await req('DELETE', `/api/maintenance/${item.id}/logs/${oldLog}`);
    expect((await getItem(item.id)).next_due_date).toBe(pinned);
  });

  it('a meter pin survives older history; a real (latest) completion re-anchors', async () => {
    const asset = await createAsset();
    const item = await createItem({ asset_id: asset.id, baseline: { completed_on: await daysFromToday(-30), meter: 100000 }, next_due_meter: 150000 });
    await addReading(asset.id, 101000, await today());
    const r = await req('POST', `/api/maintenance/${item.id}/complete`, { completed_on: await daysFromToday(-90), meter: 90000, allow_decrease: true });
    expect(r.json().historical).toBe(true);
    expect((await getItem(item.id)).next_due_meter).toBe(150000);
    const latest = await req('POST', `/api/maintenance/${item.id}/complete`, { meter: 101500 });
    expect(latest.json().historical).toBe(false);
    expect((await getItem(item.id)).next_due_meter).toBe(106500);
  });
});

describe('generated tasks follow the occurrence (#9)', () => {
  it('pinning an overdue item out of the window retires its untouched task, inline', async () => {
    const asset = await createAsset({ domain_id: domainA });
    const item = await createItem({ asset_id: asset.id, interval_meter: null, next_due_date: await daysFromToday(-1) });
    await runMaintenanceSweep(getDb());
    const taskId = (await getItem(item.id)).generated_task_id!;
    const res = await req('PATCH', `/api/maintenance/${item.id}`, { next_due_date: await daysFromToday(180) });
    expect(res.statusCode).toBe(200);
    expect(await getTask(taskId)).toBeUndefined();
    expect(res.json().item.generated_task_id).toBeNull();
    expect((await runMaintenanceSweep(getDb())).created).toBe(0);
  });

  it('an annotated task is retargeted, not deleted — the note survives with a true date', async () => {
    const asset = await createAsset({ domain_id: domainA });
    const item = await createItem({ asset_id: asset.id, interval_meter: null, next_due_date: await daysFromToday(-1) });
    await runMaintenanceSweep(getDb());
    const taskId = (await getItem(item.id)).generated_task_id!;
    await getDb().update(tasks).set({ notes: 'ask the shop about the rattle' }).where(eq(tasks.id, taskId));
    const far = await daysFromToday(180);
    await req('PATCH', `/api/maintenance/${item.id}`, { next_due_date: far });
    const t = await getTask(taskId);
    expect(t?.status).toBe('open');
    expect(t?.due_date).toBe(far);
    expect(t?.notes).toBe('ask the shop about the rattle');
    expect(t?.source_ref).toBe(`maint:${item.id}:${far}:`);
    expect((await getItem(item.id)).generated_task_id).toBe(taskId);
  });

  it('a live task moves to the new occurrence when the item is rescheduled inside the window', async () => {
    const asset = await createAsset({ domain_id: domainA });
    const item = await createItem({ asset_id: asset.id, interval_meter: null, next_due_date: await daysFromToday(-1) });
    await runMaintenanceSweep(getDb());
    const taskId = (await getItem(item.id)).generated_task_id!;
    const soon = await daysFromToday(3);
    await req('PATCH', `/api/maintenance/${item.id}`, { next_due_date: soon });
    const t = await getTask(taskId);
    expect(t?.due_date).toBe(soon);
    expect(t?.source_ref).toBe(`maint:${item.id}:${soon}:`);
    expect(await tasksBySource()).toHaveLength(1);
  });

  it('renaming the item renames a machine-owned title; a person’s title is kept', async () => {
    const asset = await createAsset({ domain_id: domainA });
    const item = await createItem({ asset_id: asset.id, interval_meter: null, next_due_date: await daysFromToday(0) });
    await runMaintenanceSweep(getDb());
    const taskId = (await getItem(item.id)).generated_task_id!;
    expect((await getTask(taskId))?.title).toBe('Oil change — Test car');
    await req('PATCH', `/api/maintenance/${item.id}`, { name: 'Oil + filter' });
    expect((await getTask(taskId))?.title).toBe('Oil + filter — Test car');
    await getDb().update(tasks).set({ title: 'Oil (use the good stuff)' }).where(eq(tasks.id, taskId));
    await req('PATCH', `/api/maintenance/${item.id}`, { name: 'Oil service' });
    expect((await getTask(taskId))?.title).toBe('Oil (use the good stuff)');
  });

  it('the sweep repairs drift: a task left in the wrong domain is moved, one left out of window is retired', async () => {
    const asset = await createAsset({ domain_id: domainA });
    const item = await createItem({ asset_id: asset.id, interval_meter: null, next_due_date: await daysFromToday(-1) });
    await runMaintenanceSweep(getDb());
    const taskId = (await getItem(item.id)).generated_task_id!;
    await getDb().update(tasks).set({ domain_id: INBOX }).where(eq(tasks.id, taskId)); // drift
    const r1 = await runMaintenanceSweep(getDb());
    expect(r1.retargeted).toBe(1);
    expect((await getTask(taskId))?.domain_id).toBe(domainA);
    await getDb().update(tasks).set({ due_date: await daysFromToday(200) }).where(eq(tasks.id, taskId));
    const { maintenance_items } = await import('../src/db/schema.js');
    await getDb().update(maintenance_items).set({ next_due_date: await daysFromToday(200) }).where(eq(maintenance_items.id, item.id)); // drift
    const r2 = await runMaintenanceSweep(getDb());
    expect(r2.retired).toBe(1);
    expect(await getTask(taskId)).toBeUndefined();
  });
});

describe('routing follows assignment (#4, #9)', () => {
  it('assigning an asset moves its inherited projects, their tasks, and its generated tasks — overrides stay', async () => {
    const asset = await createAsset();
    const inherited = (await req('POST', '/api/projects', { name: 'Roof rack', asset_id: asset.id })).json();
    expect(inherited.domain_id).toBeNull();
    const override = (await req('POST', '/api/projects', { name: 'Sell the old tyres', asset_id: asset.id, domain_id: domainB })).json();
    const task = (await req('POST', '/api/tasks', { title: 'Measure the bars', project_id: inherited.id })).json();
    expect(task.domain_id).toBe(INBOX);
    const item = await createItem({ asset_id: asset.id, interval_meter: null, next_due_date: await daysFromToday(-1) });
    await runMaintenanceSweep(getDb());
    const genId = (await getItem(item.id)).generated_task_id!;
    expect((await getTask(genId))?.domain_id).toBe(INBOX);

    expect((await req('PATCH', `/api/assets/${asset.id}`, { domain_id: domainA })).statusCode).toBe(200);
    expect((await getDb().query.projects.findFirst({ where: eq(projects.id, inherited.id) }))?.domain_id).toBe(domainA);
    expect((await getDb().query.projects.findFirst({ where: eq(projects.id, override.id) }))?.domain_id).toBe(domainB);
    expect((await getTask(task.id))?.domain_id).toBe(domainA);
    expect((await getTask(genId))?.domain_id).toBe(domainA);
    const work = await buildWork(getDb());
    const dom = work.domains.concat(work.parked).find((d) => d.id === domainA)!;
    expect(dom.projects.some((p) => p.id === inherited.id)).toBe(true);

    // A → B: what followed keeps following; the override, already in B, is untouched.
    await req('PATCH', `/api/assets/${asset.id}`, { domain_id: domainB });
    expect((await getDb().query.projects.findFirst({ where: eq(projects.id, inherited.id) }))?.domain_id).toBe(domainB);
    expect((await getTask(task.id))?.domain_id).toBe(domainB);
    expect((await getTask(genId))?.domain_id).toBe(domainB);
    expect((await getDb().query.projects.findFirst({ where: eq(projects.id, override.id) }))?.domain_id).toBe(domainB);
    // B → unassigned: everything in the asset's domain follows it out. The
    // former override now sits in the asset's own domain, so it is "with the
    // asset" by the one rule there is (domain equality) and follows too.
    await req('PATCH', `/api/assets/${asset.id}`, { domain_id: null });
    expect((await getDb().query.projects.findFirst({ where: eq(projects.id, inherited.id) }))?.domain_id).toBeNull();
    expect((await getTask(task.id))?.domain_id).toBe(INBOX);
    expect((await getTask(genId))?.domain_id).toBe(INBOX);
    expect((await getDb().query.projects.findFirst({ where: eq(projects.id, override.id) }))?.domain_id).toBeNull();
  });

  it('a project routed to a different domain on purpose stays there when the asset moves elsewhere', async () => {
    const asset = await createAsset({ domain_id: domainA });
    const override = (await req('POST', '/api/projects', { name: 'Sell the old tyres', asset_id: asset.id, domain_id: domainB })).json();
    await req('PATCH', `/api/assets/${asset.id}`, { domain_id: null });
    expect((await getDb().query.projects.findFirst({ where: eq(projects.id, override.id) }))?.domain_id).toBe(domainB);
  });

  it('linking an existing domain-less project to an assigned asset routes it there', async () => {
    const asset = await createAsset({ domain_id: domainA });
    const p = (await req('POST', '/api/projects', { name: 'Loose', domain_id: null })).json();
    const res = await req('PATCH', `/api/projects/${p.id}`, { asset_id: asset.id });
    expect(res.json().domain_id).toBe(domainA);
  });

  it('renaming an asset renames the machine-owned task titles', async () => {
    const asset = await createAsset({ domain_id: domainA, name: 'Outback' });
    const item = await createItem({ asset_id: asset.id, interval_meter: null, next_due_date: await daysFromToday(0) });
    await runMaintenanceSweep(getDb());
    const taskId = (await getItem(item.id)).generated_task_id!;
    await req('PATCH', `/api/assets/${asset.id}`, { name: 'Subaru Outback' });
    expect((await getTask(taskId))?.title).toBe('Oil change — Subaru Outback');
  });
});

describe('one scope everywhere (#3)', () => {
  it('a paused item counts nowhere: card total 0, bundle tracked:false, due state kept for display', async () => {
    const asset = await createAsset({ domain_id: domainA });
    await createItem({ asset_id: asset.id, interval_meter: null, active: false, next_due_date: await daysFromToday(-1) });
    const work = await buildWork(getDb());
    const card = work.domains.concat(work.parked).flatMap((d) => d.assets).find((x) => x.id === asset.id)!;
    expect(card.maintenance.total).toBe(0);
    expect(card.urgency).toBe('quiet');
    const detail = (await req('GET', `/api/assets/${asset.id}`)).json();
    expect(detail.items).toHaveLength(1);
    expect(detail.items[0].tracked).toBe(false);
    expect(detail.items[0].due_state.status).toBe('overdue');
    const list = (await req('GET', '/api/maintenance?include_inactive=true')).json();
    expect(list.items.find((i: { id: string }) => i.id === detail.items[0].id).tracked).toBe(false);
  });

  it('items on a stored asset are untracked', async () => {
    const asset = await createAsset({ domain_id: domainA, lifecycle: 'stored' });
    await createItem({ asset_id: asset.id, interval_meter: null, next_due_date: await daysFromToday(-1) });
    const detail = (await req('GET', `/api/assets/${asset.id}`)).json();
    expect(detail.items[0].tracked).toBe(false);
  });
});

describe('facts patch with compare-and-set (#1, #2)', () => {
  it('sets, unsets, preserves untouched keys verbatim, and refuses a stale expectation', async () => {
    const asset = await createAsset({
      metadata: { serial: '001234', specs: { oil: { grade: '5W30' } }, model: { value: 'GX470', source: 'manual', verified: true } },
    });
    const ok = await req('PATCH', `/api/assets/${asset.id}`, {
      metadata_patch: { set: { make: { value: 'Lexus', expected: null } }, unset: {} },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().asset.metadata).toEqual({
      serial: '001234',
      specs: { oil: { grade: '5W30' } },
      model: { value: 'GX470', source: 'manual', verified: true },
      make: 'Lexus',
    });
    // An agent changes model meanwhile; a human's edit built on the old value conflicts.
    await req('PATCH', `/api/assets/${asset.id}`, { metadata_patch: { set: { model: { value: { value: 'GX460', source: 'agent' } } } } });
    const stale = await req('PATCH', `/api/assets/${asset.id}`, {
      metadata_patch: { set: { model: { value: 'GX470 Sport', expected: { value: 'GX470', source: 'manual', verified: true } } } },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ error: 'fact_conflict', keys: ['model'] });
    const current = (await req('GET', `/api/assets/${asset.id}`)).json().asset.metadata;
    expect(current.model).toEqual({ value: 'GX460', source: 'agent' });
    // Unset with the right expectation; a numeric expectation vs string is a mismatch.
    const gone = await req('PATCH', `/api/assets/${asset.id}`, { metadata_patch: { unset: { make: { expected: 'Lexus' } } } });
    expect(gone.statusCode).toBe(200);
    expect(gone.json().asset.metadata.make).toBeUndefined();
    const typed = await req('PATCH', `/api/assets/${asset.id}`, { metadata_patch: { set: { serial: { value: 'x', expected: 1234 } } } });
    expect(typed.statusCode).toBe(409);
  });
});

describe('baseline action', () => {
  it('sets seed evidence on an evidence-less item, edits it, and never outranks a later completion', async () => {
    const asset = await createAsset();
    const item = await createItem({ asset_id: asset.id });
    expect(item.next_due_meter).toBeNull();
    const set = await req('POST', `/api/maintenance/${item.id}/baseline`, { completed_on: '2026-06-01', meter: 100000 });
    expect(set.statusCode).toBe(200);
    expect(set.json().log.is_baseline).toBe(true);
    expect(set.json().item.next_due_date).toBe('2026-12-01');
    expect(set.json().item.next_due_meter).toBe(105000);
    const edit = await req('POST', `/api/maintenance/${item.id}/baseline`, { completed_on: '2026-07-01', meter: 101000 });
    expect(edit.json().log.id).toBe(set.json().log.id);
    expect(edit.json().item.next_due_meter).toBe(106000);
    expect((await logsFor(item.id)).filter((l) => l.is_baseline)).toHaveLength(1);
    // A later completion is the latest evidence; moving the baseline moves nothing.
    await req('POST', `/api/maintenance/${item.id}/complete`, { meter: 110000 });
    const older = await req('POST', `/api/maintenance/${item.id}/baseline`, { completed_on: '2026-05-01', meter: 90000 });
    expect(older.statusCode).toBe(200);
    expect(older.json().item.next_due_meter).toBe(115000);
    expect((await req('POST', `/api/maintenance/${item.id}/baseline`, { completed_on: await daysFromToday(3) })).statusCode).toBe(400);
  });
});
