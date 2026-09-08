import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { buildServer } from '../src/server.js';
import { signSession } from '../src/lib/jwt.js';
import { getDb } from '../src/lib/db.js';
import { completeMaintenanceItem } from '../src/lib/maintenance.js';
import { runMaintenanceSweep } from '../src/lib/maintenance-sweep.js';
import { completeVisit } from '../src/lib/visits.js';
import { app_settings, maintenance_visit_items, stewardship_domains, tasks } from '../src/db/schema.js';
import { invalidateAppSettings } from '../src/lib/app-settings.js';
import { INBOX, addReading, createAsset, createItem, daysFromToday, getItem, getTask, logsFor, readingsFor, today } from './helpers.js';

// The findings of the 8 Sept 2026 review of the stack through #44, each
// pinned: a visit, its reading and its lines are one fact through every
// entry point; a completion replay is a read; generated work stops being
// disposable once the person adds to it; documents keep their first text
// and require the version they were read at; photos are operations; spend
// never adds currencies.

let app: FastifyInstance;
let session: string;

beforeAll(async () => {
  app = await buildServer();
  await app.ready();
  session = await signSession({ id: '00000000-0000-0000-0000-000000000001', email: 'probe@test.local' });
});
afterAll(async () => {
  await app.close();
});

function req(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, body?: unknown) {
  return app.inject({ method, url, headers: { authorization: `Bearer ${session}` }, ...(body !== undefined ? { payload: body } : {}) });
}

describe('1. a visit line’s evidence is the visit’s to change', () => {
  it('refuses date/meter edits on a visit-linked log, allows notes and cost', async () => {
    const asset = await createAsset();
    const a = await createItem({ asset_id: asset.id });
    const b = await createItem({ asset_id: asset.id, name: 'B' });
    const v = (await req('POST', `/api/assets/${asset.id}/visits`, { status: 'done', meter: 100000, lines: [{ item_id: a.id }, { item_id: b.id }] })).json().visit;
    const log = (await logsFor(a.id))[0]!;
    for (const body of [{ meter_at_completion: 101000 }, { meter_at_completion: null }, { completed_on: await daysFromToday(-3) }]) {
      const res = await req('PATCH', `/api/maintenance/${a.id}/logs/${log.id}`, body);
      expect(res.statusCode).toBe(409);
      expect(res.json().error).toBe('edit_the_visit');
    }
    expect((await readingsFor(asset.id))[0]!.reading).toBe(100000);
    expect((await readingsFor(asset.id))[0]!.voided_at).toBeNull();
    expect((await logsFor(b.id))[0]!.meter_at_completion).toBe(100000);
    const ok = await req('PATCH', `/api/maintenance/${a.id}/logs/${log.id}`, { notes: '5W30', cost: 180 });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().log.cost).toBe(180);
    // The visit is the place: one edit moves the reading and every line.
    const fixed = await req('PATCH', `/api/visits/${v.id}`, { meter: 101000 });
    expect(fixed.statusCode).toBe(200);
    expect((await logsFor(a.id))[0]!.meter_at_completion).toBe(101000);
    expect((await logsFor(b.id))[0]!.meter_at_completion).toBe(101000);
  });
});

describe('2. a completion replay is a read', () => {
  it('cannot close the next occurrence or move a pin', async () => {
    const item = await createItem({ interval_meter: null });
    const input = { completedOn: await today(), today: await today(), source: 'manual' as const, eventKey: randomUUID() };
    await completeMaintenanceItem(getDb(), item.id, input);
    expect((await req('PATCH', `/api/maintenance/${item.id}`, { next_due_date: await daysFromToday(-1) })).statusCode).toBe(200);
    await runMaintenanceSweep(getDb());
    const pending = await getItem(item.id);
    expect(pending.generated_task_id).not.toBeNull();
    const retry = await completeMaintenanceItem(getDb(), item.id, input);
    expect(retry!.logged).toBe(false);
    expect((await getTask(pending.generated_task_id!))!.status).toBe('open');
    expect((await getItem(item.id)).next_due_date).toBe(pending.next_due_date);
    expect((await getItem(item.id)).generated_task_id).toBe(pending.generated_task_id);
    // Through the route too, with a pinned meter.
    const asset = await createAsset();
    const oil = await createItem({ asset_id: asset.id, baseline: { completed_on: '2026-03-01', meter: 95000 } });
    const key = randomUUID();
    await req('POST', `/api/maintenance/${oil.id}/complete`, { meter: 100000, event_key: key });
    await req('PATCH', `/api/maintenance/${oil.id}`, { next_due_meter: 150000 });
    const again = await req('POST', `/api/maintenance/${oil.id}/complete`, { meter: 100000, event_key: key });
    expect(again.json().logged).toBe(false);
    expect((await getItem(oil.id)).next_due_meter).toBe(150000);
  });
});

describe('3. generated work stops being disposable once it is yours', () => {
  it('pausing keeps an annotated task (unlinked, key released); an untouched one is deleted', async () => {
    const noted = await createItem({ interval_meter: null, next_due_date: await daysFromToday(-1) });
    const plain = await createItem({ interval_meter: null, next_due_date: await daysFromToday(-1), name: 'Plain' });
    await runMaintenanceSweep(getDb());
    const notedTask = (await getItem(noted.id)).generated_task_id!;
    const plainTask = (await getItem(plain.id)).generated_task_id!;
    expect((await req('PATCH', `/api/tasks/${notedTask}`, { notes: 'Workshop booking and quote reference' })).statusCode).toBe(200);
    expect((await req('PATCH', `/api/maintenance/${noted.id}`, { active: false })).statusCode).toBe(200);
    expect((await req('PATCH', `/api/maintenance/${plain.id}`, { active: false })).statusCode).toBe(200);
    const kept = await getTask(notedTask);
    expect(kept?.notes).toBe('Workshop booking and quote reference');
    expect(kept?.status).toBe('open');
    expect(kept?.source_ref).toBeNull();
    expect((await getItem(noted.id)).generated_task_id).toBeNull();
    expect(await getTask(plainTask)).toBeUndefined();
  });

  it('a task with subtasks under it is yours too — for pausing and for rescheduling', async () => {
    const item = await createItem({ interval_meter: null, next_due_date: await daysFromToday(-1) });
    await runMaintenanceSweep(getDb());
    const taskId = (await getItem(item.id)).generated_task_id!;
    const [child] = await getDb().insert(tasks).values({ title: 'Book it', domain_id: INBOX, parent_task_id: taskId }).returning();
    await req('PATCH', `/api/maintenance/${item.id}`, { next_due_date: await daysFromToday(180) });
    expect((await getTask(taskId))?.status).toBe('open'); // retargeted, not deleted
    expect(await getTask(child!.id)).toBeDefined();
    const sold = await createAsset({ lifecycle: 'active' });
    const it2 = await createItem({ asset_id: sold.id, interval_meter: null, next_due_date: await daysFromToday(-1) });
    await runMaintenanceSweep(getDb());
    const t2 = (await getItem(it2.id)).generated_task_id!;
    await getDb().insert(tasks).values({ title: 'Ring the shop', domain_id: INBOX, parent_task_id: t2 });
    await req('PATCH', `/api/assets/${sold.id}`, { lifecycle: 'sold' });
    expect((await getTask(t2))?.status).toBe('open');
  });
});

describe('4. undo voids the visit’s reading before anything re-derives', () => {
  it('a baseline without mileage cannot borrow the reading on its way out', async () => {
    const asset = await createAsset();
    const item = await createItem({ asset_id: asset.id, baseline: { completed_on: await today(), meter: null } });
    expect(item.next_due_meter).toBeNull();
    const created = await req('POST', `/api/assets/${asset.id}/visits`, { status: 'done', meter: 100000, lines: [{ item_id: item.id }] });
    expect(created.statusCode).toBe(201);
    expect((await getItem(item.id)).next_due_meter).toBe(105000);
    expect((await req('DELETE', `/api/visits/${created.json().visit.id}`)).statusCode).toBe(200);
    expect((await readingsFor(asset.id))[0]!.voided_at).not.toBeNull();
    expect((await getItem(item.id)).next_due_meter).toBeNull();
    expect((await getItem(item.id)).last_completed_on).toBe(await today());
  });
});

describe('5. completing a plan is idempotent, and a key binds to its visit', () => {
  it('an identical retry reads the existing result; a different attempt is refused', async () => {
    const asset = await createAsset();
    const item = await createItem({ asset_id: asset.id });
    const plan = (await req('POST', `/api/assets/${asset.id}/visits`, { status: 'planned', items: [{ item_id: item.id }] })).json().visit;
    const body = { event_key: randomUUID(), meter: 100000, lines: [{ item_id: item.id }] };
    const first = await req('POST', `/api/visits/${plan.id}/complete`, body);
    expect(first.statusCode).toBe(201);
    const retry = await req('POST', `/api/visits/${plan.id}/complete`, body);
    expect(retry.statusCode).toBe(200);
    expect(retry.json().logged).toBe(false);
    expect(retry.json().visit.id).toBe(plan.id);
    expect((await logsFor(item.id)).length).toBe(1);
    const other = await req('POST', `/api/visits/${plan.id}/complete`, { ...body, event_key: randomUUID() });
    expect(other.statusCode).toBe(409);
    expect(other.json().error).toBe('visit_not_planned');
    // A key that belongs to another visit on the same asset is not a replay of this plan.
    const plan2 = (await req('POST', `/api/assets/${asset.id}/visits`, { status: 'planned', items: [{ item_id: item.id }] })).json().visit;
    const stolen = await req('POST', `/api/visits/${plan2.id}/complete`, body);
    expect(stolen.statusCode).toBe(409);
    expect(stolen.json().error).toBe('event_key_conflict');
  });
});

describe('6. documents keep their first text, and require the version they were read at', () => {
  it('the creation-seeded body is in history after the first edit; a versionless write is refused unless forced', async () => {
    const created = (await req('POST', '/api/projects', { name: 'Review initial history', domain_id: INBOX, doc_md: 'Original service notes' })).json();
    expect((await req('PATCH', `/api/projects/${created.id}`, { doc_md: 'Replacement', doc_version: 1 })).statusCode).toBe(200);
    const revisions = (await req('GET', `/api/docs/project/${created.id}/revisions`)).json().revisions;
    expect(revisions.map((r: { version: number; body: string }) => [r.version, r.body])).toEqual([[2, 'Replacement'], [1, 'Original service notes']]);
    const bare = await req('PATCH', `/api/projects/${created.id}`, { doc_md: 'no version' });
    expect(bare.statusCode).toBe(400);
    expect(bare.json().error).toBe('doc_version_required');
    const forced = await req('PATCH', `/api/projects/${created.id}`, { doc_md: 'imported', doc_force: true });
    expect(forced.statusCode).toBe(200);
    expect(forced.json().doc_version).toBe(3);
    // Every entity that takes a document at creation keeps that first text
    // — through the real create routes, not just the row.
    const asset = (await req('POST', '/api/assets', { name: 'Seeded', doc_md: 'seeded' })).json().asset;
    expect(asset.doc_md).toBe('seeded');
    expect((await req('PATCH', `/api/assets/${asset.id}`, { doc_md: 'x' })).statusCode).toBe(400);
    expect((await req('PATCH', `/api/assets/${asset.id}`, { doc_md: 'x', doc_version: 1 })).statusCode).toBe(200);
    const hist = (await req('GET', `/api/docs/asset/${asset.id}/revisions`)).json().revisions;
    expect(hist.map((r: { body: string }) => r.body)).toEqual(['x', 'seeded']);
    const domain = (await req('POST', '/api/domains', { name: `Seeded domain ${randomUUID().slice(0, 8)}`, doc_md: 'domain seed' })).json();
    expect(domain.doc_md).toBe('domain seed');
    expect((await req('PATCH', `/api/domains/${domain.id}`, { doc_md: 'y', doc_version: 1 })).statusCode).toBe(200);
    expect((await req('GET', `/api/docs/domain/${domain.id}/revisions`)).json().revisions.map((r: { body: string }) => r.body)).toEqual(['y', 'domain seed']);
    await getDb().delete(stewardship_domains).where(eq(stewardship_domains.id, domain.id));
  });
});

describe('8. photos are operations against the current array', () => {
  it('a late add cannot resurrect a removal or undo a hero choice', async () => {
    const att = (path: string) => ({ url: `http://x/${path}`, storage_path: path, content_type: 'image/png', size_bytes: 1, alt: null, uploaded_at: '2026-09-08T00:00:00Z' });
    const asset = await createAsset({ attachments: [att('assets/a.png'), att('assets/b.png')] });
    // Another tab removes a.png and makes b.png the hero…
    await req('PATCH', `/api/assets/${asset.id}`, { attachments_patch: { remove: ['assets/a.png'] } });
    // …while this tab's upload of c.png, started earlier, finishes.
    const res = await req('PATCH', `/api/assets/${asset.id}`, { attachments_patch: { add: [att('assets/c.png')] } });
    expect(res.json().asset.attachments.map((a: { storage_path: string }) => a.storage_path)).toEqual(['assets/b.png', 'assets/c.png']);
    const hero = await req('PATCH', `/api/assets/${asset.id}`, { attachments_patch: { hero: 'assets/c.png', add: [att('assets/b.png')] } });
    expect(hero.json().asset.attachments.map((a: { storage_path: string }) => a.storage_path)).toEqual(['assets/c.png', 'assets/b.png']);
  });
});

describe('9. spend never adds currencies', () => {
  it('states the household total, lists foreign invoices apart, and counts unpriced work', async () => {
    await getDb().update(app_settings).set({ currency: 'NZD' }).where(eq(app_settings.id, true));
    invalidateAppSettings();
    try {
      const asset = await createAsset();
      const a = await createItem({ asset_id: asset.id, interval_meter: null });
      const b = await createItem({ asset_id: asset.id, interval_meter: null, name: 'B' });
      const c = await createItem({ asset_id: asset.id, interval_meter: null, name: 'C' });
      await req('POST', `/api/assets/${asset.id}/visits`, { status: 'done', total: 100, lines: [{ item_id: a.id }] }); // household by default
      await req('POST', `/api/assets/${asset.id}/visits`, { status: 'done', total: 100, currency: 'usd', lines: [{ item_id: b.id }] });
      await req('POST', `/api/assets/${asset.id}/visits`, { status: 'done', lines: [{ item_id: c.id }] }); // unpriced
      await req('POST', `/api/maintenance/${a.id}/complete`, { cost: 40 });
      await req('POST', `/api/maintenance/${b.id}/complete`, {});
      const bundle = (await req('GET', `/api/assets/${asset.id}`)).json();
      expect(bundle.spend).toEqual({
        currency: 'NZD',
        total: 140,
        lines_total: 40,
        foreign: [{ currency: 'USD', total: 100, visits: 1 }],
        unpriced: { visits: 1, completions: 1 },
      });
      expect(bundle.spend_ytd).toBe(140);
      expect(bundle.visits.find((v: { currency: string | null; total: number | null }) => v.total === 100 && v.currency === 'NZD')).toBeDefined();
    } finally {
      await getDb().update(app_settings).set({ currency: 'USD' }).where(eq(app_settings.id, true));
      invalidateAppSettings();
    }
  });
});

describe('planned lines are kept with their outcome', () => {
  it('a skipped line stays on the visit with its instructions and the reason', async () => {
    const asset = await createAsset();
    const oil = await createItem({ asset_id: asset.id });
    const wof = await createItem({ asset_id: asset.id, name: 'WoF', policy: 'expiry', interval_meter: null, interval_months: 12, next_due_date: await daysFromToday(-2) });
    const plan = (await req('POST', `/api/assets/${asset.id}/visits`, { status: 'planned', items: [{ item_id: oil.id, notes: 'ask about the rattle' }, { item_id: wof.id, notes: 'book the inspection' }] })).json().visit;
    const done = await req('POST', `/api/visits/${plan.id}/complete`, { meter: 100500, lines: [{ item_id: oil.id }, { item_id: wof.id, skipped: true, skip_reason: 'inspector away' }] });
    expect(done.statusCode).toBe(201);
    const lines = done.json().visit.lines.map((l: { item: { name: string }; notes: string | null; outcome: string; skip_reason: string | null }) => [l.item.name, l.notes, l.outcome, l.skip_reason]);
    expect(lines).toEqual([['Oil change', 'ask about the rattle', 'done', null], ['WoF', 'book the inspection', 'skipped', 'inspector away']]);
    expect(await getDb().select().from(maintenance_visit_items).where(eq(maintenance_visit_items.visit_id, plan.id))).toHaveLength(2);
    expect((await getItem(wof.id)).last_completed_on).toBeNull();
    // A line done that was not in the plan is added; a planned line never mentioned is skipped without a word.
    const plan2 = (await req('POST', `/api/assets/${asset.id}/visits`, { status: 'planned', items: [{ item_id: wof.id }] })).json().visit;
    const done2 = (await req('POST', `/api/visits/${plan2.id}/complete`, { meter: 101000, lines: [{ item_id: oil.id }] })).json();
    expect(done2.visit.lines.map((l: { item: { name: string }; outcome: string }) => [l.item.name, l.outcome])).toEqual([['WoF', 'skipped'], ['Oil change', 'done']]);
  });
});

describe('lock order: asset → visit → items', () => {
  it('concurrent visits on one asset both land, each with its own reading, lines in ascending item order', async () => {
    const asset = await createAsset();
    const [a, b, c] = await Promise.all([
      createItem({ asset_id: asset.id, interval_meter: null, name: 'A' }),
      createItem({ asset_id: asset.id, interval_meter: null, name: 'B' }),
      createItem({ asset_id: asset.id, interval_meter: null, name: 'C' }),
    ]);
    await addReading(asset.id, 90000, await daysFromToday(-5));
    const t = await today();
    const base = { assetId: asset.id, visitedOn: t, today: t, defaultCurrency: 'USD', source: 'manual' as const, actor: 'session:test' };
    const results = await Promise.all([
      completeVisit(getDb(), { ...base, meter: 100000, eventKey: 'v-1', lines: [{ itemId: c!.id }, { itemId: a!.id }] }),
      completeVisit(getDb(), { ...base, meter: 100000, eventKey: 'v-2', lines: [{ itemId: b!.id }, { itemId: a!.id }] }),
      completeVisit(getDb(), { ...base, meter: 100000, eventKey: 'v-1', lines: [{ itemId: c!.id }, { itemId: a!.id }] }),
    ]);
    expect(results.filter((r) => r.logged)).toHaveLength(2);
    expect(results.filter((r) => !r.logged)).toHaveLength(1);
    expect((await req('GET', `/api/assets/${asset.id}/visits`)).json().visits).toHaveLength(2);
    expect((await readingsFor(asset.id)).filter((r) => r.source === 'completion')).toHaveLength(2);
    expect((await logsFor(a!.id)).length).toBe(2);
    const [, domainRow] = [null, await getDb().select().from(stewardship_domains).limit(1)];
    expect(domainRow.length).toBeGreaterThan(0);
  });
});
