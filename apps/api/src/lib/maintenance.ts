import { and, desc, eq } from 'drizzle-orm';
import { nextAfterCompletion } from '@jevi-ops/shared';
import type { Db } from './db.js';
import { asset_meter_readings, assets, maintenance_items, maintenance_logs, tasks } from '../db/schema.js';
import { clearAttentionForSource } from './attention.js';

// Completing a maintenance item — the single source of truth. Every path
// funnels here: the POST /api/maintenance/:id/complete endpoint, and (from
// the awareness build) checking off the item's generated task. Owns the
// whole ripple: log insert, meter capture, next-due roll-forward
// (RE-ANCHORED from the completion — see shared/maintenance.ts), closing
// the generated task, and live-clearing attention.

export type MaintenanceLogSource = 'manual' | 'task' | 'agent' | 'import';

export interface CompleteMaintenanceInput {
  completedOn: string; // YYYY-MM-DD, app-tz today by default (caller supplies)
  meter?: number | null;
  notes?: string | null;
  cost?: number | null;
  source: MaintenanceLogSource;
}

export interface CompleteMaintenanceResult {
  item: typeof maintenance_items.$inferSelect;
  // False when the (item, day) log already existed — the double-tap no-op.
  logged: boolean;
}

export async function completeMaintenanceItem(
  db: Db,
  itemId: string,
  input: CompleteMaintenanceInput,
): Promise<CompleteMaintenanceResult | null> {
  const item = await db.query.maintenance_items.findFirst({
    where: eq(maintenance_items.id, itemId),
  });
  if (!item) return null;

  const asset = item.asset_id
    ? await db.query.assets.findFirst({ where: eq(assets.id, item.asset_id) })
    : null;

  // Idempotent log insert (unique on item_id + completed_on): a second
  // complete on the same day returns the item untouched rather than
  // double-rolling the schedule.
  const [log] = await db
    .insert(maintenance_logs)
    .values({
      item_id: item.id,
      completed_on: input.completedOn,
      meter_at_completion: input.meter ?? null,
      notes: input.notes ?? null,
      cost: input.cost ?? null,
      source: input.source,
    })
    .onConflictDoNothing({
      target: [maintenance_logs.item_id, maintenance_logs.completed_on],
    })
    .returning();
  if (!log) return { item, logged: false };

  // A completion that carries a reading is a natural meter capture point —
  // record it so the asset's odometer history stays continuous.
  if (input.meter != null && asset?.meter_unit) {
    await db.insert(asset_meter_readings).values({
      asset_id: asset.id,
      reading: input.meter,
      recorded_on: input.completedOn,
      source: 'completion',
    });
  }

  // Meter anchor for the roll-forward: the completion's own reading, else
  // the asset's latest known reading (an oil change logged without an
  // odometer still schedules ~correctly from the last reading).
  let meterAnchor: number | null = input.meter ?? null;
  if (meterAnchor == null && item.interval_meter != null && item.asset_id) {
    const latest = await db.query.asset_meter_readings.findFirst({
      where: eq(asset_meter_readings.asset_id, item.asset_id),
      orderBy: [desc(asset_meter_readings.recorded_on), desc(asset_meter_readings.created_at)],
    });
    meterAnchor = latest?.reading ?? null;
  }

  const next = nextAfterCompletion({
    completedOn: input.completedOn,
    meterAtCompletion: meterAnchor,
    cadence: {
      interval_days: item.interval_days,
      interval_months: item.interval_months,
      interval_meter: item.interval_meter,
    },
  });

  const [updated] = await db
    .update(maintenance_items)
    .set({
      last_completed_on: input.completedOn,
      last_completed_meter: meterAnchor,
      next_due_date: next.next_due_date,
      next_due_meter: next.next_due_meter,
      generated_task_id: null,
    })
    .where(eq(maintenance_items.id, item.id))
    .returning();

  // Close the generated task directly (NOT via the tasks route — that
  // route's done-branch calls back into this function for generated tasks,
  // and a direct update sidesteps the recursion). Generated tasks never
  // carry a recurrence_rule, so there's no roll-forward to preserve.
  // Guard on status so completing the item after the user already checked
  // the task off doesn't touch it again.
  if (item.generated_task_id) {
    await db
      .update(tasks)
      .set({ status: 'done', completed_at: new Date().toISOString() })
      .where(and(eq(tasks.id, item.generated_task_id), eq(tasks.status, 'open')));
  }

  // Live-clear this item's attention (rule ships with the awareness build;
  // harmless no-op until then). Best-effort: attention cleanup must never
  // fail a completion.
  try {
    await clearAttentionForSource(db, 'maintenance_item', item.id, ['maintenance_due']);
  } catch {
    // Swallowed — the daily attention cron reconciles.
  }

  return { item: updated ?? item, logged: true };
}
