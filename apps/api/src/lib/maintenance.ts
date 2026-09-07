import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  effectiveDomainId,
  nextAfterCompletion,
  type MaintenancePolicy,
} from '@jevi-ops/shared';
import type { Db } from './db.js';
import { inTransaction, isTx, type DbOrTx, type Tx } from './maintenance-tx.js';
import { latestReadingAtOrBefore } from './meter-readings.js';
import { clearAttentionForSource } from './attention.js';
import {
  asset_meter_readings,
  assets,
  attention_items,
  maintenance_items,
  maintenance_logs,
  tasks,
} from '../db/schema.js';

// Completing a maintenance item — the single source of truth. Every path
// funnels here: POST /api/maintenance/:id/complete, and checking off the
// item's generated task. Owns the whole ripple, in ONE transaction with the
// item row locked: idempotent event insert, meter capture, schedule
// derivation from the LATEST APPLICABLE evidence (not the submitted event),
// closing the generated task. Attention live-clear happens after commit.
//
// Two semantics the 0047 version got wrong, now deliberate:
//   * HISTORICAL entries. A completion dated before the current last
//     completion is evidence (it appends), but it is not "today's work
//     done": the schedule, the generated task, and attention are untouched.
//   * IDEMPOTENT retries. A repeat with the same event_key finds the existing
//     log and still re-derives the schedule — a retry after a partial
//     failure converges instead of silently no-op'ing.

export type ItemRow = typeof maintenance_items.$inferSelect;
export type AssetRow = typeof assets.$inferSelect;
export type LogRow = typeof maintenance_logs.$inferSelect;
export type MaintenanceLogSource = 'manual' | 'task' | 'agent' | 'import';

export interface CompleteMaintenanceInput {
  completedOn: string; // YYYY-MM-DD, app-tz today by default (caller supplies)
  meter?: number | null;
  notes?: string | null;
  cost?: number | null;
  source: MaintenanceLogSource;
  // Provenance — derived from the credential by the route, never the payload.
  actor?: string | null;
  runId?: string | null;
  // Idempotency key; server-generated when absent.
  eventKey?: string | null;
  // Policy-specific facts.
  issuedUntil?: string | null;
  purchasedTo?: number | null;
  finding?: string | null;
  nextReviewOn?: string | null;
  nextReviewMeter?: number | null;
}

export interface CompleteMaintenanceResult {
  item: ItemRow;
  log: LogRow;
  // False when event_key matched an existing log (the retry / double-tap).
  logged: boolean;
  // True when the event predates the current last completion: recorded as
  // history, schedule/task/attention untouched.
  historical: boolean;
}

// Lock the item row for the rest of the transaction. Everything that
// mutates an item's schedule goes through this so writers serialise.
export async function lockItem(tx: Tx, itemId: string): Promise<ItemRow | null> {
  const [row] = await tx.select().from(maintenance_items).where(eq(maintenance_items.id, itemId)).for('update');
  return row ?? null;
}

export async function loadAsset(db: DbOrTx, assetId: string | null): Promise<AssetRow | null> {
  if (!assetId) return null;
  const [row] = await db.select().from(assets).where(eq(assets.id, assetId));
  return row ?? null;
}

// The latest applicable evidence for an item: newest completed_on, ties by
// created_at. Baseline rows count — they ARE the seed evidence.
export async function latestLog(db: DbOrTx, itemId: string): Promise<LogRow | null> {
  const [row] = await db
    .select()
    .from(maintenance_logs)
    .where(eq(maintenance_logs.item_id, itemId))
    .orderBy(desc(maintenance_logs.completed_on), desc(maintenance_logs.created_at))
    .limit(1);
  return row ?? null;
}

export interface DerivedSchedule {
  last_completed_on: string | null;
  last_completed_meter: number | null;
  next_due_date: string | null;
  next_due_meter: number | null;
}

// Derive the materialised schedule from evidence. With a log: roll forward
// from it per policy; the meter anchor is the log's own reading, else the
// asset's latest reading ON OR BEFORE that date (never a later one), else
// unknown. With no logs: the interval date axis anchors at the item's
// creation date (a stable anchor — "today" would drift on every edit) and
// the meter axis stays unknown until evidence arrives.
export async function deriveSchedule(
  db: DbOrTx,
  item: Pick<ItemRow, 'id' | 'asset_id' | 'policy' | 'interval_days' | 'interval_months' | 'interval_meter' | 'created_at'>,
  asset: Pick<AssetRow, 'id' | 'meter_unit'> | null,
): Promise<DerivedSchedule> {
  const schedule = {
    policy: item.policy as MaintenancePolicy,
    interval_days: item.interval_days,
    interval_months: item.interval_months,
    interval_meter: item.interval_meter,
  };
  const log = await latestLog(db, item.id);
  if (!log) {
    const next = nextAfterCompletion({
      event: { completedOn: item.created_at.slice(0, 10), meterAtCompletion: null },
      schedule,
    });
    // No evidence → the meter axis is unknown (needs_baseline), never
    // inferred from a reading that isn't a service.
    return { last_completed_on: null, last_completed_meter: null, next_due_date: next.next_due_date, next_due_meter: null };
  }

  let meterAnchor = log.meter_at_completion;
  if (meterAnchor == null && asset?.meter_unit && needsMeterAnchor(schedule.policy, item.interval_meter)) {
    meterAnchor = (await latestReadingAtOrBefore(db, asset.id, log.completed_on))?.reading ?? null;
  }
  const next = nextAfterCompletion({
    event: {
      completedOn: log.completed_on,
      meterAtCompletion: meterAnchor,
      issuedUntil: log.issued_until,
      purchasedTo: log.purchased_to,
      nextReviewOn: log.next_review_on,
      nextReviewMeter: log.next_review_meter,
    },
    schedule,
  });
  return {
    last_completed_on: log.completed_on,
    last_completed_meter: meterAnchor,
    next_due_date: next.next_due_date,
    next_due_meter: next.next_due_meter,
  };
}

function needsMeterAnchor(policy: MaintenancePolicy, intervalMeter: number | null): boolean {
  return policy === 'interval' && intervalMeter != null;
}

export async function completeMaintenanceItem(
  db: DbOrTx,
  itemId: string,
  input: CompleteMaintenanceInput,
): Promise<CompleteMaintenanceResult | null> {
  const ownTx = !isTx(db);
  const result = await inTransaction(db, async (tx) => {
    const item = await lockItem(tx, itemId);
    if (!item) return null;
    const asset = await loadAsset(tx, item.asset_id);
    const eventKey = input.eventKey ?? randomUUID();

    // Idempotent event insert. The partial unique index is on event_key
    // WHERE event_key IS NOT NULL; the conflict target must match it.
    const [inserted] = await tx
      .insert(maintenance_logs)
      .values({
        item_id: item.id,
        completed_on: input.completedOn,
        meter_at_completion: input.meter ?? null,
        notes: input.notes ?? null,
        cost: input.cost ?? null,
        source: input.source,
        event_key: eventKey,
        actor: input.actor ?? null,
        run_id: input.runId ?? null,
        issued_until: input.issuedUntil ?? null,
        purchased_to: input.purchasedTo ?? null,
        finding: input.finding ?? null,
        next_review_on: input.nextReviewOn ?? null,
        next_review_meter: input.nextReviewMeter ?? null,
      })
      .onConflictDoNothing({
        target: maintenance_logs.event_key,
        where: sql`event_key is not null`,
      })
      .returning();

    let log: LogRow;
    let logged: boolean;
    if (inserted) {
      log = inserted;
      logged = true;
      // A completion that carries a reading is a meter capture point —
      // record it, linked, so undo can void exactly this reading.
      if (input.meter != null && asset?.meter_unit) {
        const [reading] = await tx
          .insert(asset_meter_readings)
          .values({
            asset_id: asset.id,
            reading: input.meter,
            recorded_on: input.completedOn,
            source: 'completion',
            event_key: `${eventKey}:reading`,
            actor: input.actor ?? null,
          })
          .onConflictDoNothing({ target: asset_meter_readings.event_key, where: sql`event_key is not null` })
          .returning({ id: asset_meter_readings.id });
        if (reading) {
          await tx.update(maintenance_logs).set({ reading_id: reading.id }).where(eq(maintenance_logs.id, log.id));
          log = { ...log, reading_id: reading.id };
        }
      }
    } else {
      // Retry / double-tap: the event already exists. Fall through and
      // re-derive so a partial earlier attempt converges.
      const [existing] = await tx.select().from(maintenance_logs).where(eq(maintenance_logs.event_key, eventKey));
      if (!existing) throw new Error('maintenance event conflict without a matching log');
      log = existing;
      logged = false;
    }

    // Current state comes from the LATEST applicable evidence, whatever was
    // just submitted. If the submitted event isn't the latest, it's history.
    const latest = await latestLog(tx, item.id);
    const historical = latest != null && latest.id !== log.id;

    const derived = await deriveSchedule(tx, item, asset);
    const update: Partial<typeof maintenance_items.$inferInsert> = { ...derived };
    if (!historical && item.generated_task_id) {
      await tx
        .update(tasks)
        .set({ status: 'done', completed_at: new Date().toISOString(), waiting_on: null, waiting_since: null })
        .where(and(eq(tasks.id, item.generated_task_id), inArray(tasks.status, ['open', 'waiting'])));
      update.generated_task_id = null;
    }
    const [updated] = await tx.update(maintenance_items).set(update).where(eq(maintenance_items.id, item.id)).returning();
    return { item: updated ?? item, log, logged, historical };
  });

  if (result && ownTx && !result.historical) {
    await clearMaintenanceAttention(db as Db, itemId);
  }
  return result;
}

// Live-clear this item's attention. Best-effort, after commit — attention
// cleanup must never fail (or roll back) a completion; the daily cron
// reconciles anyway.
export async function clearMaintenanceAttention(db: Db, itemId: string): Promise<void> {
  try {
    await clearAttentionForSource(db, 'maintenance_item', itemId, ['maintenance_due']);
  } catch {
    /* swallowed — the daily attention cron reconciles */
  }
}

// Re-derive an item's schedule from its evidence and reconcile its
// generated task. Used by undo, log edits, and cadence edits. Runs inside
// the caller's transaction with the item already locked.
export async function rederiveAndReconcile(tx: Tx, item: ItemRow): Promise<ItemRow> {
  const asset = await loadAsset(tx, item.asset_id);
  const derived = await deriveSchedule(tx, item, asset);
  const [updated] = await tx.update(maintenance_items).set(derived).where(eq(maintenance_items.id, item.id)).returning();
  return updated ?? item;
}

// Lifecycle reconciliation: when an item is deactivated/deleted or its asset
// leaves 'active', the generated work it spawned must go with it — an open
// task for a sold car is noise. Deletes open/waiting generated tasks
// (they're machine-made; nothing is lost), clears links, and removes live
// attention. Runs in the caller's transaction.
export async function reconcileGeneratedWork(tx: Tx, itemIds: string[]): Promise<{ tasks_removed: number }> {
  if (itemIds.length === 0) return { tasks_removed: 0 };
  const rows = await tx
    .select({ id: maintenance_items.id, task_id: maintenance_items.generated_task_id })
    .from(maintenance_items)
    .where(inArray(maintenance_items.id, itemIds));
  const taskIds = rows.map((r) => r.task_id).filter((v): v is string => v != null);
  let removed = 0;
  if (taskIds.length > 0) {
    const deleted = await tx
      .delete(tasks)
      .where(and(inArray(tasks.id, taskIds), inArray(tasks.status, ['open', 'waiting'])))
      .returning({ id: tasks.id });
    removed = deleted.length;
    await tx.update(maintenance_items).set({ generated_task_id: null }).where(inArray(maintenance_items.id, itemIds));
  }
  await tx
    .delete(attention_items)
    .where(
      and(
        eq(attention_items.source_type, 'maintenance_item'),
        inArray(attention_items.source_id, itemIds),
        inArray(attention_items.status, ['active', 'snoozed']),
      ),
    );
  return { tasks_removed: removed };
}

// Where an item's generated task lands: its own domain, else its asset's,
// else Inbox. Awareness always flows; domain visibility is what assignment
// unlocks (see shared effectiveDomainId).
export function itemDomainId(item: Pick<ItemRow, 'domain_id'>, asset: Pick<AssetRow, 'domain_id'> | null): string {
  return effectiveDomainId(item, asset);
}
