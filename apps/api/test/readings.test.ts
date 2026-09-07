import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { signSession } from '../src/lib/jwt.js';
import { getDb } from '../src/lib/db.js';
import { addReading, createAsset, createItem, daysFromToday, getItem, logsFor, readingsFor, today } from './helpers.js';

// Readings are one fact wherever they come from: the standalone POST, a
// completion's meter, a correction, a log edit. One validator (temporal
// neighbours), one idempotency rule, and a linked completion reading and
// its log move together.

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

describe('temporal-neighbour validation', () => {
  it('a backdated reading may not exceed the reading after it (and allow_decrease permits it)', async () => {
    const asset = await createAsset();
    await addReading(asset.id, 100000, await daysFromToday(-1));
    const tooHigh = await req('POST', `/api/assets/${asset.id}/readings`, { reading: 120000, recorded_on: await daysFromToday(-10) });
    expect(tooHigh.statusCode).toBe(400);
    expect(tooHigh.json().error).toBe('reading_exceeds_later');
    const fine = await req('POST', `/api/assets/${asset.id}/readings`, { reading: 99000, recorded_on: await daysFromToday(-10) });
    expect(fine.statusCode).toBe(201);
    const replaced = await req('POST', `/api/assets/${asset.id}/readings`, { reading: 120000, recorded_on: await daysFromToday(-5), allow_decrease: true });
    expect(replaced.statusCode).toBe(201);
  });

  it('a completion reading is refused when it goes backwards, accepted with allow_decrease', async () => {
    const asset = await createAsset();
    const item = await createItem({ asset_id: asset.id });
    await addReading(asset.id, 100000, await daysFromToday(-1));
    const bad = await req('POST', `/api/maintenance/${item.id}/complete`, { meter: 100 });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toBe('reading_decreased');
    // Nothing partial: no log, no reading, schedule untouched.
    expect((await logsFor(item.id))).toHaveLength(0);
    expect(await readingsFor(asset.id)).toHaveLength(1);
    const ok = await req('POST', `/api/maintenance/${item.id}/complete`, { meter: 100, allow_decrease: true });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().item.next_due_meter).toBe(5100);
  });

  it('a correction is validated against its neighbours, excluding itself', async () => {
    const asset = await createAsset();
    const r1 = await addReading(asset.id, 100000, await daysFromToday(-10));
    await addReading(asset.id, 101000, await daysFromToday(-5));
    const above = await req('PATCH', `/api/assets/${asset.id}/readings/${r1.id}`, { reading: 102000 });
    expect(above.statusCode).toBe(400);
    expect(above.json().error).toBe('reading_exceeds_later');
    const ok = await req('PATCH', `/api/assets/${asset.id}/readings/${r1.id}`, { reading: 100500 });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().reading.reading).toBe(100500);
  });
});

describe('event keys', () => {
  it('the same reading event_key on another asset is a conflict, not a second reading', async () => {
    const a = await createAsset();
    const b = await createAsset({ name: 'Other' });
    expect((await req('POST', `/api/assets/${a.id}/readings`, { reading: 1000, event_key: 'shared' })).statusCode).toBe(201);
    const res = await req('POST', `/api/assets/${b.id}/readings`, { reading: 1000, event_key: 'shared' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('event_key_conflict');
    expect(await readingsFor(b.id)).toHaveLength(0);
  });

  it('the same completion event_key on another item is a conflict', async () => {
    const asset = await createAsset();
    const a = await createItem({ asset_id: asset.id, interval_meter: null });
    const b = await createItem({ asset_id: asset.id, interval_meter: null, name: 'Other' });
    expect((await req('POST', `/api/maintenance/${a.id}/complete`, { event_key: 'k' })).statusCode).toBe(200);
    const res = await req('POST', `/api/maintenance/${b.id}/complete`, { event_key: 'k' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('event_key_conflict');
    expect(await logsFor(b.id)).toHaveLength(0);
  });
});

describe('a linked completion reading and its log are one fact', () => {
  it('correcting the reading moves the service anchor and the schedule', async () => {
    const asset = await createAsset();
    const item = await createItem({ asset_id: asset.id });
    const done = (await req('POST', `/api/maintenance/${item.id}/complete`, { meter: 100000 })).json();
    expect(done.item.next_due_meter).toBe(105000);
    const res = await req('PATCH', `/api/assets/${asset.id}/readings/${done.log.reading_id}`, { reading: 101000 });
    expect(res.statusCode).toBe(200);
    expect(res.json().item.next_due_meter).toBe(106000);
    const after = await getItem(item.id);
    expect(after.next_due_meter).toBe(106000);
    expect(after.last_completed_meter).toBe(101000);
    const log = (await logsFor(item.id)).find((l) => l.id === done.log.id)!;
    expect(log.meter_at_completion).toBe(101000);
  });

  it('re-dating the reading re-dates the service', async () => {
    const asset = await createAsset();
    const item = await createItem({ asset_id: asset.id, interval_months: 6, interval_meter: null });
    const t = await today();
    const done = (await req('POST', `/api/maintenance/${item.id}/complete`, { meter: 50000, completed_on: t })).json();
    const earlier = await daysFromToday(-30);
    const res = await req('PATCH', `/api/assets/${asset.id}/readings/${done.log.reading_id}`, { recorded_on: earlier });
    expect(res.statusCode).toBe(200);
    const after = await getItem(item.id);
    expect(after.last_completed_on).toBe(earlier);
    expect(after.next_due_date).not.toBe(done.item.next_due_date);
  });

  it('voiding the reading leaves the service with an unknown meter', async () => {
    const asset = await createAsset();
    const item = await createItem({ asset_id: asset.id });
    const done = (await req('POST', `/api/maintenance/${item.id}/complete`, { meter: 100000 })).json();
    const res = await req('DELETE', `/api/assets/${asset.id}/readings/${done.log.reading_id}`);
    expect(res.statusCode).toBe(200);
    const log = (await logsFor(item.id)).find((l) => l.id === done.log.id)!;
    expect(log.meter_at_completion).toBeNull();
    expect(log.reading_id).toBeNull();
    const after = await getItem(item.id);
    expect(after.next_due_meter).toBeNull(); // needs_baseline again — no reading on or before the service
    expect(after.last_completed_on).toBe(done.item.last_completed_on);
  });

  it('clearing the log meter voids the reading; adding one creates it', async () => {
    const asset = await createAsset();
    const item = await createItem({ asset_id: asset.id });
    const done = (await req('POST', `/api/maintenance/${item.id}/complete`, { meter: 100000 })).json();
    const cleared = await req('PATCH', `/api/maintenance/${item.id}/logs/${done.log.id}`, { meter_at_completion: null });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json().log.reading_id).toBeNull();
    expect((await readingsFor(asset.id)).every((r) => r.voided_at != null)).toBe(true);

    const added = await req('PATCH', `/api/maintenance/${item.id}/logs/${done.log.id}`, { meter_at_completion: 100500 });
    expect(added.statusCode).toBe(200);
    expect(added.json().log.reading_id).not.toBeNull();
    const live = (await readingsFor(asset.id)).filter((r) => !r.voided_at);
    expect(live).toHaveLength(1);
    expect(live[0]!.reading).toBe(100500);
    expect(live[0]!.source).toBe('completion');
    expect((await getItem(item.id)).next_due_meter).toBe(105500);
  });

  it('a decreasing log correction is refused like any reading, unless allow_decrease', async () => {
    const asset = await createAsset();
    const item = await createItem({ asset_id: asset.id });
    await addReading(asset.id, 90000, await daysFromToday(-30));
    const done = (await req('POST', `/api/maintenance/${item.id}/complete`, { meter: 100000 })).json();
    const bad = await req('PATCH', `/api/maintenance/${item.id}/logs/${done.log.id}`, { meter_at_completion: 80000 });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toBe('reading_decreased');
    const ok = await req('PATCH', `/api/maintenance/${item.id}/logs/${done.log.id}`, { meter_at_completion: 80000, allow_decrease: true });
    expect(ok.statusCode).toBe(200);
    expect((await getItem(item.id)).next_due_meter).toBe(85000);
  });
});

describe('the asset bundle', () => {
  it('reports the authoritative latest reading even when the history head is voided', async () => {
    const asset = await createAsset();
    const good = await addReading(asset.id, 100000, await daysFromToday(-2));
    const typo = await addReading(asset.id, 999999, await daysFromToday(-1));
    await req('DELETE', `/api/assets/${asset.id}/readings/${typo.id}`);
    const res = await req('GET', `/api/assets/${asset.id}`);
    expect(res.json().latest_reading).toEqual({ id: good.id, reading: 100000, recorded_on: await daysFromToday(-2) });
    expect(res.json().readings[0].id).toBe(typo.id); // history still shows the voided row first
    expect(getDb()).toBeDefined();
  });
});
