import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import {
  effectiveDomainId,
  maintenanceDueState,
  maintenanceOccurrenceKey,
  maintenanceTaskTitle,
  maintenanceTracked,
  missingCompletionFields,
  nextAfterCompletion,
  type MaintenancePolicy,
} from '@jevi-ops/shared';
import type { Db } from './db.js';
import { inTransaction, isTx, type DbOrTx, type Tx } from './maintenance-tx.js';
import { latestReadingAtOrBefore, latestReadingRowByAsset, recordReading } from './meter-readings.js';
import { clearAttentionForSource } from './attention.js';
import {
  assets,
  attention_items,
  maintenance_items,
  maintenance_logs,
  tasks,
} from '../db/schema.js';

// Completing a maintenance item — the single source of truth. Every path
// funnels here: POST /api/maintenance/:id/complete, and checking off the
// item's generated task. Owns the whole ripple, in ONE transaction with the
// item row locked: policy evidence check, idempotent event insert, meter
// capture through the validated readings path, schedule derivation from the
// LATEST APPLICABLE evidence (not the submitted event), closing the
// generated task. Attention live-clear happens after commit.
//
// Semantics that are deliberate:
//   * EVIDENCE PER POLICY. An expiry renewal without its new expiry, a
//     prepaid licence without its end distance, an inspection with nothing
//     to say — refused before any write (MaintenanceNeedsDetails). The task
//     checkbox and the agent API are held to the form's standard.
//   * HISTORICAL entries. A completion dated before the current last
//     completion is evidence (it appends), but it is not "today's work
//     done": the schedule — including a manually pinned deadline — the
//     generated task, and attention are not touched at all.
//   * IDEMPOTENT retries. A repeat with the same event_key finds the existing
//     log and still re-derives the schedule — a retry after a partial
//     failure converges instead of silently no-op'ing. The same key on a
//     different item is a conflict, never a second event.
//   * A completion's meter is a reading, validated like any other reading
//     (no going backwards without allow_decrease).

export type ItemRow = typeof maintenance_items.$inferSelect;
export type AssetRow = typeof assets.$inferSelect;
export type LogRow = typeof maintenance_logs.$inferSelect;
export type MaintenanceLogSource = 'manual' | 'task' | 'agent' | 'import';

// The completion lacks the evidence its policy requires. Nothing was written.
export class MaintenanceNeedsDetails extends Error {
  constructor(
    public policy: string,
    public fields: string[],
    // Which item, when the caller is completing several at once (a visit).
    public itemId: string | null = null,
    public itemName: string | null = null,
  ) {
    super(`${itemName ? `"${itemName}"` : `This ${policy} item`} needs ${fields.join(' or ')} to be completed.`);
    this.name = 'MaintenanceNeedsDetails';
  }
}

export class MaintenanceConflict extends Error {
  constructor(
    public code: 'event_key_conflict',
    message: string,
  ) {
    super(message);
    this.name = 'MaintenanceConflict';
  }
}

// What schedule evaluation needs beyond the rows: app-tz today and the
// reading-staleness policy.
export interface ScheduleContext {
  today: string;
  staleDays?: number | null;
}

export interface CompleteMaintenanceInput {
  completedOn: string; // YYYY-MM-DD, app-tz today by default (caller supplies)
  // App-tz today, for the reading's future check. Defaults to completedOn
  // (which the route has already refused when in the future).
  today?: string;
  meter?: number | null;
  allowDecrease?: boolean;
  notes?: string | null;
  cost?: number | null;
  source: MaintenanceLogSource;
  // Provenance — derived from the credential by the route, never the payload.
  actor?: string | null;
  runId?: string | null;
  // Idempotency key; server-generated when absent.
  eventKey?: string | null;
  // A service visit (0051): the completion happened at it, and its meter
  // is the visit's single reading (already recorded) rather than a new one.
  visitId?: string | null;
  readingId?: string | null;
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

    // Evidence first — before anything is written.
    const missing = missingCompletionFields(item.policy, {
      completedOn: input.completedOn,
      issuedUntil: input.issuedUntil,
      purchasedTo: input.purchasedTo,
      finding: input.finding,
      nextReviewOn: input.nextReviewOn,
      nextReviewMeter: input.nextReviewMeter,
    });
    if (missing.length > 0) throw new MaintenanceNeedsDetails(item.policy, missing, item.id, item.name);

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
        visit_id: input.visitId ?? null,
        reading_id: input.readingId ?? null,
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
      // record it through the validated path, linked, so undo can void
      // exactly this reading. A rejected reading rolls the log back too.
      // (At a visit the reading was recorded once already: readingId.)
      if (input.meter != null && asset?.meter_unit && !input.readingId) {
        const { row: reading } = await recordReading(tx, {
          assetId: asset.id,
          reading: input.meter,
          recordedOn: input.completedOn,
          today: input.today ?? input.completedOn,
          source: 'completion',
          actor: input.actor ?? null,
          eventKey: `${eventKey}:reading`,
          allowDecrease: input.allowDecrease,
        });
        await tx.update(maintenance_logs).set({ reading_id: reading.id }).where(eq(maintenance_logs.id, log.id));
        log = { ...log, reading_id: reading.id };
      }
    } else {
      // Retry / double-tap: the event already exists. Fall through and
      // re-derive so a partial earlier attempt converges — unless the key
      // belongs to another item, which is a client bug, not a retry.
      const [existing] = await tx.select().from(maintenance_logs).where(eq(maintenance_logs.event_key, eventKey));
      if (!existing) throw new Error('maintenance event conflict without a matching log');
      if (existing.item_id !== item.id) {
        throw new MaintenanceConflict('event_key_conflict', 'This event_key already identifies a completion on a different item.');
      }
      log = existing;
      logged = false;
    }

    // Current state comes from the LATEST applicable evidence, whatever was
    // just submitted. If the submitted event isn't the latest, it's history:
    // appended, and nothing else moves — a pinned deadline stays pinned.
    const latest = await latestLog(tx, item.id);
    const historical = latest != null && latest.id !== log.id;
    if (historical) return { item, log, logged, historical };

    const derived = await deriveSchedule(tx, item, asset);
    const update: Partial<typeof maintenance_items.$inferInsert> = { ...derived };
    if (item.generated_task_id) {
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
// generated task with the result. Used by undo, log edits, baseline edits,
// and cadence edits — only when the LATEST evidence changed; a change to
// older history must not touch a pinned deadline (the caller decides, see
// isLatestLog). Runs inside the caller's transaction with the item locked.
export async function rederiveAndReconcile(tx: Tx, item: ItemRow, ctx: ScheduleContext): Promise<ItemRow> {
  const asset = await loadAsset(tx, item.asset_id);
  const derived = await deriveSchedule(tx, item, asset);
  const [updated] = await tx.update(maintenance_items).set(derived).where(eq(maintenance_items.id, item.id)).returning();
  await reconcileItemTask(tx, item.id, ctx);
  const [fresh] = await tx.select().from(maintenance_items).where(eq(maintenance_items.id, item.id));
  return fresh ?? updated ?? item;
}

export async function isLatestLog(db: DbOrTx, itemId: string, logId: string): Promise<boolean> {
  return (await latestLog(db, itemId))?.id === logId;
}

// Seed evidence: create or edit the item's single baseline log. The schedule
// re-derives only when the baseline is (or was) the latest evidence — a
// baseline older than a real completion is history and moves nothing.
export async function upsertBaseline(
  tx: Tx,
  item: ItemRow,
  input: { completedOn: string; meter?: number | null; actor?: string | null },
  ctx: ScheduleContext,
): Promise<{ item: ItemRow; log: LogRow }> {
  const before = await latestLog(tx, item.id);
  const [existing] = await tx
    .select()
    .from(maintenance_logs)
    .where(and(eq(maintenance_logs.item_id, item.id), eq(maintenance_logs.is_baseline, true)))
    .limit(1);
  let log: LogRow;
  if (existing) {
    const [row] = await tx
      .update(maintenance_logs)
      .set({ completed_on: input.completedOn, meter_at_completion: input.meter ?? null })
      .where(eq(maintenance_logs.id, existing.id))
      .returning();
    log = row ?? existing;
  } else {
    const [row] = await tx
      .insert(maintenance_logs)
      .values({
        item_id: item.id,
        completed_on: input.completedOn,
        meter_at_completion: input.meter ?? null,
        source: 'import',
        actor: input.actor ?? null,
        is_baseline: true,
        notes: 'Baseline',
      })
      .returning();
    if (!row) throw new Error('baseline insert returned no row');
    log = row;
  }
  const after = await latestLog(tx, item.id);
  const touchesLatest = before?.id === log.id || after?.id === log.id || (!before && !!after);
  const updated = touchesLatest ? await rederiveAndReconcile(tx, item, ctx) : item;
  return { item: updated, log };
}

export type ReconcileOutcome = 'none' | 'unlinked' | 'retired' | 'retargeted' | 'current';

// Make an item's live generated task match the item's CURRENT state: the
// occurrence it stands for, the date the triggering axis implies, the
// domain the item now routes to, and (when the machine still owns the
// title) the name. Called after anything that can move those — a schedule
// edit, a domain assignment, a rename, a reading correction — and by the
// sweep as its repair path.
//
// A task the item no longer needs (out of the due window) is RETIRED:
// deleted when untouched (no notes, not filed under a project/milestone,
// title still the generated one — nothing of the person's is lost), and
// otherwise kept and retargeted so what they wrote survives with a date
// that's true. Done tasks are history and are never touched. An item that
// isn't tracked (paused, or on a stored/sold/archived asset) hands off to
// reconcileGeneratedWork — its work is noise.
export async function reconcileItemTask(
  tx: Tx,
  itemId: string,
  ctx: ScheduleContext,
  opts: { previousTitle?: string | null } = {},
): Promise<ReconcileOutcome> {
  const item = await lockItem(tx, itemId);
  if (!item || !item.generated_task_id) return 'none';
  const asset = await loadAsset(tx, item.asset_id);

  const [live] = await tx.select().from(tasks).where(eq(tasks.id, item.generated_task_id));
  if (!live || live.status === 'done') {
    await tx.update(maintenance_items).set({ generated_task_id: null }).where(eq(maintenance_items.id, item.id));
    return 'unlinked';
  }

  if (!maintenanceTracked(item, asset)) {
    await reconcileGeneratedWork(tx, [item.id]);
    return 'retired';
  }

  const latest = asset ? ((await latestReadingRowByAsset(tx, [asset.id])).get(asset.id) ?? null) : null;
  const state = maintenanceDueState({
    todayIso: ctx.today,
    latestMeter: latest?.reading ?? null,
    latestReadingOn: latest?.recorded_on ?? null,
    staleDays: ctx.staleDays ?? null,
    item,
  });
  const inWindow = state.status !== 'ok';
  const generatedTitle = maintenanceTaskTitle(item, asset);
  const untouched =
    !live.notes &&
    !live.project_id &&
    !live.milestone_id &&
    (live.title === generatedTitle || (!!opts.previousTitle && live.title === opts.previousTitle));

  if (!inWindow && untouched) {
    await tx.delete(tasks).where(eq(tasks.id, live.id));
    await tx.update(maintenance_items).set({ generated_task_id: null }).where(eq(maintenance_items.id, item.id));
    return 'retired';
  }

  const occurrence = maintenanceOccurrenceKey(item);
  // In the window the date follows the triggering axis (a mileage-overdue
  // service is due today); outside it, the calendar threshold (or none).
  const dueDate = inWindow
    ? state.trigger === 'meter' || !item.next_due_date
      ? ctx.today
      : item.next_due_date
    : item.next_due_date;
  const desired = {
    source_ref: occurrence,
    due_date: dueDate,
    domain_id: effectiveDomainId(item, asset),
    title: untouched ? generatedTitle : live.title,
  };
  if (
    live.source_ref === desired.source_ref &&
    live.due_date === desired.due_date &&
    live.domain_id === desired.domain_id &&
    live.title === desired.title
  ) {
    return 'current';
  }

  if (live.source_ref !== occurrence) {
    // Another task may already stand for the new occurrence — the done one
    // from an earlier cycle that an undo re-derived back to. Adopt it.
    const [holder] = await tx
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(eq(tasks.source, 'maintenance'), eq(tasks.source_ref, occurrence), ne(tasks.id, live.id)));
    if (holder) {
      if (untouched) await tx.delete(tasks).where(eq(tasks.id, live.id));
      else await tx.update(tasks).set({ source_ref: null }).where(eq(tasks.id, live.id));
      await tx
        .update(tasks)
        .set({ status: 'open', completed_at: null, waiting_on: null, waiting_since: null, due_date: desired.due_date, domain_id: desired.domain_id })
        .where(eq(tasks.id, holder.id));
      await tx.update(maintenance_items).set({ generated_task_id: holder.id }).where(eq(maintenance_items.id, item.id));
      return 'retargeted';
    }
  }
  await tx.update(tasks).set(desired).where(eq(tasks.id, live.id));
  return 'retargeted';
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
