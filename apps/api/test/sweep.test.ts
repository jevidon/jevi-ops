import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb } from '../src/lib/db.js';
import { completeMaintenanceItem, reconcileGeneratedWork } from '../src/lib/maintenance.js';
import { runMaintenanceSweep } from '../src/lib/maintenance-sweep.js';
import { buildJobs } from '../src/lib/scheduler.js';
import { assets, maintenance_items, maintenance_logs } from '../src/db/schema.js';
import { INBOX, addReading, createAsset, createItem, daysFromToday, getItem, getTask, tasksBySource, today } from './helpers.js';

// runMaintenanceSweep — task generation with a durable occurrence identity.

describe('scheduler registration', () => {
  it('registers the maintenance sweep daily, before attention', () => {
    const log = { info() {}, error() {}, warn() {} } as unknown as Parameters<typeof buildJobs>[0];
    const jobs = buildJobs(log);
    const names = jobs.map((j) => j.name);
    expect(names).toContain('maintenance');
    expect(names.indexOf('maintenance')).toBeLessThan(names.indexOf('attention'));
    expect(jobs.find((j) => j.name === 'maintenance')?.pattern).toBe('0 4 * * *');
  });
});

describe('runMaintenanceSweep', () => {
  it('creates one task for a due item, and none on a second run', async () => {
    const item = await createItem({ interval_meter: null, next_due_date: await daysFromToday(3) });
    const first = await runMaintenanceSweep(getDb());
    const second = await runMaintenanceSweep(getDb());
    expect(first.created).toBe(1);
    expect(second.created).toBe(0);
    const generated = await tasksBySource();
    expect(generated).toHaveLength(1);
    expect(generated[0]!.source_ref).toBe(`maint:${item.id}:${item.next_due_date}:`);
    expect(generated[0]!.domain_id).toBe(INBOX);
    expect((await getItem(item.id)).generated_task_id).toBe(generated[0]!.id);
  });

  it('concurrent sweeps produce exactly one task (unique occurrence key)', async () => {
    await createItem({ interval_meter: null, next_due_date: await daysFromToday(-2) });
    const results = await Promise.all([runMaintenanceSweep(getDb()), runMaintenanceSweep(getDb()), runMaintenanceSweep(getDb())]);
    expect(results.reduce((n, r) => n + r.created, 0)).toBe(1);
    expect(await tasksBySource()).toHaveLength(1);
  });

  it('dates a meter-triggered task today, not on the far calendar date', async () => {
    const asset = await createAsset();
    const item = await createItem({ asset_id: asset.id, baseline: { completed_on: await daysFromToday(-30), meter: 100000 } });
    await addReading(asset.id, 106000, await today()); // 1,000 past the 105,000 threshold
    const res = await runMaintenanceSweep(getDb());
    expect(res.created).toBe(1);
    const [task] = await tasksBySource();
    expect(task!.due_date).toBe(await today());
    expect(item.next_due_date).not.toBe(await today());
  });

  it('pulls an existing live task forward when a later reading trips the meter axis', async () => {
    const asset = await createAsset();
    const item = await createItem({
      asset_id: asset.id,
      baseline: { completed_on: await daysFromToday(-30), meter: 100000 },
      next_due_date: await daysFromToday(5), // date axis: due soon → task created on that date
    });
    await addReading(asset.id, 104600, await today()); // within lead (10% = 500) → due_soon by meter too
    await runMaintenanceSweep(getDb());
    const [task] = await tasksBySource();
    expect(task!.due_date).toBe(item.next_due_date);

    await addReading(asset.id, 105200, await today());
    const res = await runMaintenanceSweep(getDb());
    expect(res.retargeted).toBe(1);
    expect((await getTask(task!.id))?.due_date).toBe(await today());
  });

  it('skips items on stored/sold/archived assets', async () => {
    const asset = await createAsset({ lifecycle: 'sold' });
    await createItem({ asset_id: asset.id, interval_meter: null, next_due_date: await daysFromToday(-1) });
    const res = await runMaintenanceSweep(getDb());
    expect(res.considered).toBe(0);
    expect(await tasksBySource()).toHaveLength(0);
  });

  it('uses the asset domain for an item with no domain of its own', async () => {
    const [domain] = await getDb().select().from((await import('../src/db/schema.js')).stewardship_domains).limit(1);
    const asset = await createAsset({ domain_id: domain!.id });
    await createItem({ asset_id: asset.id, interval_meter: null, next_due_date: await daysFromToday(0) });
    await runMaintenanceSweep(getDb());
    const [task] = await tasksBySource();
    expect(task!.domain_id).toBe(domain!.id);
  });

  it('reopens the occurrence task after an undo re-derives the same thresholds', async () => {
    const item = await createItem({ interval_meter: null, next_due_date: await daysFromToday(0) });
    await runMaintenanceSweep(getDb());
    const [task] = await tasksBySource();
    const done = await completeMaintenanceItem(getDb(), item.id, { completedOn: await today(), source: 'manual' });
    expect((await getTask(task!.id))?.status).toBe('done');

    // Undo the completion: delete the log, re-derive (back to the pinned
    // date? No — derive from evidence: no logs → creation-date anchor).
    await getDb().delete(maintenance_logs).where(eq(maintenance_logs.id, done!.log.id));
    await getDb().update(maintenance_items).set({ next_due_date: item.next_due_date, generated_task_id: null }).where(eq(maintenance_items.id, item.id));
    const res = await runMaintenanceSweep(getDb());
    expect(res.created).toBe(1); // reopened counts as created
    expect(await tasksBySource()).toHaveLength(1);
    expect((await getTask(task!.id))?.status).toBe('open');
  });

  it('reconcileGeneratedWork retires open and waiting tasks and clears links', async () => {
    const item = await createItem({ interval_meter: null, next_due_date: await daysFromToday(0) });
    await runMaintenanceSweep(getDb());
    const [task] = await tasksBySource();
    await getDb().transaction((tx) => reconcileGeneratedWork(tx, [item.id]));
    expect(await getTask(task!.id)).toBeUndefined();
    expect((await getItem(item.id)).generated_task_id).toBeNull();
  });

  it('an asset leaving active retires its items’ generated work', async () => {
    const asset = await createAsset();
    await createItem({ asset_id: asset.id, interval_meter: null, next_due_date: await daysFromToday(0) });
    await runMaintenanceSweep(getDb());
    expect(await tasksBySource()).toHaveLength(1);
    // Mirrors what PATCH /api/assets/:id does on lifecycle change.
    await getDb().transaction(async (tx) => {
      await tx.update(assets).set({ lifecycle: 'archived' }).where(eq(assets.id, asset.id));
      const items = await tx.select({ id: maintenance_items.id }).from(maintenance_items).where(eq(maintenance_items.asset_id, asset.id));
      await reconcileGeneratedWork(tx, items.map((i) => i.id));
    });
    expect(await tasksBySource()).toHaveLength(0);
    expect((await runMaintenanceSweep(getDb())).created).toBe(0);
  });
});
