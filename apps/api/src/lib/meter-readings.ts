import { asc, desc, inArray } from 'drizzle-orm';
import type { Db } from './db.js';
import { asset_meter_readings } from '../db/schema.js';

// Latest reading per asset, one query. Small tables (manual logs), so
// fetching the candidate rows and reducing in JS beats a DISTINCT ON
// escape hatch for readability. Own module (not lib/maintenance.ts)
// because both the completion lib and the attention rules need it, and
// those two already import in opposite directions.
//
// "Latest" means the same everywhere: newest recorded_on, ties broken by
// created_at.
export async function latestReadingByAsset(db: Db, assetIds: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (assetIds.length === 0) return map;
  const rows = await db
    .select({
      asset_id: asset_meter_readings.asset_id,
      reading: asset_meter_readings.reading,
    })
    .from(asset_meter_readings)
    .where(inArray(asset_meter_readings.asset_id, assetIds))
    .orderBy(
      asc(asset_meter_readings.asset_id),
      desc(asset_meter_readings.recorded_on),
      desc(asset_meter_readings.created_at),
    );
  for (const r of rows) {
    if (!map.has(r.asset_id)) map.set(r.asset_id, r.reading);
  }
  return map;
}
