import { eq } from 'drizzle-orm';
import { INBOX_DOMAIN_ID } from '@jevi-ops/shared';
import { getDb } from '../src/lib/db.js';
import { getAppTz } from '../src/lib/app-settings.js';
import { addDays, todayInTz } from '../src/lib/tz.js';
import { deriveSchedule, loadAsset } from '../src/lib/maintenance.js';
import { asset_meter_readings, assets, maintenance_items, maintenance_logs, tasks } from '../src/db/schema.js';

// Fixtures for the maintenance engine tests. Everything is inserted through
// Drizzle directly (not the HTTP routes) so engine tests isolate the libs;
// route tests build the Fastify app and inject requests instead.

export const INBOX = INBOX_DOMAIN_ID;

export async function today(): Promise<string> {
  return todayInTz(await getAppTz());
}

export async function daysFromToday(n: number): Promise<string> {
  return addDays(await today(), n);
}

export async function createAsset(over: Partial<typeof assets.$inferInsert> = {}) {
  const [row] = await getDb()
    .insert(assets)
    .values({ name: 'Test car', kind: 'vehicle', meter_unit: 'km', ...over })
    .returning();
  return row!;
}

// Creates an item and materialises its schedule the way POST /api/maintenance
// does: an optional baseline log, then deriveSchedule, then explicit
// next_due_* overrides.
export async function createItem(
  over: Partial<typeof maintenance_items.$inferInsert> & {
    baseline?: { completed_on: string; meter?: number | null };
  } = {},
) {
  const db = getDb();
  const { baseline, next_due_date, next_due_meter, ...rest } = over;
  const [created] = await db
    .insert(maintenance_items)
    .values({ name: 'Oil change', policy: 'interval', interval_months: 6, interval_meter: 5000, ...rest })
    .returning();
  if (baseline) {
    await db.insert(maintenance_logs).values({
      item_id: created!.id,
      completed_on: baseline.completed_on,
      meter_at_completion: baseline.meter ?? null,
      source: 'import',
      is_baseline: true,
    });
  }
  const asset = await loadAsset(db, created!.asset_id);
  const derived = await deriveSchedule(db, created!, asset);
  if (next_due_date !== undefined) derived.next_due_date = next_due_date ?? null;
  if (next_due_meter !== undefined) derived.next_due_meter = next_due_meter ?? null;
  if (derived.next_due_meter == null && baseline?.meter != null && created!.interval_meter != null && next_due_meter === undefined) {
    derived.next_due_meter = baseline.meter + created!.interval_meter;
  }
  const [row] = await db.update(maintenance_items).set(derived).where(eq(maintenance_items.id, created!.id)).returning();
  return row!;
}

export async function addReading(assetId: string, reading: number, recordedOn: string) {
  const [row] = await getDb()
    .insert(asset_meter_readings)
    .values({ asset_id: assetId, reading, recorded_on: recordedOn, source: 'manual' })
    .returning();
  return row!;
}

export async function getItem(id: string) {
  const row = await getDb().query.maintenance_items.findFirst({ where: eq(maintenance_items.id, id) });
  if (!row) throw new Error(`item ${id} vanished`);
  return row;
}

export async function logsFor(itemId: string) {
  return getDb().query.maintenance_logs.findMany({ where: eq(maintenance_logs.item_id, itemId) });
}

export async function tasksBySource(source = 'maintenance') {
  return getDb().query.tasks.findMany({ where: eq(tasks.source, source) });
}

export async function getTask(id: string) {
  return getDb().query.tasks.findFirst({ where: eq(tasks.id, id) });
}

export async function readingsFor(assetId: string) {
  return getDb().query.asset_meter_readings.findMany({ where: eq(asset_meter_readings.asset_id, assetId) });
}
