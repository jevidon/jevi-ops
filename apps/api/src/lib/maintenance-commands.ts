import type { z } from 'zod';
import { asc, eq, inArray } from 'drizzle-orm';
import { CreateMaintenanceItemSchema, UpdateMaintenanceItemSchema, maintenanceTaskTitle } from '@jevi-ops/shared';
import { assets, maintenance_items, maintenance_logs } from '../db/schema.js';
import { deriveSchedule, loadAsset, lockItem, reconcileGeneratedWork, reconcileItemTask, type ItemRow, type ScheduleContext } from './maintenance.js';
import { inTransaction, type DbOrTx, type Tx } from './maintenance-tx.js';
import { CommandError } from './command-error.js';

async function validateMeterAxis(
  db: DbOrTx,
  policy: string,
  intervalMeter: number | null,
  assetId: string | null,
): Promise<string | null> {
  const needsMeter = intervalMeter != null || policy === 'prepaid_meter';
  if (!needsMeter) return null;
  if (!assetId) return 'A meter cadence requires the item to be attached to an asset with a meter_unit.';
  const asset = await loadAsset(db, assetId);
  if (!asset) return 'asset_id does not exist.';
  if (!asset.meter_unit) return 'A meter cadence requires the asset to have a meter_unit.';
  return null;
}

// Maintenance reparenting locks both the old and requested assets before the
// item. The recheck rejects a concurrent reparent rather than locking a new
// asset after the item, which would invert the visit/onboarding lock order.
async function lockItemAssets(tx: Tx, itemId: string, nextAssetId?: string | null): Promise<string | null | undefined> {
  const [snapshot] = await tx.select({ asset_id: maintenance_items.asset_id }).from(maintenance_items).where(eq(maintenance_items.id, itemId));
  if (!snapshot) return undefined;
  const ids = [...new Set([snapshot.asset_id, nextAssetId].filter((id): id is string => !!id))].sort();
  if (ids.length) await tx.select({ id: assets.id }).from(assets).where(inArray(assets.id, ids)).orderBy(asc(assets.id)).for('update');
  return snapshot.asset_id;
}

export async function createMaintenanceItem(db: DbOrTx, input: z.input<typeof CreateMaintenanceItemSchema>, actor: string): Promise<ItemRow> {
  const d = CreateMaintenanceItemSchema.parse(input);
  const policy = d.policy ?? 'interval';
  return inTransaction(db, async (tx) => {
    if (d.asset_id) await tx.select({ id: assets.id }).from(assets).where(eq(assets.id, d.asset_id)).for('update');
    const meterError = await validateMeterAxis(tx, policy, d.interval_meter ?? null, d.asset_id ?? null);
    if (meterError) throw new CommandError(400, 'invalid_cadence', meterError);
    const [created] = await tx
      .insert(maintenance_items)
      .values({
        name: d.name,
        notes: d.notes ?? null,
        asset_id: d.asset_id ?? null,
        // Null = inherit the asset's domain (else Inbox) at read time.
        domain_id: d.domain_id ?? null,
        policy,
        system: d.system ?? null,
        interval_days: d.interval_days ?? null,
        interval_months: d.interval_months ?? null,
        interval_meter: d.interval_meter ?? null,
        lead_days: d.lead_days ?? 14,
        lead_meter: d.lead_meter ?? null,
        metadata: d.metadata ?? {},
      })
      .returning();
    if (!created) throw new Error('insert returned no row');

    // Seed history is EVIDENCE — an explicit baseline log, editable but
    // not deletable — so undo and re-derivation always have it.
    if (d.last_completed_on) {
      await tx.insert(maintenance_logs).values({
        item_id: created.id,
        completed_on: d.last_completed_on,
        meter_at_completion: d.last_completed_meter ?? null,
        source: 'import',
        actor,
        is_baseline: true,
        notes: 'Baseline',
      });
    }

    // Materialise next-due from evidence (or the creation-date anchor),
    // then let an explicit override pin either axis ("brakes due at
    // 150,000 km") without inventing a completion. Omission and an
    // explicit null are different: null clears the axis on purpose.
    const asset = await loadAsset(tx, created.asset_id);
    const derived = await deriveSchedule(tx, created, asset);
    if (d.next_due_date !== undefined) derived.next_due_date = d.next_due_date;
    if (d.next_due_meter !== undefined) derived.next_due_meter = d.next_due_meter;
    // A baseline meter with no explicit override still seeds the axis.
    if (derived.next_due_meter == null && d.last_completed_meter != null && d.interval_meter != null && d.next_due_meter === undefined) {
      derived.next_due_meter = d.last_completed_meter + d.interval_meter;
    }
    const [updated] = await tx.update(maintenance_items).set(derived).where(eq(maintenance_items.id, created.id)).returning();
    return updated ?? created;
  });
}

export async function updateMaintenanceItem(db: DbOrTx, itemId: string, input: z.input<typeof UpdateMaintenanceItemSchema>, ctx: ScheduleContext): Promise<ItemRow> {
  const d = UpdateMaintenanceItemSchema.parse(input);
  return inTransaction(db, async (tx) => {
    const observedAssetId = await lockItemAssets(tx, itemId, d.asset_id);
    const existing = await lockItem(tx, itemId);
    if (!existing) throw new CommandError(404, 'not_found', 'Maintenance item not found.');

    if (existing.asset_id !== observedAssetId) throw new CommandError(409, 'item_conflict', 'The maintenance item moved to another asset. Reload and retry.');

    // Merged-cadence validation — the Zod checks can't see the columns a
    // partial patch leaves untouched.
    const merged = {
      policy: d.policy ?? existing.policy,
      interval_days: 'interval_days' in d ? (d.interval_days ?? null) : existing.interval_days,
      interval_months: 'interval_months' in d ? (d.interval_months ?? null) : existing.interval_months,
      interval_meter: 'interval_meter' in d ? (d.interval_meter ?? null) : existing.interval_meter,
    };
    if (merged.policy === 'interval' && merged.interval_days == null && merged.interval_months == null && merged.interval_meter == null) {
      throw new CommandError(400, 'invalid_cadence', 'Interval items need interval_days, interval_months, or interval_meter.');
    }
    if (merged.interval_days != null && merged.interval_months != null) {
      throw new CommandError(400, 'invalid_cadence', 'Use interval_days or interval_months, not both.');
    }
    const mergedAssetId = 'asset_id' in d ? (d.asset_id ?? null) : existing.asset_id;
    const meterError = await validateMeterAxis(tx, merged.policy, merged.interval_meter, mergedAssetId);
    if (meterError) throw new CommandError(400, 'invalid_cadence', meterError);

    const update: Partial<typeof maintenance_items.$inferInsert> = {};
    if (d.name !== undefined) update.name = d.name;
    if ('notes' in d) update.notes = d.notes ?? null;
    if ('asset_id' in d) update.asset_id = d.asset_id ?? null;
    if ('domain_id' in d) update.domain_id = d.domain_id ?? null;
    if (d.policy !== undefined) update.policy = d.policy;
    if ('system' in d) update.system = d.system ?? null;
    if ('interval_days' in d) update.interval_days = d.interval_days ?? null;
    if ('interval_months' in d) update.interval_months = d.interval_months ?? null;
    if ('interval_meter' in d) update.interval_meter = d.interval_meter ?? null;
    if (d.lead_days !== undefined) update.lead_days = d.lead_days;
    if ('lead_meter' in d) update.lead_meter = d.lead_meter ?? null;
    if (d.active !== undefined) update.active = d.active;
    if (d.metadata !== undefined) update.metadata = d.metadata;

    // Schedule stability: an axis is re-derived ONLY when the value of
    // something that defines it actually changed — a form that echoes
    // every field back must not move a due date. An explicit next_due_*
    // in the patch pins its axis regardless.
    const policyChanged = merged.policy !== existing.policy;
    const dateAxisChanged =
      policyChanged ||
      merged.interval_days !== existing.interval_days ||
      merged.interval_months !== existing.interval_months;
    const meterAxisChanged =
      policyChanged || merged.interval_meter !== existing.interval_meter || mergedAssetId !== existing.asset_id;

    if (dateAxisChanged || meterAxisChanged) {
      const asset = await loadAsset(tx, mergedAssetId);
      const derived = await deriveSchedule(tx, { ...existing, ...merged, asset_id: mergedAssetId }, asset);
      if (dateAxisChanged && !('next_due_date' in d)) update.next_due_date = derived.next_due_date;
      if (meterAxisChanged && !('next_due_meter' in d)) update.next_due_meter = derived.next_due_meter;
    }
    if ('next_due_date' in d) update.next_due_date = d.next_due_date ?? null;
    if ('next_due_meter' in d) update.next_due_meter = d.next_due_meter ?? null;

    const [row] = Object.keys(update).length > 0
      ? await tx.update(maintenance_items).set(update).where(eq(maintenance_items.id, existing.id)).returning()
      : [existing];
    if (!row) throw new CommandError(404, 'not_found', 'Maintenance item not found.');

    // Deactivating retires the generated work. Anything else that moves
    // the occurrence, the routing, or the name reconciles the live task
    // now — a pin 180 days out must not leave last week's overdue task
    // sitting open, and a re-routed item's task must move with it.
    if (d.active === false && existing.active) {
      await reconcileGeneratedWork(tx, [existing.id]);
    } else {
      const scheduleChanged = row.next_due_date !== existing.next_due_date || row.next_due_meter !== existing.next_due_meter;
      const routingChanged = row.domain_id !== existing.domain_id || row.asset_id !== existing.asset_id;
      const nameChanged = row.name !== existing.name;
      if (scheduleChanged || routingChanged || nameChanged) {
        const oldAsset = await loadAsset(tx, existing.asset_id);
        await reconcileItemTask(tx, existing.id, ctx, { previousTitle: maintenanceTaskTitle(existing, oldAsset) });
      }
    }
    const [fresh] = await tx.select().from(maintenance_items).where(eq(maintenance_items.id, existing.id));
    return fresh ?? row;
  });
}
