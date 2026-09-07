import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { buildServer } from '../src/server.js';
import { signSession } from '../src/lib/jwt.js';
import { getDb } from '../src/lib/db.js';
import { runMaintenanceSweep } from '../src/lib/maintenance-sweep.js';
import { maintenance_visit_items } from '../src/db/schema.js';
import { addReading, createAsset, createItem, daysFromToday, getItem, getTask, logsFor, readingsFor, today } from './helpers.js';

// Service visits (0051): one event — several items on one odometer with
// one invoice — recorded in one transaction; plans; undo; corrections that
// keep the visit, its reading, and its lines as one fact.

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

async function carWithTwoDueItems() {
  const asset = await createAsset({ name: 'Outback' });
  const oil = await createItem({ asset_id: asset.id, name: 'Oil', baseline: { completed_on: '2026-03-01', meter: 95000 } });
  const wof = await createItem({ asset_id: asset.id, name: 'WoF', policy: 'expiry', interval_meter: null, interval_months: 12, next_due_date: await daysFromToday(-2) });
  await addReading(asset.id, 100200, await daysFromToday(-1));
  await runMaintenanceSweep(getDb());
  return { asset, oil: await getItem(oil.id), wof: await getItem(wof.id) };
}

describe('a done visit', () => {
  it('records the odometer once, completes every line through the one path, and keeps invoice and lines apart', async () => {
    const { asset, oil, wof } = await carWithTwoDueItems();
    expect(oil.generated_task_id).not.toBeNull();
    expect(wof.generated_task_id).not.toBeNull();
    const t = await today();
    const res = await req('POST', `/api/assets/${asset.id}/visits`, {
      status: 'done',
      visited_on: t,
      meter: 100500,
      provider: 'Toyota Botany',
      invoice_number: 'INV-77',
      currency: 'nzd',
      total: 420,
      notes: 'rattle is the heat shield',
      lines: [
        { item_id: oil.id, cost: 180, notes: '5W30' },
        { item_id: wof.id, issued_until: '2027-09-01', cost: 65 },
      ],
    });
    expect(res.statusCode).toBe(201);
    const visit = res.json().visit;
    expect(visit.status).toBe('done');
    expect(visit.currency).toBe('NZD');
    expect(visit.logs).toHaveLength(2);

    // One reading, shared by both lines and the visit.
    const readings = (await readingsFor(asset.id)).filter((r) => r.source === 'completion');
    expect(readings).toHaveLength(1);
    expect(readings[0]!.reading).toBe(100500);
    expect(visit.reading_id).toBe(readings[0]!.id);
    for (const item of [oil, wof]) {
      const logs = (await logsFor(item.id)).filter((l) => !l.is_baseline);
      expect(logs).toHaveLength(1);
      expect(logs[0]!.visit_id).toBe(visit.id);
      expect(logs[0]!.reading_id).toBe(readings[0]!.id);
      expect(logs[0]!.meter_at_completion).toBe(100500);
      expect((await getTask((await getItem(item.id)).generated_task_id ?? item.generated_task_id!))?.status ?? 'done').toBe('done');
    }
    expect((await getItem(oil.id)).next_due_meter).toBe(105500);
    expect((await getItem(wof.id)).next_due_date).toBe('2027-09-01');

    const bundle = (await req('GET', `/api/assets/${asset.id}`)).json();
    expect(bundle.spend_ytd).toBe(420); // the invoice
    expect(bundle.cost_ytd).toBe(245); // the allocated lines
    expect(bundle.visits[0].logs.map((l: { item: { name: string } }) => l.item.name).sort()).toEqual(['Oil', 'WoF']);
  });

  it('refuses a line missing its evidence before anything is written', async () => {
    const { asset, oil, wof } = await carWithTwoDueItems();
    const res = await req('POST', `/api/assets/${asset.id}/visits`, {
      status: 'done',
      meter: 100500,
      lines: [{ item_id: oil.id }, { item_id: wof.id }],
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'needs_details', item_id: wof.id, item_name: 'WoF', fields: ['issued_until'] });
    expect((await req('GET', `/api/assets/${asset.id}/visits`)).json().visits).toHaveLength(0);
    expect((await readingsFor(asset.id)).filter((r) => r.source === 'completion')).toHaveLength(0);
    expect((await logsFor(oil.id)).filter((l) => !l.is_baseline)).toHaveLength(0);
  });

  it('is idempotent on event_key; the same key on another asset conflicts', async () => {
    const { asset, oil } = await carWithTwoDueItems();
    const body = { status: 'done', meter: 100500, event_key: 'visit-1', lines: [{ item_id: oil.id }] };
    const a = await req('POST', `/api/assets/${asset.id}/visits`, body);
    const b = await req('POST', `/api/assets/${asset.id}/visits`, body);
    expect(a.statusCode).toBe(201);
    expect(b.statusCode).toBe(200);
    expect(b.json().logged).toBe(false);
    expect(b.json().visit.id).toBe(a.json().visit.id);
    expect((await readingsFor(asset.id)).filter((r) => r.source === 'completion')).toHaveLength(1);
    const other = await createAsset({ name: 'Other' });
    const otherItem = await createItem({ asset_id: other.id, interval_meter: null });
    const c = await req('POST', `/api/assets/${other.id}/visits`, { status: 'done', event_key: 'visit-1', lines: [{ item_id: otherItem.id }] });
    expect(c.statusCode).toBe(409);
  });

  it('rejects a line that is not on the asset', async () => {
    const { asset } = await carWithTwoDueItems();
    const stranger = await createItem({ interval_meter: null });
    const res = await req('POST', `/api/assets/${asset.id}/visits`, { status: 'done', lines: [{ item_id: stranger.id }] });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('item_not_on_asset');
  });
});

describe('a planned visit', () => {
  it('is a saved work order; completing it uses the plan, and a skipped line stays due', async () => {
    const { asset, oil, wof } = await carWithTwoDueItems();
    const plan = await req('POST', `/api/assets/${asset.id}/visits`, {
      status: 'planned',
      planned_on: await daysFromToday(3),
      provider: 'Toyota Botany',
      items: [{ item_id: oil.id, notes: 'ask about the rattle' }, { item_id: wof.id }],
    });
    expect(plan.statusCode).toBe(201);
    expect(plan.json().visit.lines.map((l: { item: { name: string }; notes: string | null }) => [l.item.name, l.notes])).toEqual([['Oil', 'ask about the rattle'], ['WoF', null]]);

    const done = await req('POST', `/api/visits/${plan.json().visit.id}/complete`, {
      meter: 100500,
      total: 200,
      lines: [{ item_id: oil.id, cost: 200 }, { item_id: wof.id, skipped: true }],
    });
    expect(done.statusCode).toBe(201);
    expect(done.json().visit.status).toBe('done');
    expect(done.json().visit.provider).toBe('Toyota Botany'); // carried from the plan
    expect(done.json().visit.lines).toHaveLength(0); // the plan's lines are cleared…
    expect(done.json().visit.logs).toHaveLength(1); // …the logs are the record
    expect(await getDb().select().from(maintenance_visit_items).where(eq(maintenance_visit_items.visit_id, plan.json().visit.id))).toHaveLength(0);
    const skipped = await getItem(wof.id);
    expect(skipped.last_completed_on).toBeNull();
    expect((await getTask(skipped.generated_task_id!))?.status).toBe('open');
    expect((await req('POST', `/api/visits/${plan.json().visit.id}/complete`, { lines: [{ item_id: oil.id }] })).statusCode).toBe(409);
  });

  it('can be edited (date, provider, lines) and removed', async () => {
    const { asset, oil, wof } = await carWithTwoDueItems();
    const plan = (await req('POST', `/api/assets/${asset.id}/visits`, { status: 'planned', items: [{ item_id: oil.id }] })).json().visit;
    const edited = await req('PATCH', `/api/visits/${plan.id}`, { planned_on: await daysFromToday(5), provider: 'Me', items: [{ item_id: wof.id }, { item_id: oil.id }] });
    expect(edited.statusCode).toBe(200);
    expect(edited.json().visit.provider).toBe('Me');
    expect(edited.json().visit.lines.map((l: { item: { name: string } }) => l.item.name)).toEqual(['WoF', 'Oil']);
    const gone = await req('DELETE', `/api/visits/${plan.id}`);
    expect(gone.json()).toEqual({ deleted: true, logs_removed: 0 });
    expect((await req('GET', `/api/assets/${asset.id}/visits`)).json().visits).toHaveLength(0);
  });
});

describe('undo and corrections keep the visit as one fact', () => {
  it('undoing a visit takes every line out and voids the single reading', async () => {
    const { asset, oil, wof } = await carWithTwoDueItems();
    const before = { oil: (await getItem(oil.id)).next_due_meter, wof: (await getItem(wof.id)).next_due_date };
    const v = (await req('POST', `/api/assets/${asset.id}/visits`, {
      status: 'done', meter: 100500, total: 400, lines: [{ item_id: oil.id }, { item_id: wof.id, issued_until: '2027-09-01' }],
    })).json().visit;
    const undo = await req('DELETE', `/api/visits/${v.id}`);
    expect(undo.json()).toEqual({ deleted: true, logs_removed: 2 });
    expect((await logsFor(oil.id)).filter((l) => !l.is_baseline)).toHaveLength(0);
    // Oil has a baseline: the schedule re-derives back to it. WoF had only
    // a pin (no evidence): undo re-derives from what remains — the issued
    // expiry is gone and the pin, never evidence, does not return.
    expect((await getItem(oil.id)).next_due_meter).toBe(before.oil);
    const wofAfter = await getItem(wof.id);
    expect(wofAfter.last_completed_on).toBeNull();
    expect(wofAfter.next_due_date).not.toBe('2027-09-01');
    expect(before.wof).not.toBeNull();
    const readings = (await readingsFor(asset.id)).filter((r) => r.source === 'completion');
    expect(readings).toHaveLength(1);
    expect(readings[0]!.voided_at).not.toBeNull();
    expect((await req('GET', `/api/assets/${asset.id}`)).json().spend_ytd).toBe(0);
  });

  it('correcting the visit odometer moves the reading and every line, and re-derives the schedules', async () => {
    const { asset, oil, wof } = await carWithTwoDueItems();
    const v = (await req('POST', `/api/assets/${asset.id}/visits`, {
      status: 'done', meter: 100500, lines: [{ item_id: oil.id }, { item_id: wof.id, issued_until: '2027-09-01' }],
    })).json().visit;
    const fixed = await req('PATCH', `/api/visits/${v.id}`, { meter: 101000, provider: 'Corrected Motors' });
    expect(fixed.statusCode).toBe(200);
    expect(fixed.json().visit.meter).toBe(101000);
    expect(fixed.json().visit.provider).toBe('Corrected Motors');
    const live = (await readingsFor(asset.id)).filter((r) => r.source === 'completion' && !r.voided_at);
    expect(live).toHaveLength(1);
    expect(live[0]!.reading).toBe(101000);
    expect((await getItem(oil.id)).next_due_meter).toBe(106000);
    expect((await logsFor(wof.id)).find((l) => !l.is_baseline)?.meter_at_completion).toBe(101000);
    // A decrease past the earlier reading is refused like any reading.
    const bad = await req('PATCH', `/api/visits/${v.id}`, { meter: 100 });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toBe('reading_decreased');
  });

  it('undoing one line keeps the shared reading; voiding the reading blanks every line and the visit', async () => {
    const { asset, oil, wof } = await carWithTwoDueItems();
    const v = (await req('POST', `/api/assets/${asset.id}/visits`, {
      status: 'done', meter: 100500, lines: [{ item_id: oil.id }, { item_id: wof.id, issued_until: '2027-09-01' }],
    })).json().visit;
    const oilLog = (await logsFor(oil.id)).find((l) => !l.is_baseline)!;
    expect((await req('DELETE', `/api/maintenance/${oil.id}/logs/${oilLog.id}`)).statusCode).toBe(200);
    const reading = (await readingsFor(asset.id)).find((r) => r.id === v.reading_id)!;
    expect(reading.voided_at).toBeNull(); // the visit still stands on it
    expect((await req('DELETE', `/api/assets/${asset.id}/readings/${v.reading_id}`)).statusCode).toBe(200);
    expect((await logsFor(wof.id)).find((l) => !l.is_baseline)?.meter_at_completion).toBeNull();
    const after = (await req('GET', `/api/visits/${v.id}`)).json().visit;
    expect(after.meter).toBeNull();
    expect(after.reading_id).toBeNull();
  });
});
