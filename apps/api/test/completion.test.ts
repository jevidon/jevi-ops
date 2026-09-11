import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb } from '../src/lib/db.js';
import { completeMaintenanceItem } from '../src/lib/maintenance.js';
import { maintenance_items, tasks } from '../src/db/schema.js';
import { INBOX, addReading, createAsset, createItem, getItem, getTask, logsFor, readingsFor, today } from './helpers.js';

// completeMaintenanceItem — the single completion entry point, against the
// real database: idempotency, atomicity, historical entries, task closing.

describe('completeMaintenanceItem', () => {
  it('logs, captures the reading, re-anchors both axes, and links the reading', async () => {
    const asset = await createAsset();
    const item = await createItem({ asset_id: asset.id, baseline: { completed_on: '2026-06-01', meter: 95000 } });
    expect(item.next_due_date).toBe('2026-12-01');
    expect(item.next_due_meter).toBe(100000);

    const t = await today();
    const res = await completeMaintenanceItem(getDb(), item.id, { completedOn: t, meter: 99500, source: 'manual', actor: 'session:test' });
    expect(res?.logged).toBe(true);
    expect(res?.historical).toBe(false);
    expect(res?.item.last_completed_on).toBe(t);
    expect(res?.item.next_due_meter).toBe(104500);
    expect(res?.item.next_due_date).toBe(addMonths(t, 6));

    const readings = await readingsFor(asset.id);
    expect(readings).toHaveLength(1);
    expect(readings[0]!.source).toBe('completion');
    expect(res?.log.reading_id).toBe(readings[0]!.id);
    expect(res?.log.actor).toBe('session:test');
  });

  it('is idempotent on event_key — a retry converges instead of double-logging', async () => {
    const asset = await createAsset();
    const item = await createItem({ asset_id: asset.id, baseline: { completed_on: '2026-06-01', meter: 95000 } });
    const t = await today();
    const first = await completeMaintenanceItem(getDb(), item.id, { completedOn: t, meter: 99500, source: 'manual', eventKey: 'k1' });
    const second = await completeMaintenanceItem(getDb(), item.id, { completedOn: t, meter: 99900, source: 'manual', eventKey: 'k1' });
    expect(first?.logged).toBe(true);
    expect(second?.logged).toBe(false);
    expect(second?.log.id).toBe(first?.log.id);
    expect((await logsFor(item.id)).filter((l) => !l.is_baseline)).toHaveLength(1);
    expect((await getItem(item.id)).next_due_meter).toBe(104500);
  });

  it('allows two distinct services on the same day (no (item, day) unique)', async () => {
    const item = await createItem({ interval_meter: null, baseline: { completed_on: '2026-06-01' } });
    const t = await today();
    await completeMaintenanceItem(getDb(), item.id, { completedOn: t, source: 'manual', eventKey: 'a' });
    await completeMaintenanceItem(getDb(), item.id, { completedOn: t, source: 'manual', eventKey: 'b' });
    expect((await logsFor(item.id)).filter((l) => !l.is_baseline)).toHaveLength(2);
  });

  it('rolls back everything on a mid-transaction failure, and a retry succeeds', async () => {
    const asset = await createAsset();
    const item = await createItem({ asset_id: asset.id, baseline: { completed_on: '2026-06-01', meter: 95000 } });
    const t = await today();
    // A negative meter violates the readings CHECK after the log insert —
    // the partial-failure shape the review reproduced.
    await expect(
      completeMaintenanceItem(getDb(), item.id, { completedOn: t, meter: -1, source: 'manual', eventKey: 'retry' }),
    ).rejects.toThrow();
    expect((await logsFor(item.id)).filter((l) => !l.is_baseline)).toHaveLength(0);
    expect((await getItem(item.id)).next_due_meter).toBe(100000);

    const res = await completeMaintenanceItem(getDb(), item.id, { completedOn: t, meter: 99500, source: 'manual', eventKey: 'retry' });
    expect(res?.logged).toBe(true);
    expect(res?.item.next_due_meter).toBe(104500);
  });

  it('records a backdated completion as history without moving the current schedule', async () => {
    const asset = await createAsset();
    const item = await createItem({ asset_id: asset.id, baseline: { completed_on: '2026-08-01', meter: 100000 } });
    expect(item.next_due_date).toBe('2027-02-01');
    const res = await completeMaintenanceItem(getDb(), item.id, { completedOn: '2026-01-10', meter: 90000, source: 'import' });
    expect(res?.historical).toBe(true);
    const after = await getItem(item.id);
    expect(after.last_completed_on).toBe('2026-08-01');
    expect(after.next_due_date).toBe('2027-02-01');
    expect(after.next_due_meter).toBe(105000);
    expect((await logsFor(item.id))).toHaveLength(2);
  });

  it('a completion without a reading inherits only a reading taken on or before it', async () => {
    const asset = await createAsset();
    const item = await createItem({ asset_id: asset.id, baseline: { completed_on: '2026-06-01', meter: 95000 } });
    const t = await today();
    await addReading(asset.id, 120000, t); // later reading — must NOT be inherited
    const res = await completeMaintenanceItem(getDb(), item.id, { completedOn: '2026-07-15', source: 'manual' });
    // 2026-07-15 is before today's reading and there's no earlier one:
    // the meter axis is unknown, and the event is historical? No — it's
    // the latest completion (after the baseline), so the schedule moves.
    expect(res?.historical).toBe(false);
    expect(res?.item.last_completed_on).toBe('2026-07-15');
    expect(res?.item.last_completed_meter).toBeNull();
    expect(res?.item.next_due_meter).toBeNull();
  });

  it('closes a waiting generated task too, and clears the link', async () => {
    const item = await createItem({ interval_meter: null, baseline: { completed_on: '2026-01-01' } });
    const [task] = await getDb()
      .insert(tasks)
      .values({ title: 'x', domain_id: INBOX, status: 'waiting', source: 'maintenance', source_ref: 'maint:x' })
      .returning();
    await getDb().update(maintenance_items).set({ generated_task_id: task!.id }).where(eq(maintenance_items.id, item.id));

    await completeMaintenanceItem(getDb(), item.id, { completedOn: await today(), source: 'manual' });
    expect((await getTask(task!.id))?.status).toBe('done');
    expect((await getItem(item.id)).generated_task_id).toBeNull();
  });
});

function addMonths(iso: string, n: number): string {
  const d = new Date(iso + 'T12:00:00Z');
  const day = d.getUTCDate();
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1, 12));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(day, last), 12)).toISOString().slice(0, 10);
}
