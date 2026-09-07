import { eq } from 'drizzle-orm';
import { maintenanceDueState } from '@jevi-ops/shared';
import type { Db } from './db.js';
import { maintenance_items, tasks } from '../db/schema.js';
import { getAppTz } from './app-settings.js';
import { latestReadingByAsset } from './meter-readings.js';
import { todayInTz } from './tz.js';

// The maintenance awareness sweep: every active item that is due_soon or
// worse gets a REAL task in its domain, so upkeep lands where the eye
// already goes (Timeline, Doing rail, daily summary) instead of only in a
// module page. Runs daily via /api/cron/maintenance and opportunistically
// after a meter reading lands (a big odometer jump should surface today,
// not tomorrow).
//
// Idempotency + self-healing: generated_task_id links item → task. An item
// with a live (non-done) generated task is skipped; a link pointing at a
// done or deleted task (deletion nulls it via FK) regenerates. Known
// behavior: DELETING the generated task therefore brings it back on the
// next sweep — the remedies are snoozing the attention item or
// deactivating the maintenance item, not deleting the task.

export interface MaintenanceSweepResult {
  // Items in the due window (due_soon/due/overdue).
  considered: number;
  // Tasks created this run.
  created: number;
}

export async function runMaintenanceSweep(db: Db): Promise<MaintenanceSweepResult> {
  const tz = await getAppTz();
  const today = todayInTz(tz);

  const items = await db.query.maintenance_items.findMany({
    where: eq(maintenance_items.active, true),
    with: {
      asset: { columns: { id: true, name: true } },
      generated_task: { columns: { id: true, status: true } },
    },
  });

  const assetIds = [...new Set(items.map((i) => i.asset_id).filter((v): v is string => v != null))];
  const readings = await latestReadingByAsset(db, assetIds);

  const result: MaintenanceSweepResult = { considered: 0, created: 0 };
  for (const item of items) {
    const latestMeter = item.asset_id ? (readings.get(item.asset_id) ?? null) : null;
    const state = maintenanceDueState({ todayIso: today, latestMeter, item });
    if (state.status === 'ok') continue;
    result.considered += 1;

    // A live generated task already carries the awareness.
    if (item.generated_task && item.generated_task.status !== 'done') continue;

    const title = item.asset ? `${item.name} — ${item.asset.name}` : item.name;
    const [task] = await db
      .insert(tasks)
      .values({
        title,
        domain_id: item.domain_id,
        // Meter-only triggers have no calendar date — the work is due NOW,
        // so the task lands on today.
        due_date: item.next_due_date ?? today,
        source: 'maintenance',
        priority: 3,
      })
      .returning({ id: tasks.id });
    if (!task) continue;
    await db
      .update(maintenance_items)
      .set({ generated_task_id: task.id })
      .where(eq(maintenance_items.id, item.id));
    result.created += 1;
  }
  return result;
}
