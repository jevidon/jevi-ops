import { and, asc, desc, eq, gt, inArray, isNull, lte, ne, sql } from 'drizzle-orm';
import type { DbOrTx } from './maintenance-tx.js';
import { asset_meter_readings } from '../db/schema.js';

// Meter readings — the one place a reading is written or corrected, and the
// one definition of "latest". Own module because both the completion lib and
// the attention rules need it, and those two import in opposite directions.
//
// VALIDATION lives here, not in the route, because a reading arrives four
// ways — a standalone entry, a completion's meter, a correction, an import —
// and the review found the completion path skipping the checks the route
// had. A cumulative meter only goes up, so a value must sit between its
// TEMPORAL NEIGHBOURS: not below the latest reading on or before its date,
// not above the earliest reading after it. `allow_decrease` is a permit for
// a replaced meter: it lets the lower number in and nothing more — the
// thresholds derived from earlier readings are not translated. A proper
// odometer epoch/offset is deferred (noted in the plan), so after a
// replacement, re-baseline the meter-cadence items.
//
// "Latest" means the same everywhere: newest recorded_on, ties broken by
// created_at. Voided rows (corrections, 0048) never count.

export type ReadingRow = typeof asset_meter_readings.$inferSelect;
export type ReadingSource = 'manual' | 'completion' | 'agent' | 'import';

export type ReadingRejectedCode = 'future_reading' | 'reading_decreased' | 'reading_exceeds_later' | 'event_key_conflict';

export class ReadingRejected extends Error {
  constructor(
    public code: ReadingRejectedCode,
    message: string,
  ) {
    super(message);
    this.name = 'ReadingRejected';
  }
}

export interface LatestReading {
  id: string;
  reading: number;
  recorded_on: string;
}

export async function latestReadingRowByAsset(
  db: DbOrTx,
  assetIds: string[],
): Promise<Map<string, LatestReading>> {
  const map = new Map<string, LatestReading>();
  if (assetIds.length === 0) return map;
  const rows = await db
    .select({
      id: asset_meter_readings.id,
      asset_id: asset_meter_readings.asset_id,
      reading: asset_meter_readings.reading,
      recorded_on: asset_meter_readings.recorded_on,
    })
    .from(asset_meter_readings)
    .where(and(inArray(asset_meter_readings.asset_id, assetIds), isNull(asset_meter_readings.voided_at)))
    .orderBy(
      asc(asset_meter_readings.asset_id),
      desc(asset_meter_readings.recorded_on),
      desc(asset_meter_readings.created_at),
    );
  for (const r of rows) {
    if (!map.has(r.asset_id)) map.set(r.asset_id, { id: r.id, reading: r.reading, recorded_on: r.recorded_on });
  }
  return map;
}

export async function latestReadingByAsset(db: DbOrTx, assetIds: string[]): Promise<Map<string, number>> {
  const rows = await latestReadingRowByAsset(db, assetIds);
  return new Map([...rows].map(([id, r]) => [id, r.reading]));
}

// The latest reading recorded ON OR BEFORE a date — what a historical
// completion may inherit as its meter. A reading taken after the service is
// never evidence of the odometer at the service.
export async function latestReadingAtOrBefore(
  db: DbOrTx,
  assetId: string,
  dateIso: string,
  excludeId?: string | null,
): Promise<LatestReading | null> {
  const [row] = await db
    .select({
      id: asset_meter_readings.id,
      reading: asset_meter_readings.reading,
      recorded_on: asset_meter_readings.recorded_on,
    })
    .from(asset_meter_readings)
    .where(
      and(
        eq(asset_meter_readings.asset_id, assetId),
        isNull(asset_meter_readings.voided_at),
        lte(asset_meter_readings.recorded_on, dateIso),
        excludeId ? ne(asset_meter_readings.id, excludeId) : undefined,
      ),
    )
    .orderBy(desc(asset_meter_readings.recorded_on), desc(asset_meter_readings.created_at))
    .limit(1);
  return row ?? null;
}

// The earliest reading recorded strictly AFTER a date — the upper bound a
// backdated entry or correction must respect.
export async function earliestReadingAfter(
  db: DbOrTx,
  assetId: string,
  dateIso: string,
  excludeId?: string | null,
): Promise<LatestReading | null> {
  const [row] = await db
    .select({
      id: asset_meter_readings.id,
      reading: asset_meter_readings.reading,
      recorded_on: asset_meter_readings.recorded_on,
    })
    .from(asset_meter_readings)
    .where(
      and(
        eq(asset_meter_readings.asset_id, assetId),
        isNull(asset_meter_readings.voided_at),
        gt(asset_meter_readings.recorded_on, dateIso),
        excludeId ? ne(asset_meter_readings.id, excludeId) : undefined,
      ),
    )
    .orderBy(asc(asset_meter_readings.recorded_on), asc(asset_meter_readings.created_at))
    .limit(1);
  return row ?? null;
}

// The neighbour check every write path runs. `excludeId` lets a correction
// validate against everything but itself.
export async function assertReadingFits(
  db: DbOrTx,
  params: {
    assetId: string;
    reading: number;
    recordedOn: string;
    today: string;
    allowDecrease?: boolean;
    excludeId?: string | null;
  },
): Promise<void> {
  const { assetId, reading, recordedOn, today, allowDecrease, excludeId } = params;
  if (recordedOn > today) {
    throw new ReadingRejected('future_reading', 'A reading cannot be dated in the future.');
  }
  if (allowDecrease) return;
  const prev = await latestReadingAtOrBefore(db, assetId, recordedOn, excludeId);
  if (prev && reading < prev.reading) {
    throw new ReadingRejected(
      'reading_decreased',
      `Lower than the reading before it (${prev.reading} on ${prev.recorded_on}). Pass allow_decrease if the meter was replaced.`,
    );
  }
  const next = await earliestReadingAfter(db, assetId, recordedOn, excludeId);
  if (next && reading > next.reading) {
    throw new ReadingRejected(
      'reading_exceeds_later',
      `Higher than the reading after it (${next.reading} on ${next.recorded_on}). Pass allow_decrease if the meter was replaced.`,
    );
  }
}

export interface RecordReadingInput {
  assetId: string;
  reading: number;
  recordedOn: string;
  today: string;
  source: ReadingSource;
  actor?: string | null;
  notes?: string | null;
  // Idempotency key: a repeat with the same key returns the existing row
  // (logged:false); the same key on ANOTHER asset is a conflict.
  eventKey?: string | null;
  allowDecrease?: boolean;
}

// Write a reading. Validated, idempotent. Callers that need atomicity with
// other writes pass their transaction.
export async function recordReading(
  db: DbOrTx,
  input: RecordReadingInput,
): Promise<{ row: ReadingRow; logged: boolean }> {
  if (input.eventKey) {
    const existing = await db.query.asset_meter_readings.findFirst({
      where: eq(asset_meter_readings.event_key, input.eventKey),
    });
    if (existing) {
      if (existing.asset_id !== input.assetId) {
        throw new ReadingRejected('event_key_conflict', 'This event_key already identifies a reading on a different asset.');
      }
      return { row: existing, logged: false };
    }
  }
  await assertReadingFits(db, {
    assetId: input.assetId,
    reading: input.reading,
    recordedOn: input.recordedOn,
    today: input.today,
    allowDecrease: input.allowDecrease,
  });
  const [inserted] = await db
    .insert(asset_meter_readings)
    .values({
      asset_id: input.assetId,
      reading: input.reading,
      recorded_on: input.recordedOn,
      notes: input.notes ?? null,
      source: input.source,
      actor: input.actor ?? null,
      event_key: input.eventKey ?? null,
    })
    .onConflictDoNothing({ target: asset_meter_readings.event_key, where: sql`event_key is not null` })
    .returning();
  if (inserted) return { row: inserted, logged: true };
  // Lost a race on the key: the other writer's row is the event.
  const raced = await db.query.asset_meter_readings.findFirst({
    where: eq(asset_meter_readings.event_key, input.eventKey!),
  });
  if (!raced) throw new Error('reading event conflict without a matching row');
  if (raced.asset_id !== input.assetId) {
    throw new ReadingRejected('event_key_conflict', 'This event_key already identifies a reading on a different asset.');
  }
  return { row: raced, logged: false };
}

// Correct a reading in place (value, date, notes). Validated against its
// neighbours excluding itself. Returns null when the row doesn't exist,
// isn't on this asset, or is voided.
export async function updateReading(
  db: DbOrTx,
  params: {
    assetId: string;
    readingId: string;
    today: string;
    reading?: number;
    recordedOn?: string;
    notes?: string | null;
    allowDecrease?: boolean;
  },
): Promise<ReadingRow | null> {
  const existing = await db.query.asset_meter_readings.findFirst({
    where: and(
      eq(asset_meter_readings.id, params.readingId),
      eq(asset_meter_readings.asset_id, params.assetId),
      isNull(asset_meter_readings.voided_at),
    ),
  });
  if (!existing) return null;
  const reading = params.reading ?? existing.reading;
  const recordedOn = params.recordedOn ?? existing.recorded_on;
  if (params.reading !== undefined || params.recordedOn !== undefined) {
    await assertReadingFits(db, {
      assetId: params.assetId,
      reading,
      recordedOn,
      today: params.today,
      allowDecrease: params.allowDecrease,
      excludeId: existing.id,
    });
  }
  const set: Partial<typeof asset_meter_readings.$inferInsert> = {};
  if (params.reading !== undefined) set.reading = params.reading;
  if (params.recordedOn !== undefined) set.recorded_on = params.recordedOn;
  if (params.notes !== undefined) set.notes = params.notes;
  if (Object.keys(set).length === 0) return existing;
  const [row] = await db.update(asset_meter_readings).set(set).where(eq(asset_meter_readings.id, existing.id)).returning();
  return row ?? existing;
}

// Corrections VOID, never delete — history keeps its meaning. Returns the
// voided row, or null when there was nothing live to void.
export async function voidReading(db: DbOrTx, assetId: string, readingId: string): Promise<ReadingRow | null> {
  const [row] = await db
    .update(asset_meter_readings)
    .set({ voided_at: new Date().toISOString() })
    .where(
      and(
        eq(asset_meter_readings.id, readingId),
        eq(asset_meter_readings.asset_id, assetId),
        isNull(asset_meter_readings.voided_at),
      ),
    )
    .returning();
  return row ?? null;
}
