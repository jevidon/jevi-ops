import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { missingCompletionFields } from '@jevi-ops/shared';
import type { Db } from './db.js';
import { inTransaction, isTx, type DbOrTx, type Tx } from './maintenance-tx.js';
import {
  MaintenanceConflict,
  MaintenanceNeedsDetails,
  type ScheduleContext,
  clearMaintenanceAttention,
  completeMaintenanceItem,
  isLatestLog,
  latestLog,
  lockItem,
  rederiveAndReconcile,
} from './maintenance.js';
import { recordReading, updateReading, voidReading, type ReadingRow } from './meter-readings.js';
import {
  asset_meter_readings,
  assets,
  maintenance_items,
  maintenance_logs,
  maintenance_visit_items,
  maintenance_visits,
  type StoredAttachment,
} from '../db/schema.js';

// Service visits (0051) — the engine. A visit is ONE event: the odometer is
// recorded once (a single reading), every line's completion links to it
// and to the visit, and the whole thing lands in one transaction with the
// asset row locked, so a burst of retries or a concurrent sweep can't
// interleave. Each line goes through completeMaintenanceItem — the same
// evidence rules, the same historical-entry semantics, the same task
// closing — so nothing about a visit is a second code path for "done".
//
// Money: the visit's `total` is what the invoice said; a line's `cost` is
// the allocated part. spend is invoice-grounded (visit totals + loose
// completions' costs); line costs are for reasoning about one item.

export type VisitRow = typeof maintenance_visits.$inferSelect;

export interface VisitLine {
  itemId: string;
  skipped?: boolean;
  cost?: number | null;
  notes?: string | null;
  issuedUntil?: string | null;
  purchasedTo?: number | null;
  finding?: string | null;
  nextReviewOn?: string | null;
  nextReviewMeter?: number | null;
}

export interface CompleteVisitInput {
  assetId: string;
  // A planned visit to complete; absent = a visit logged outright.
  visitId?: string | null;
  visitedOn: string;
  today: string;
  meter?: number | null;
  allowDecrease?: boolean;
  provider?: string | null;
  invoiceNumber?: string | null;
  currency?: string | null;
  total?: number | null;
  notes?: string | null;
  attachments?: StoredAttachment[] | null;
  eventKey?: string | null;
  runId?: string | null;
  source: 'manual' | 'agent' | 'import';
  actor: string;
  lines: VisitLine[];
}

export interface CompleteVisitResult {
  visit: VisitRow;
  reading: ReadingRow | null;
  // Per line: the completion outcome (historical when the visit predates a
  // later completion of that item; logged:false on a retry).
  lines: Array<{ item_id: string; log_id: string; logged: boolean; historical: boolean }>;
  // False when event_key matched an existing visit (the retry).
  logged: boolean;
}

export class VisitError extends Error {
  constructor(
    public code: 'visit_not_found' | 'visit_not_planned' | 'visit_not_done' | 'item_not_on_asset' | 'no_lines',
    message: string,
  ) {
    super(message);
    this.name = 'VisitError';
  }
}

async function lockAsset(tx: Tx, assetId: string) {
  const [row] = await tx.select().from(assets).where(eq(assets.id, assetId)).for('update');
  return row ?? null;
}

// Every line's item must belong to the asset; the caller's payload is the
// one place a wrong id could come from.
async function itemsOnAsset(tx: Tx, assetId: string, itemIds: string[]) {
  if (itemIds.length === 0) return new Map<string, typeof maintenance_items.$inferSelect>();
  const rows = await tx.select().from(maintenance_items).where(and(inArray(maintenance_items.id, itemIds), eq(maintenance_items.asset_id, assetId)));
  const map = new Map(rows.map((r) => [r.id, r]));
  for (const id of itemIds) {
    if (!map.has(id)) throw new VisitError('item_not_on_asset', `Item ${id} is not on this asset.`);
  }
  return map;
}

export async function completeVisit(db: DbOrTx, input: CompleteVisitInput): Promise<CompleteVisitResult> {
  const ownTx = !isTx(db);
  const result = await inTransaction(db, async (tx) => {
    const asset = await lockAsset(tx, input.assetId);
    if (!asset) throw new VisitError('visit_not_found', 'Asset not found.');
    const eventKey = input.eventKey ?? randomUUID();

    // Retry / double-tap: the visit already exists. Return it as it is.
    if (input.eventKey) {
      const [existing] = await tx.select().from(maintenance_visits).where(eq(maintenance_visits.event_key, input.eventKey));
      if (existing) {
        if (existing.asset_id !== asset.id) {
          throw new MaintenanceConflict('event_key_conflict', 'This event_key already identifies a visit on a different asset.');
        }
        const logs = await tx.select().from(maintenance_logs).where(eq(maintenance_logs.visit_id, existing.id));
        const reading = existing.reading_id
          ? ((await tx.select().from(asset_meter_readings).where(eq(asset_meter_readings.id, existing.reading_id)))[0] ?? null)
          : null;
        return {
          visit: existing,
          reading,
          lines: logs.map((l) => ({ item_id: l.item_id, log_id: l.id, logged: false, historical: false })),
          logged: false,
        };
      }
    }

    const active = input.lines.filter((l) => !l.skipped);
    if (active.length === 0) throw new VisitError('no_lines', 'A visit needs at least one line that was done.');
    const items = await itemsOnAsset(tx, asset.id, input.lines.map((l) => l.itemId));

    // Evidence first, for every line, before anything is written.
    for (const line of active) {
      const item = items.get(line.itemId)!;
      const missing = missingCompletionFields(item.policy, {
        completedOn: input.visitedOn,
        issuedUntil: line.issuedUntil,
        purchasedTo: line.purchasedTo,
        finding: line.finding,
        nextReviewOn: line.nextReviewOn,
        nextReviewMeter: line.nextReviewMeter,
      });
      if (missing.length > 0) throw new MaintenanceNeedsDetails(item.policy, missing, item.id, item.name);
    }

    // The odometer, once.
    let reading: ReadingRow | null = null;
    if (input.meter != null && asset.meter_unit) {
      reading = (
        await recordReading(tx, {
          assetId: asset.id,
          reading: input.meter,
          recordedOn: input.visitedOn,
          today: input.today,
          source: 'completion',
          actor: input.actor,
          eventKey: `${eventKey}:reading`,
          allowDecrease: input.allowDecrease,
        })
      ).row;
    }

    // The visit row: a planned one becomes the record; otherwise a new one.
    const facts = {
      status: 'done' as const,
      visited_on: input.visitedOn,
      meter: input.meter ?? null,
      reading_id: reading?.id ?? null,
      provider: input.provider ?? null,
      invoice_number: input.invoiceNumber ?? null,
      currency: input.currency ?? null,
      total: input.total ?? null,
      notes: input.notes ?? null,
      attachments: input.attachments ?? [],
      event_key: eventKey,
      actor: input.actor,
      run_id: input.runId ?? null,
    };
    let visit: VisitRow;
    if (input.visitId) {
      const [planned] = await tx.select().from(maintenance_visits).where(eq(maintenance_visits.id, input.visitId)).for('update');
      if (!planned || planned.asset_id !== asset.id) throw new VisitError('visit_not_found', 'Visit not found.');
      if (planned.status !== 'planned') throw new VisitError('visit_not_planned', 'This visit is already recorded.');
      const [row] = await tx.update(maintenance_visits).set(facts).where(eq(maintenance_visits.id, planned.id)).returning();
      visit = row!;
      // The plan's lines served their purpose; the logs are the record.
      await tx.delete(maintenance_visit_items).where(eq(maintenance_visit_items.visit_id, planned.id));
    } else {
      const [row] = await tx.insert(maintenance_visits).values({ asset_id: asset.id, ...facts }).returning();
      visit = row!;
    }

    // Each line is a completion — the one code path for "done".
    const lines: CompleteVisitResult['lines'] = [];
    for (const line of active) {
      const res = await completeMaintenanceItem(tx, line.itemId, {
        completedOn: input.visitedOn,
        today: input.today,
        meter: input.meter ?? null,
        readingId: reading?.id ?? null,
        visitId: visit.id,
        notes: line.notes ?? null,
        cost: line.cost ?? null,
        source: input.source,
        actor: input.actor,
        runId: input.runId ?? null,
        eventKey: `${eventKey}:${line.itemId}`,
        issuedUntil: line.issuedUntil ?? null,
        purchasedTo: line.purchasedTo ?? null,
        finding: line.finding ?? null,
        nextReviewOn: line.nextReviewOn ?? null,
        nextReviewMeter: line.nextReviewMeter ?? null,
      });
      if (!res) throw new VisitError('item_not_on_asset', `Item ${line.itemId} vanished.`);
      lines.push({ item_id: line.itemId, log_id: res.log.id, logged: res.logged, historical: res.historical });
    }
    return { visit, reading, lines, logged: true };
  });

  if (ownTx && result.logged) {
    for (const line of result.lines) {
      if (!line.historical) await clearMaintenanceAttention(db as Db, line.item_id);
    }
  }
  return result;
}

// Undo a done visit: every line's completion comes out (schedules re-derive
// from what remains), the visit's single reading is voided, the visit row
// goes. A planned visit is simply deleted.
export async function deleteVisit(db: DbOrTx, visitId: string, ctx: ScheduleContext): Promise<{ deleted: boolean; logs_removed: number }> {
  return inTransaction(db, async (tx) => {
    const [visit] = await tx.select().from(maintenance_visits).where(eq(maintenance_visits.id, visitId)).for('update');
    if (!visit) return { deleted: false, logs_removed: 0 };
    await lockAsset(tx, visit.asset_id);
    let removed = 0;
    if (visit.status === 'done') {
      const logs = await tx.select().from(maintenance_logs).where(eq(maintenance_logs.visit_id, visit.id));
      for (const log of logs) {
        const item = await lockItem(tx, log.item_id);
        const wasLatest = item ? await isLatestLog(tx, item.id, log.id) : false;
        await tx.delete(maintenance_logs).where(eq(maintenance_logs.id, log.id));
        removed += 1;
        if (item && wasLatest) await rederiveAndReconcile(tx, item, ctx);
      }
      if (visit.reading_id) await voidReading(tx, visit.asset_id, visit.reading_id);
    }
    await tx.delete(maintenance_visits).where(eq(maintenance_visits.id, visit.id));
    return { deleted: true, logs_removed: removed };
  });
}

// Move a done visit's evidence: the date and/or the odometer. The single
// reading and every line's log move together, and each affected schedule
// re-derives when that log is its latest evidence.
export async function syncVisitEvidence(
  tx: Tx,
  visit: VisitRow,
  change: { visitedOn?: string; meter?: number | null; allowDecrease?: boolean; actor: string },
  ctx: ScheduleContext,
): Promise<VisitRow> {
  const asset = await lockAsset(tx, visit.asset_id);
  if (!asset) throw new VisitError('visit_not_found', 'Asset not found.');
  const visitedOn = change.visitedOn ?? visit.visited_on!;
  const meterTouched = change.meter !== undefined;
  const meter = meterTouched ? change.meter! : visit.meter;

  let readingId = visit.reading_id;
  if (asset.meter_unit) {
    if (meter == null) {
      if (readingId) await voidReading(tx, asset.id, readingId);
      readingId = null;
    } else if (readingId) {
      const row = await updateReading(tx, {
        assetId: asset.id,
        readingId,
        today: ctx.today,
        reading: meterTouched ? meter : undefined,
        recordedOn: change.visitedOn,
        allowDecrease: change.allowDecrease,
      });
      if (!row) readingId = null;
    }
    if (meter != null && !readingId) {
      readingId = (
        await recordReading(tx, {
          assetId: asset.id,
          reading: meter,
          recordedOn: visitedOn,
          today: ctx.today,
          source: 'completion',
          actor: change.actor,
          allowDecrease: change.allowDecrease,
        })
      ).row.id;
    }
  }

  const logs = await tx.select().from(maintenance_logs).where(eq(maintenance_logs.visit_id, visit.id));
  for (const log of logs) {
    const item = await lockItem(tx, log.item_id);
    if (!item) continue;
    const before = await latestLog(tx, item.id);
    await tx
      .update(maintenance_logs)
      .set({ completed_on: visitedOn, meter_at_completion: meter ?? null, reading_id: readingId })
      .where(eq(maintenance_logs.id, log.id));
    const after = await latestLog(tx, item.id);
    if (before?.id === log.id || after?.id === log.id) await rederiveAndReconcile(tx, item, ctx);
  }

  const [updated] = await tx
    .update(maintenance_visits)
    .set({ visited_on: visitedOn, meter: meter ?? null, reading_id: readingId })
    .where(eq(maintenance_visits.id, visit.id))
    .returning();
  return updated ?? visit;
}

// The asset's visits, planned first (soonest plan first), then done newest
// first — each with its lines: the plan's items, or the completions.
export async function listVisits(db: DbOrTx, assetId: string) {
  const rows = await db.query.maintenance_visits.findMany({
    where: eq(maintenance_visits.asset_id, assetId),
    with: {
      lines: { with: { item: { columns: { id: true, name: true, policy: true, system: true } } }, orderBy: [asc(maintenance_visit_items.position)] },
      logs: { with: { item: { columns: { id: true, name: true, policy: true, system: true } } } },
    },
    orderBy: [desc(maintenance_visits.visited_on), desc(maintenance_visits.planned_on), desc(maintenance_visits.created_at)],
  });
  const planned = rows.filter((v) => v.status === 'planned').sort((a, b) => (a.planned_on ?? '9999').localeCompare(b.planned_on ?? '9999'));
  const done = rows.filter((v) => v.status === 'done');
  return [...planned, ...done];
}

// Invoice-grounded spend for a year: visit totals (an invoice is the
// truth), plus the costs of completions that were not part of a visit.
export async function spendForYear(db: DbOrTx, assetId: string, yearStart: string): Promise<number> {
  const visits = await db
    .select({ total: maintenance_visits.total })
    .from(maintenance_visits)
    .where(and(eq(maintenance_visits.asset_id, assetId), eq(maintenance_visits.status, 'done'), sql`${maintenance_visits.visited_on} >= ${yearStart}`));
  const loose = await db
    .select({ cost: maintenance_logs.cost })
    .from(maintenance_logs)
    .innerJoin(maintenance_items, eq(maintenance_items.id, maintenance_logs.item_id))
    .where(and(eq(maintenance_items.asset_id, assetId), isNull(maintenance_logs.visit_id), sql`${maintenance_logs.completed_on} >= ${yearStart}`));
  return visits.reduce((s, v) => s + (v.total ?? 0), 0) + loose.reduce((s, l) => s + (l.cost ?? 0), 0);
}
