import { asc, eq } from 'drizzle-orm';
import { vehicle_assessments, vehicle_assessment_history } from '../db/knowledge-schema.js';
import type { Tx } from './maintenance-tx.js';
import { jsonEqual } from './command-error.js';

export async function recordAssessmentHistory(tx: Tx, row: typeof vehicle_assessments.$inferSelect, actor: string, reason: string): Promise<void> {
  await tx.insert(vehicle_assessment_history).values({ assessment_id: row.id, revision: row.revision, snapshot: row, actor, reason });
}

// The caller holds the asset lock. This module deliberately has no command
// imports: asset updates can invalidate knowledge without a dependency cycle.
export async function invalidateVehicleAssessments(
  tx: Tx,
  assetId: string,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  actor: string,
): Promise<void> {
  const changed = new Set([...Object.keys(before), ...Object.keys(after)].filter((key) => !jsonEqual(before[key], after[key])));
  if (!changed.size) return;
  const rows = await tx.select().from(vehicle_assessments).where(eq(vehicle_assessments.asset_id, assetId)).orderBy(asc(vehicle_assessments.id)).for('update');
  for (const row of rows) {
    const affected = Object.keys(row.relevant_facts).filter((key) => changed.has(key));
    if (!affected.length) continue;
    const reason = `Relevant vehicle facts changed: ${affected.join(', ')}.`;
    const [updated] = await tx.update(vehicle_assessments).set({
      review_state: 'needs_review', revision: row.revision + 1,
      invalidation_reason: reason, updated_at: new Date().toISOString(),
    }).where(eq(vehicle_assessments.id, row.id)).returning();
    if (updated) await recordAssessmentHistory(tx, updated, actor, reason);
  }
}
