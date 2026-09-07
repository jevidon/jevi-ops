import { and, asc, desc, eq, inArray, isNull, lte } from 'drizzle-orm';
import type { DbOrTx } from './maintenance-tx.js';
import { asset_meter_readings } from '../db/schema.js';

// Latest NON-VOIDED reading per asset, one query. Small tables (manual
// logs), so fetching the candidate rows and reducing in JS beats a
// DISTINCT ON escape hatch for readability. Own module because both the
// completion lib and the attention rules need it, and those two import in
// opposite directions.
//
// "Latest" means the same everywhere: newest recorded_on, ties broken by
// created_at. Voided rows (corrections, 0048) never count.

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
      ),
    )
    .orderBy(desc(asset_meter_readings.recorded_on), desc(asset_meter_readings.created_at))
    .limit(1);
  return row ?? null;
}
