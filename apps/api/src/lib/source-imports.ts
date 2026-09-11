import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { AcceptSourceCandidateSchema, CreateSourceCandidateSchema, UpdateSourceCandidateSchema } from '@jevi-ops/shared';
import { assets, source_candidates, source_links } from '../db/schema.js';
import { onboardingFingerprint } from './onboarding.js';
import { inTransaction, type DbOrTx } from './maintenance-tx.js';
import { getSourceLink, lockSourceSubject, SourceError, sourceSubjectWhere } from './private-sources.js';
import { completeVisit } from './visits.js';

export async function createSourceCandidate(db: DbOrTx, linkId: string, raw: unknown, ownerId: string, actor: string) {
  const input = CreateSourceCandidateSchema.parse(raw);
  const fingerprint = onboardingFingerprint(input.candidate);
  return inTransaction(db, async (tx) => {
    await lockSourceSubject(tx, input.subject, ownerId);
    const { link } = await getSourceLink(tx, linkId, ownerId);
    const [matched] = await tx.select().from(source_links).where(and(eq(source_links.id, link.id), sourceSubjectWhere(input.subject)));
    if (!matched) throw new SourceError(400, 'source_subject_mismatch', 'This source is not attached to the selected vehicle or draft.');
    const [old] = await tx.select().from(source_candidates).where(and(eq(source_candidates.source_link_id, linkId), eq(source_candidates.operation_key, input.operation_key)));
    if (old) {
      if (old.creation_fingerprint !== fingerprint) throw new SourceError(409, 'operation_key_conflict', 'The operation key already identifies different source evidence.');
      return old;
    }
    // Subject lock serialises duplicate candidate creation. Reimporting the
    // same evidence shows the old candidate/receipt even with a fresh UI key.
    const [duplicate] = await tx.select().from(source_candidates).where(and(eq(source_candidates.source_link_id, linkId), eq(source_candidates.creation_fingerprint, fingerprint)));
    if (duplicate) return duplicate;
    const [row] = await tx.insert(source_candidates).values({ source_link_id: linkId, operation_key: input.operation_key,
      creation_fingerprint: fingerprint, candidate: input.candidate, actor }).returning();
    return row!;
  });
}

export async function updateSourceCandidate(db: DbOrTx, id: string, raw: unknown, ownerId: string) {
  const input = UpdateSourceCandidateSchema.parse(raw);
  return inTransaction(db, async (tx) => {
    const [peek] = await tx.select().from(source_candidates).where(eq(source_candidates.id, id));
    if (!peek) throw new SourceError(404, 'candidate_not_found', 'Candidate not found.');
    const { link } = await getSourceLink(tx, peek.source_link_id, ownerId);
    await lockSourceSubject(tx, link.asset_id ? { asset_id: link.asset_id } : { session_id: link.session_id! }, ownerId);
    const [row] = await tx.select().from(source_candidates).where(eq(source_candidates.id, id)).for('update');
    if (!row || row.status !== 'pending' || row.revision !== input.expected_revision) throw new SourceError(409, 'candidate_conflict', 'This candidate changed; reload before saving.');
    const [updated] = await tx.update(source_candidates).set({ candidate: input.candidate, revision: row.revision + 1, updated_at: new Date().toISOString() }).where(eq(source_candidates.id, id)).returning();
    return updated!;
  });
}

export async function acceptSourceCandidate(db: DbOrTx, id: string, raw: unknown, ownerId: string, actor: string,
  context: { today: string; currency: string }) {
  const input = AcceptSourceCandidateSchema.parse(raw);
  const fingerprint = onboardingFingerprint(input);
  return inTransaction(db, async (tx) => {
    const [peek] = await tx.select().from(source_candidates).where(eq(source_candidates.id, id));
    if (!peek) throw new SourceError(404, 'candidate_not_found', 'Candidate not found.');
    const { link } = await getSourceLink(tx, peek.source_link_id, ownerId);
    if (!link.asset_id) throw new SourceError(409, 'vehicle_not_committed', 'Save the vehicle before accepting historical events. The raw evidence remains in your draft.');
    await lockSourceSubject(tx, { asset_id: link.asset_id }, ownerId);
    const [row] = await tx.select().from(source_candidates).where(eq(source_candidates.id, id)).for('update');
    if (!row) throw new SourceError(404, 'candidate_not_found', 'Candidate not found.');
    if (row.status === 'accepted') {
      if (row.accepted_key === input.operation_key && row.accepted_fingerprint === fingerprint) return row.receipt!;
      throw new SourceError(409, 'candidate_already_accepted', 'This source candidate already has an accepted event.');
    }
    if (row.status !== 'pending' || row.revision !== input.expected_revision) throw new SourceError(409, 'candidate_conflict', 'This candidate changed; review it again.');
    const c = row.candidate;
    if ((c.date_precision !== 'exact' || c.date_text !== input.visit.visited_on) && !input.date_confirmed) {
      throw new SourceError(400, 'exact_date_required', 'Confirm the actual service date; an approximate source date is not an exact event.');
    }
    const [asset] = await tx.select().from(assets).where(eq(assets.id, link.asset_id));
    if (!asset) throw new SourceError(404, 'asset_not_found', 'Asset not found.');
    if (input.visit.visited_on > context.today) throw new SourceError(400, 'future_completion', 'A historical event cannot be in the future.');
    if (input.visit.meter != null && !asset.meter_unit) throw new SourceError(400, 'meter_unit_required', 'Set the vehicle meter unit before importing a reading.');
    if (c.original_unit && c.original_reading != null && input.visit.meter != null) {
      const mixed = c.original_unit !== asset.meter_unit;
      if (mixed && !input.unit_conversion_confirmed) throw new SourceError(400, 'unit_conversion_required', 'Explicitly review the unit conversion before accepting this reading.');
      const amount = !mixed ? c.original_reading : c.original_unit === 'mi' && asset.meter_unit === 'km'
        ? c.original_reading * 1.609344 : c.original_unit === 'km' && asset.meter_unit === 'mi' ? c.original_reading / 1.609344 : NaN;
      if (!Number.isFinite(amount) || Math.abs(input.visit.meter - amount) > 0.011) throw new SourceError(400, 'source_reading_mismatch', 'The accepted reading must match the source or its reviewed conversion (within 0.01 units).');
    }
    const v = input.visit;
    const result = await completeVisit(tx, {
      assetId: asset.id, visitedOn: v.visited_on, today: context.today, meter: v.meter ?? null,
      provider: v.provider ?? null, invoiceNumber: v.invoice_number ?? null, currency: v.currency ?? null,
      defaultCurrency: context.currency, total: v.total ?? null, notes: v.notes ?? null,
      eventKey: `source-candidate:${row.id}`, source: 'import', actor, historicalOnly: true,
      lines: v.lines.map((l) => ({ itemId: l.item_id, skipped: l.skipped, skipReason: l.skip_reason ?? null,
        cost: l.cost ?? null, notes: l.notes ?? null, issuedUntil: l.issued_until ?? null,
        purchasedTo: l.purchased_to ?? null, finding: l.finding ?? null,
        nextReviewOn: l.next_review_on ?? null, nextReviewMeter: l.next_review_meter ?? null })),
    });
    const receipt = { candidate_id: id, source_id: link.source_id, source_link_id: link.id,
      asset_id: asset.id, visit_id: result.visit.id, operation_key: input.operation_key, accepted_at: new Date().toISOString() };
    await tx.update(source_candidates).set({ status: 'accepted', revision: row.revision + 1, receipt,
      accepted_key: input.operation_key, accepted_fingerprint: fingerprint, updated_at: receipt.accepted_at }).where(eq(source_candidates.id, id));
    return receipt;
  });
}
