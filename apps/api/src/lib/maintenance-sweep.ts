import { and, eq, sql } from 'drizzle-orm';
import { maintenanceDueState, maintenanceOccurrenceKey } from '@jevi-ops/shared';
import type { Db } from './db.js';
import { assets, maintenance_items, tasks } from '../db/schema.js';
import { getAppSettings } from './app-settings.js';
import { itemDomainId, lockItem, loadAsset } from './maintenance.js';
import { latestReadingRowByAsset } from './meter-readings.js';
import { todayInTz } from './tz.js';

// The maintenance awareness sweep: every active item on an ACTIVE asset that
// is due_soon or worse gets a REAL task in its effective domain, so upkeep
// lands where the eye already goes (Timeline, Doing rail, daily summary)
// instead of only in a module page. Runs daily from the in-process
// scheduler (lib/scheduler.ts, 4am) and opportunistically after a meter
// reading lands (a big odometer jump should surface today, not tomorrow).
//
// Concurrency: each item is handled in its own transaction with the row
// locked, AND the task carries a durable occurrence key in tasks.source_ref
// (unique per source). The index — not the lock — is the guarantee: the cron
// tick, a burst of reading submissions, and a manual /api/cron call can all
// race and still produce exactly one task per occurrence. A roll-forward
// (new thresholds) is a new occurrence, so the next cycle gets a fresh task.
//
// Task DATE follows the axis that tripped: a mileage-overdue oil change is
// due today, not on the calendar date months out. An existing live task is
// pulled forward when a later reading trips the meter axis.

export interface MaintenanceSweepResult {
  // Items in the due window (due_soon/due/overdue).
  considered: number;
  // Tasks created this run.
  created: number;
  // Existing tasks whose due_date was pulled forward by a meter trip.
  pulled_forward: number;
}

export async function runMaintenanceSweep(db: Db): Promise<MaintenanceSweepResult> {
  const settings = await getAppSettings();
  const today = todayInTz(settings.timezone);
  const result: MaintenanceSweepResult = { considered: 0, created: 0, pulled_forward: 0 };

  // Candidates: active items on active (or unattached) assets. The per-item
  // transaction re-reads under lock; this list is only the worklist.
  const candidates = await db
    .select({ id: maintenance_items.id })
    .from(maintenance_items)
    .leftJoin(assets, eq(assets.id, maintenance_items.asset_id))
    .where(
      and(
        eq(maintenance_items.active, true),
        sql`(${assets.id} is null or ${assets.lifecycle} = 'active')`,
      ),
    );

  for (const c of candidates) {
    const outcome = await db.transaction(async (tx) => {
      const item = await lockItem(tx, c.id);
      if (!item || !item.active) return null;
      const asset = await loadAsset(tx, item.asset_id);
      if (asset && asset.lifecycle !== 'active') return null;

      const latest = asset ? (await latestReadingRowByAsset(tx, [asset.id])).get(asset.id) ?? null : null;
      const state = maintenanceDueState({
        todayIso: today,
        latestMeter: latest?.reading ?? null,
        latestReadingOn: latest?.recorded_on ?? null,
        staleDays: settings.meter_stale_days,
        item,
      });
      if (state.status === 'ok') return null;

      // Due date follows the triggering axis. Meter-only triggers and
      // missing date axes land on today.
      const dueDate = state.trigger === 'meter' || !item.next_due_date ? today : item.next_due_date;

      // A live generated task already carries the awareness — but if the
      // meter axis has since tripped, its calendar date is now wrong.
      if (item.generated_task_id) {
        const [live] = await tx
          .select({ id: tasks.id, status: tasks.status, due_date: tasks.due_date })
          .from(tasks)
          .where(eq(tasks.id, item.generated_task_id));
        if (live && live.status !== 'done') {
          if (state.trigger === 'meter' && live.due_date && live.due_date > today) {
            await tx.update(tasks).set({ due_date: today }).where(eq(tasks.id, live.id));
            return 'pulled';
          }
          return 'considered';
        }
      }

      const occurrence = maintenanceOccurrenceKey(item);
      const title = asset ? `${item.name} — ${asset.name}` : item.name;
      const [created] = await tx
        .insert(tasks)
        .values({
          title,
          domain_id: itemDomainId(item, asset),
          due_date: dueDate,
          source: 'maintenance',
          source_ref: occurrence,
          priority: 3,
        })
        .onConflictDoNothing({
          target: [tasks.source, tasks.source_ref],
          where: sql`source_ref is not null`,
        })
        .returning({ id: tasks.id });

      // Conflict = this occurrence already has a task: another generator won
      // the race, or an undo re-derived the same thresholds after the task
      // was checked off. Adopt it — and reopen it if it's done, so an undone
      // completion brings its task back instead of looping on the conflict.
      let taskId = created?.id ?? null;
      let reopened = false;
      if (!taskId) {
        const [existing] = await tx
          .select({ id: tasks.id, status: tasks.status })
          .from(tasks)
          .where(and(eq(tasks.source, 'maintenance'), eq(tasks.source_ref, occurrence)));
        if (!existing) return 'considered';
        taskId = existing.id;
        if (existing.status === 'done') {
          await tx
            .update(tasks)
            .set({ status: 'open', completed_at: null, due_date: dueDate })
            .where(eq(tasks.id, existing.id));
          reopened = true;
        }
      }
      await tx.update(maintenance_items).set({ generated_task_id: taskId }).where(eq(maintenance_items.id, item.id));
      return created || reopened ? 'created' : 'considered';
    });

    if (outcome === null) continue;
    result.considered += 1;
    if (outcome === 'created') result.created += 1;
    if (outcome === 'pulled') result.pulled_forward += 1;
  }
  return result;
}
