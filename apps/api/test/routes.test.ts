import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { buildServer } from '../src/server.js';
import { signSession } from '../src/lib/jwt.js';
import { hashApiToken } from '../src/routes/auth.js';
import { getDb } from '../src/lib/db.js';
import { api_tokens, maintenance_items } from '../src/db/schema.js';
import { addReading, createAsset, createItem, daysFromToday, getItem, getTask, logsFor, readingsFor, tasksBySource, today } from './helpers.js';

// HTTP-level behaviour of the maintenance routes: edit stability,
// reading validation, unit lock, undo, provenance, and the tasks bridge.

let app: FastifyInstance;
let session: string;
const AGENT_TOKEN = 'ops_test_agent_token_0123456789';

beforeAll(async () => {
  app = await buildServer();
  await app.ready();
  session = await signSession({ id: '00000000-0000-0000-0000-000000000001', email: 'probe@test.local' });
});
afterAll(async () => {
  await app.close();
});
beforeEach(async () => {
  await getDb().insert(api_tokens).values({ name: 'agent-test', token_hash: hashApiToken(AGENT_TOKEN) });
});

function req(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, body?: unknown, token = session) {
  return app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, ...(body !== undefined ? { payload: body } : {}) });
}

describe('PATCH /api/maintenance/:id — schedule stability', () => {
  it('a form-shaped save that echoes the cadence does not move the schedule', async () => {
    const asset = await createAsset();
    const item = await createItem({ asset_id: asset.id, next_due_date: '2026-10-01', next_due_meter: 102000 });
    const res = await req('PATCH', `/api/maintenance/${item.id}`, {
      name: 'Oil change (renamed)',
      notes: 'note only',
      asset_id: asset.id,
      domain_id: null,
      policy: 'interval',
      interval_days: null,
      interval_months: 6,
      interval_meter: 5000,
      lead_days: 14,
      lead_meter: null,
    });
    expect(res.statusCode).toBe(200);
    const after = await getItem(item.id);
    expect(after.name).toBe('Oil change (renamed)');
    expect(after.next_due_date).toBe('2026-10-01');
    expect(after.next_due_meter).toBe(102000);
  });

  it('recomputes each axis independently, honouring a pin on the other', async () => {
    const asset = await createAsset();
    const item = await createItem({ asset_id: asset.id, baseline: { completed_on: '2026-06-01', meter: 100000 } });
    expect(item.next_due_meter).toBe(105000);
    const res = await req('PATCH', `/api/maintenance/${item.id}`, { interval_meter: 10000, next_due_date: '2026-12-25' });
    expect(res.statusCode).toBe(200);
    const after = await getItem(item.id);
    expect(after.next_due_meter).toBe(110000); // meter axis re-derived from the baseline
    expect(after.next_due_date).toBe('2026-12-25'); // date axis pinned by the patch
  });

  it('deactivating retires the generated task', async () => {
    const item = await createItem({ interval_meter: null, next_due_date: await daysFromToday(0) });
    const { runMaintenanceSweep } = await import('../src/lib/maintenance-sweep.js');
    await runMaintenanceSweep(getDb());
    const [task] = await tasksBySource();
    const res = await req('PATCH', `/api/maintenance/${item.id}`, { active: false });
    expect(res.statusCode).toBe(200);
    expect(await getTask(task!.id)).toBeUndefined();
  });
});

describe('readings', () => {
  it('refuses future-dated and decreasing readings, accepts a declared meter replacement', async () => {
    const asset = await createAsset();
    await addReading(asset.id, 100000, await daysFromToday(-1));
    const future = await req('POST', `/api/assets/${asset.id}/readings`, { reading: 100500, recorded_on: await daysFromToday(1) });
    expect(future.statusCode).toBe(400);
    expect(future.json().error).toBe('future_reading');
    const lower = await req('POST', `/api/assets/${asset.id}/readings`, { reading: 90000 });
    expect(lower.statusCode).toBe(400);
    expect(lower.json().error).toBe('reading_decreased');
    const replaced = await req('POST', `/api/assets/${asset.id}/readings`, { reading: 10, allow_decrease: true });
    expect(replaced.statusCode).toBe(201);
  });

  it('is idempotent on event_key', async () => {
    const asset = await createAsset();
    const a = await req('POST', `/api/assets/${asset.id}/readings`, { reading: 100000, event_key: 'r1' });
    const b = await req('POST', `/api/assets/${asset.id}/readings`, { reading: 100000, event_key: 'r1' });
    expect(a.statusCode).toBe(201);
    expect(b.statusCode).toBe(200);
    expect(b.json().logged).toBe(false);
    expect(await readingsFor(asset.id)).toHaveLength(1);
  });

  it('voids rather than deletes, and the void stops counting as latest', async () => {
    const asset = await createAsset();
    const r1 = await addReading(asset.id, 100000, await daysFromToday(-2));
    const r2 = await addReading(asset.id, 999999, await daysFromToday(-1)); // typo
    const res = await req('DELETE', `/api/assets/${asset.id}/readings/${r2.id}`);
    expect(res.statusCode).toBe(200);
    expect(res.json().voided).toBe(true);
    const list = await req('GET', '/api/assets');
    const row = list.json().assets.find((a: { id: string }) => a.id === asset.id);
    expect(row.latest_reading).toBe(100000);
    expect((await readingsFor(asset.id)).find((r) => r.id === r1.id)?.voided_at).toBeNull();
  });

  it('locks the meter unit once readings exist', async () => {
    const asset = await createAsset();
    await addReading(asset.id, 1000, await today());
    const res = await req('PATCH', `/api/assets/${asset.id}`, { meter_unit: 'mi' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('meter_unit_locked');
  });
});

describe('completion, undo, provenance', () => {
  it('a session completion is manual; an API-token completion is agent, with actor recorded', async () => {
    const item = await createItem({ interval_meter: null, baseline: { completed_on: '2026-01-01' } });
    const s = await req('POST', `/api/maintenance/${item.id}/complete`, { source: 'agent', completed_on: await daysFromToday(-3) });
    expect(s.statusCode).toBe(200);
    expect(s.json().log.source).toBe('manual'); // declared source ignored for sessions
    expect(s.json().log.actor).toBe('session:probe@test.local');
    const a = await req('POST', `/api/maintenance/${item.id}/complete`, { run_id: 'run-7' }, AGENT_TOKEN);
    expect(a.statusCode).toBe(200);
    expect(a.json().log.source).toBe('agent');
    expect(a.json().log.actor).toBe('token:agent-test');
    expect(a.json().log.run_id).toBe('run-7');
  });

  it('refuses a future-dated completion', async () => {
    const item = await createItem({ interval_meter: null });
    const res = await req('POST', `/api/maintenance/${item.id}/complete`, { completed_on: await daysFromToday(2) });
    expect(res.statusCode).toBe(400);
  });

  it('undo voids the completion reading, keeps the baseline, and re-derives', async () => {
    const asset = await createAsset();
    const item = await createItem({ asset_id: asset.id, baseline: { completed_on: '2026-06-01', meter: 95000 } });
    const done = await req('POST', `/api/maintenance/${item.id}/complete`, { meter: 99500 });
    expect(done.statusCode).toBe(200);
    const logId = done.json().log.id;
    const undo = await req('DELETE', `/api/maintenance/${item.id}/logs/${logId}`);
    expect(undo.statusCode).toBe(200);
    const after = await getItem(item.id);
    expect(after.last_completed_on).toBe('2026-06-01');
    expect(after.next_due_meter).toBe(100000);
    const readings = await readingsFor(asset.id);
    expect(readings).toHaveLength(1);
    expect(readings[0]!.voided_at).not.toBeNull();
    const baseline = (await logsFor(item.id)).find((l) => l.is_baseline)!;
    const refused = await req('DELETE', `/api/maintenance/${item.id}/logs/${baseline.id}`);
    expect(refused.statusCode).toBe(409);
  });

  it('editing the baseline re-derives the schedule', async () => {
    const asset = await createAsset();
    const item = await createItem({ asset_id: asset.id, baseline: { completed_on: '2026-06-01', meter: 95000 } });
    const baseline = (await logsFor(item.id)).find((l) => l.is_baseline)!;
    const res = await req('PATCH', `/api/maintenance/${item.id}/logs/${baseline.id}`, { meter_at_completion: 96000, completed_on: '2026-07-01' });
    expect(res.statusCode).toBe(200);
    const after = await getItem(item.id);
    expect(after.next_due_meter).toBe(101000);
    expect(after.next_due_date).toBe('2027-01-01');
  });

  it('checking off the generated task completes the item in the same transaction', async () => {
    const item = await createItem({ interval_meter: null, next_due_date: await daysFromToday(0), interval_months: 3 });
    const { runMaintenanceSweep } = await import('../src/lib/maintenance-sweep.js');
    await runMaintenanceSweep(getDb());
    const [task] = await tasksBySource();
    const res = await req('PATCH', `/api/tasks/${task!.id}`, { status: 'done' });
    expect(res.statusCode).toBe(200);
    const after = await getItem(item.id);
    expect(after.generated_task_id).toBeNull();
    expect(after.last_completed_on).toBe(await today());
    const logs = await logsFor(item.id);
    expect(logs).toHaveLength(1);
    expect(logs[0]!.source).toBe('task');
    // Idempotent: a second PATCH to done finds the same event_key.
    await req('PATCH', `/api/tasks/${task!.id}`, { status: 'done' });
    expect(await logsFor(item.id)).toHaveLength(1);
  });
});

describe('assets lifecycle', () => {
  it('refuses to delete an asset with meter-cadence items; archiving retires their work', async () => {
    const asset = await createAsset();
    await createItem({ asset_id: asset.id, next_due_date: await daysFromToday(0) });
    const { runMaintenanceSweep } = await import('../src/lib/maintenance-sweep.js');
    await runMaintenanceSweep(getDb());
    expect(await tasksBySource()).toHaveLength(1);
    const del = await req('DELETE', `/api/assets/${asset.id}`);
    expect(del.statusCode).toBe(409);
    const arch = await req('PATCH', `/api/assets/${asset.id}`, { lifecycle: 'sold' });
    expect(arch.statusCode).toBe(200);
    expect(arch.json().asset.archived_at).not.toBeNull();
    expect(await tasksBySource()).toHaveLength(0);
    const items = await getDb().select().from(maintenance_items).where(eq(maintenance_items.asset_id, asset.id));
    expect(items[0]!.generated_task_id).toBeNull();
  });

  it('a later reading past the threshold creates the task inline', async () => {
    const asset = await createAsset();
    await createItem({ asset_id: asset.id, baseline: { completed_on: '2026-06-01', meter: 100000 } });
    const res = await req('POST', `/api/assets/${asset.id}/readings`, { reading: 105500 });
    expect(res.statusCode).toBe(201);
    const [task] = await tasksBySource();
    expect(task?.due_date).toBe(await today());
  });
});
