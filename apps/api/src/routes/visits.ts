import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { and, eq, inArray } from 'drizzle-orm';
import { CompleteVisitSchema, CreateVisitSchema, UpdateVisitSchema } from '@jevi-ops/shared';
import { getAppSettings } from '../lib/app-settings.js';
import { getDb } from '../lib/db.js';
import { MaintenanceConflict, MaintenanceNeedsDetails } from '../lib/maintenance.js';
import { runMaintenanceSweep } from '../lib/maintenance-sweep.js';
import { ReadingRejected } from '../lib/meter-readings.js';
import { todayInTz } from '../lib/tz.js';
import { VisitError, completeVisit, deleteVisit, listVisits, syncVisitEvidence, type VisitLine } from '../lib/visits.js';
import { assets, maintenance_items, maintenance_visit_items, maintenance_visits, type StoredAttachment } from '../db/schema.js';

// Service visits (0051). Planned = a saved work order; done = the record
// (one reading, N completions, one invoice) — see lib/visits.ts. Provenance
// follows the credential like every other maintenance write.

function provenance(req: FastifyRequest, declared?: 'agent' | 'import'): { source: 'manual' | 'agent' | 'import'; actor: string } {
  const actor = req.authMethod === 'api_token' ? req.user!.email : `session:${req.user!.email}`;
  const source = req.authMethod === 'api_token' ? (declared ?? 'agent') : 'manual';
  return { source, actor };
}

function sendVisitError(reply: FastifyReply, err: unknown): boolean {
  if (err instanceof MaintenanceNeedsDetails) {
    reply.code(400).send({ error: 'needs_details', item_id: err.itemId, item_name: err.itemName, policy: err.policy, fields: err.fields, message: err.message });
    return true;
  }
  if (err instanceof MaintenanceConflict) {
    reply.code(409).send({ error: err.code, message: err.message });
    return true;
  }
  if (err instanceof ReadingRejected) {
    reply.code(err.code === 'event_key_conflict' ? 409 : 400).send({ error: err.code, message: err.message });
    return true;
  }
  if (err instanceof VisitError) {
    const status = err.code === 'visit_not_found' ? 404 : err.code === 'visit_not_planned' || err.code === 'visit_not_done' ? 409 : 400;
    reply.code(status).send({ error: err.code, message: err.message });
    return true;
  }
  return false;
}

function toLines(lines: Array<{ item_id: string; skipped?: boolean; cost?: number | null; notes?: string | null; issued_until?: string | null; purchased_to?: number | null; finding?: string | null; next_review_on?: string | null; next_review_meter?: number | null }>): VisitLine[] {
  return lines.map((l) => ({
    itemId: l.item_id,
    skipped: l.skipped,
    cost: l.cost ?? null,
    notes: l.notes ?? null,
    issuedUntil: l.issued_until ?? null,
    purchasedTo: l.purchased_to ?? null,
    finding: l.finding ?? null,
    nextReviewOn: l.next_review_on ?? null,
    nextReviewMeter: l.next_review_meter ?? null,
  }));
}

export const visitRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.requireAuth);

  async function ctx() {
    const s = await getAppSettings();
    return { today: todayInTz(s.timezone), staleDays: s.meter_stale_days };
  }

  app.get<{ Params: { id: string } }>('/api/assets/:id/visits', async (req, reply) => {
    const db = getDb();
    const asset = await db.query.assets.findFirst({ columns: { id: true }, where: eq(assets.id, req.params.id) });
    if (!asset) return reply.code(404).send({ error: 'not_found' });
    return { visits: await listVisits(db, asset.id) };
  });

  app.get<{ Params: { id: string } }>('/api/visits/:id', async (req, reply) => {
    const db = getDb();
    const visit = await db.query.maintenance_visits.findFirst({ columns: { asset_id: true }, where: eq(maintenance_visits.id, req.params.id) });
    if (!visit) return reply.code(404).send({ error: 'not_found' });
    const all = await listVisits(db, visit.asset_id);
    return { visit: all.find((v) => v.id === req.params.id) ?? null };
  });

  // A planned visit (work order) or a visit logged outright (done).
  app.post<{ Params: { id: string } }>('/api/assets/:id/visits', async (req, reply) => {
    const parsed = CreateVisitSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_payload', details: parsed.error.flatten().fieldErrors });
    }
    const db = getDb();
    const asset = await db.query.assets.findFirst({ where: eq(assets.id, req.params.id) });
    if (!asset) return reply.code(404).send({ error: 'not_found' });
    const { today } = await ctx();
    const d = parsed.data;

    if (d.status === 'planned') {
      const ids = d.items.map((i) => i.item_id);
      const onAsset = await db.select({ id: maintenance_items.id }).from(maintenance_items).where(and(inArray(maintenance_items.id, ids), eq(maintenance_items.asset_id, asset.id)));
      if (onAsset.length !== new Set(ids).size) {
        return reply.code(400).send({ error: 'item_not_on_asset', message: 'Every line must be an item on this asset.' });
      }
      const { actor } = provenance(req);
      const visit = await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(maintenance_visits)
          .values({ asset_id: asset.id, status: 'planned', planned_on: d.planned_on ?? null, provider: d.provider ?? null, notes: d.notes ?? null, actor })
          .returning();
        await tx.insert(maintenance_visit_items).values(d.items.map((i, position) => ({ visit_id: row!.id, item_id: i.item_id, notes: i.notes ?? null, position })));
        return row!;
      });
      const all = await listVisits(db, asset.id);
      return reply.code(201).send({ visit: all.find((v) => v.id === visit.id) ?? visit });
    }

    const visitedOn = d.visited_on ?? today;
    if (visitedOn > today) return reply.code(400).send({ error: 'future_completion', message: 'A visit cannot be dated in the future.' });
    const { source, actor } = provenance(req, d.source);
    try {
      const result = await completeVisit(db, {
        assetId: asset.id,
        visitedOn,
        today,
        meter: d.meter ?? null,
        allowDecrease: d.allow_decrease,
        provider: d.provider ?? null,
        invoiceNumber: d.invoice_number ?? null,
        currency: d.currency ?? null,
        total: d.total ?? null,
        notes: d.notes ?? null,
        attachments: (d.attachments as StoredAttachment[] | undefined) ?? null,
        eventKey: d.event_key ?? null,
        runId: d.run_id ?? null,
        source,
        actor,
        lines: toLines(d.lines),
      });
      const all = await listVisits(db, asset.id);
      return reply.code(result.logged ? 201 : 200).send({ visit: all.find((v) => v.id === result.visit.id) ?? result.visit, lines: result.lines, logged: result.logged });
    } catch (err) {
      if (sendVisitError(reply, err)) return reply;
      throw err;
    }
  });

  // Complete a planned visit: the plan's lines by default, with the day's
  // evidence per line; a line the workshop skipped stays due.
  app.post<{ Params: { id: string } }>('/api/visits/:id/complete', async (req, reply) => {
    const parsed = CompleteVisitSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_payload', details: parsed.error.flatten().fieldErrors });
    }
    const db = getDb();
    const planned = await db.query.maintenance_visits.findFirst({ where: eq(maintenance_visits.id, req.params.id) });
    if (!planned) return reply.code(404).send({ error: 'not_found' });
    if (planned.status !== 'planned') return reply.code(409).send({ error: 'visit_not_planned', message: 'This visit is already recorded.' });
    const { today } = await ctx();
    const d = parsed.data;
    const visitedOn = d.visited_on ?? today;
    if (visitedOn > today) return reply.code(400).send({ error: 'future_completion', message: 'A visit cannot be dated in the future.' });
    const { source, actor } = provenance(req, d.source);
    try {
      const result = await completeVisit(db, {
        assetId: planned.asset_id,
        visitId: planned.id,
        visitedOn,
        today,
        meter: d.meter ?? null,
        allowDecrease: d.allow_decrease,
        provider: d.provider ?? planned.provider,
        invoiceNumber: d.invoice_number ?? null,
        currency: d.currency ?? null,
        total: d.total ?? null,
        notes: d.notes ?? planned.notes,
        attachments: (d.attachments as StoredAttachment[] | undefined) ?? null,
        eventKey: d.event_key ?? null,
        runId: d.run_id ?? null,
        source,
        actor,
        lines: toLines(d.lines),
      });
      const all = await listVisits(db, planned.asset_id);
      return reply.code(result.logged ? 201 : 200).send({ visit: all.find((v) => v.id === result.visit.id) ?? result.visit, lines: result.lines, logged: result.logged });
    } catch (err) {
      if (sendVisitError(reply, err)) return reply;
      throw err;
    }
  });

  app.patch<{ Params: { id: string } }>('/api/visits/:id', async (req, reply) => {
    const parsed = UpdateVisitSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_payload', details: parsed.error.flatten().fieldErrors });
    }
    const db = getDb();
    const c = await ctx();
    const d = parsed.data;
    const { actor } = provenance(req);
    try {
      const visit = await db.transaction(async (tx) => {
        const [existing] = await tx.select().from(maintenance_visits).where(eq(maintenance_visits.id, req.params.id)).for('update');
        if (!existing) return null;
        const facts: Partial<typeof maintenance_visits.$inferInsert> = {};
        if ('provider' in d) facts.provider = d.provider ?? null;
        if ('invoice_number' in d) facts.invoice_number = d.invoice_number ?? null;
        if ('currency' in d) facts.currency = d.currency ?? null;
        if ('total' in d) facts.total = d.total ?? null;
        if ('notes' in d) facts.notes = d.notes ?? null;
        if (d.attachments) facts.attachments = d.attachments as StoredAttachment[];
        if (existing.status === 'planned') {
          if ('planned_on' in d) facts.planned_on = d.planned_on ?? null;
          if (d.items) {
            const ids = d.items.map((i) => i.item_id);
            const onAsset = await tx.select({ id: maintenance_items.id }).from(maintenance_items).where(and(inArray(maintenance_items.id, ids), eq(maintenance_items.asset_id, existing.asset_id)));
            if (onAsset.length !== new Set(ids).size) throw new VisitError('item_not_on_asset', 'Every line must be an item on this asset.');
            await tx.delete(maintenance_visit_items).where(eq(maintenance_visit_items.visit_id, existing.id));
            if (d.items.length > 0) {
              await tx.insert(maintenance_visit_items).values(d.items.map((i, position) => ({ visit_id: existing.id, item_id: i.item_id, notes: i.notes ?? null, position })));
            }
          }
        }
        let row = existing;
        if (Object.keys(facts).length > 0) {
          const [r] = await tx.update(maintenance_visits).set(facts).where(eq(maintenance_visits.id, existing.id)).returning();
          row = r ?? existing;
        }
        if (existing.status === 'done' && (d.visited_on !== undefined || d.meter !== undefined)) {
          if (d.visited_on && d.visited_on > c.today) throw new ReadingRejected('future_reading', 'A visit cannot be dated in the future.');
          row = await syncVisitEvidence(tx, row, { visitedOn: d.visited_on, meter: d.meter, allowDecrease: d.allow_decrease, actor }, c);
        }
        return row;
      });
      if (!visit) return reply.code(404).send({ error: 'not_found' });
      if (visit.status === 'done' && (d.visited_on !== undefined || d.meter !== undefined)) {
        try {
          await runMaintenanceSweep(db);
        } catch (err) {
          req.log.warn({ err }, 'post-visit-edit sweep failed');
        }
      }
      const all = await listVisits(db, visit.asset_id);
      return { visit: all.find((v) => v.id === visit.id) ?? visit };
    } catch (err) {
      if (sendVisitError(reply, err)) return reply;
      throw err;
    }
  });

  // Planned: delete the plan. Done: undo the whole visit — every line's
  // completion comes out, the single reading is voided.
  app.delete<{ Params: { id: string } }>('/api/visits/:id', async (req, reply) => {
    const db = getDb();
    const c = await ctx();
    const result = await deleteVisit(db, req.params.id, c);
    if (!result.deleted) return reply.code(404).send({ error: 'not_found' });
    return result;
  });
};
