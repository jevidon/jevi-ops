import type { FastifyPluginAsync } from 'fastify';
import { and, asc, count, desc, eq, inArray } from 'drizzle-orm';
import {
  CompleteMaintenanceSchema,
  CreateAssetSchema,
  CreateMaintenanceItemSchema,
  CreateMeterReadingSchema,
  INBOX_DOMAIN_ID,
  UpdateAssetSchema,
  UpdateMaintenanceItemSchema,
  maintenanceDueState,
  nextAfterCompletion,
} from '@jevi-ops/shared';
import { getAppTz } from '../lib/app-settings.js';
import { clearAttentionForSource } from '../lib/attention.js';
import { getDb } from '../lib/db.js';
import type { Db } from '../lib/db.js';
import { completeMaintenanceItem } from '../lib/maintenance.js';
import { todayInTz } from '../lib/tz.js';
import { asset_meter_readings, assets, maintenance_items, maintenance_logs } from '../db/schema.js';

// Maintenance module (migration 0047): assets + meter readings +
// maintenance items + completion logs. Deliberately flat JSON with no UI
// coupling — the future vehicle-agent drives these same endpoints
// headlessly. Cadence semantics (re-anchor from completion,
// whichever-first over date/meter) live in @jevi-ops/shared/maintenance.

type ItemRow = typeof maintenance_items.$inferSelect;

// Latest reading per asset, one query. Small tables (manual logs), so
// fetching the candidate rows and reducing in JS beats a DISTINCT ON
// escape hatch for readability.
async function latestReadingByAsset(db: Db, assetIds: string[]): Promise<Map<string, number>> {
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

function withDueState(
  item: ItemRow,
  todayIso: string,
  latestMeter: number | null,
): ItemRow & { latest_reading: number | null; due_state: ReturnType<typeof maintenanceDueState> } {
  return {
    ...item,
    latest_reading: latestMeter,
    due_state: maintenanceDueState({ todayIso, latestMeter, item }),
  };
}

// Sort: overdue → due → due_soon → ok, then soonest date inside each band.
const STATUS_ORDER: Record<string, number> = { overdue: 0, due: 1, due_soon: 2, ok: 3 };
function dueSort(
  a: { due_state: { status: string }; next_due_date: string | null },
  b: { due_state: { status: string }; next_due_date: string | null },
): number {
  const band = (STATUS_ORDER[a.due_state.status] ?? 9) - (STATUS_ORDER[b.due_state.status] ?? 9);
  if (band !== 0) return band;
  return (a.next_due_date ?? '9999-12-31').localeCompare(b.next_due_date ?? '9999-12-31');
}

// Cross-table cadence rule: a meter interval only makes sense on an asset
// with a meter. Returns an error string or null.
async function validateMeterInterval(
  db: Db,
  intervalMeter: number | null,
  assetId: string | null,
): Promise<string | null> {
  if (intervalMeter == null) return null;
  if (!assetId) return 'interval_meter requires the item to be attached to an asset with a meter_unit.';
  const asset = await db.query.assets.findFirst({
    columns: { meter_unit: true },
    where: eq(assets.id, assetId),
  });
  if (!asset) return 'asset_id does not exist.';
  if (!asset.meter_unit) return 'interval_meter requires the asset to have a meter_unit.';
  return null;
}

export const maintenanceRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.requireAuth);

  // ─── Assets ───────────────────────────────────────────────────────────

  app.get<{ Querystring: { include_archived?: string } }>('/api/assets', async (req) => {
    const db = getDb();
    const includeArchived = req.query.include_archived === 'true';
    const rows = await db.query.assets.findMany({
      orderBy: [asc(assets.name)],
    });
    const visible = includeArchived ? rows : rows.filter((a) => !a.archived_at);
    const readings = await latestReadingByAsset(db, visible.map((a) => a.id));

    const tz = await getAppTz();
    const today = todayInTz(tz);
    const counts = await db
      .select({ asset_id: maintenance_items.asset_id, n: count() })
      .from(maintenance_items)
      .where(eq(maintenance_items.active, true))
      .groupBy(maintenance_items.asset_id);
    const countMap = new Map(counts.map((c) => [c.asset_id, c.n]));

    // Days since the latest reading — the agent's staleness signal, and
    // the "nag for an odometer update" input.
    const latestDates = await db
      .select({
        asset_id: asset_meter_readings.asset_id,
        recorded_on: asset_meter_readings.recorded_on,
      })
      .from(asset_meter_readings)
      .orderBy(asc(asset_meter_readings.asset_id), desc(asset_meter_readings.recorded_on));
    const latestDateMap = new Map<string, string>();
    for (const r of latestDates) {
      if (!latestDateMap.has(r.asset_id)) latestDateMap.set(r.asset_id, r.recorded_on);
    }

    return {
      assets: visible.map((a) => {
        const lastOn = latestDateMap.get(a.id) ?? null;
        const daysSince = lastOn
          ? Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${lastOn}T12:00:00Z`)) / 86_400_000)
          : null;
        return {
          ...a,
          latest_reading: readings.get(a.id) ?? null,
          latest_reading_on: lastOn,
          latest_reading_days_ago: daysSince,
          active_item_count: countMap.get(a.id) ?? 0,
        };
      }),
    };
  });

  // Asset + recent readings + its items with due_state — one round-trip.
  // This response is also the future agent's per-asset context bundle.
  app.get<{ Params: { id: string } }>('/api/assets/:id', async (req, reply) => {
    const db = getDb();
    const asset = await db.query.assets.findFirst({ where: eq(assets.id, req.params.id) });
    if (!asset) return reply.code(404).send({ error: 'not_found' });

    const [readings, items] = await Promise.all([
      db.query.asset_meter_readings.findMany({
        where: eq(asset_meter_readings.asset_id, asset.id),
        orderBy: [desc(asset_meter_readings.recorded_on), desc(asset_meter_readings.created_at)],
        limit: 50,
      }),
      db.query.maintenance_items.findMany({
        where: eq(maintenance_items.asset_id, asset.id),
        orderBy: [asc(maintenance_items.name)],
      }),
    ]);

    const tz = await getAppTz();
    const today = todayInTz(tz);
    const latest = readings[0]?.reading ?? null;
    const withState = items.map((i) => withDueState(i, today, latest)).sort(dueSort);
    return { asset, readings, items: withState, today };
  });

  app.post('/api/assets', async (req, reply) => {
    const parsed = CreateAssetSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_payload', details: parsed.error.flatten().fieldErrors });
    }
    const db = getDb();
    const [row] = await db
      .insert(assets)
      .values({
        name: parsed.data.name,
        kind: parsed.data.kind ?? 'other',
        domain_id: parsed.data.domain_id ?? null,
        meter_unit: parsed.data.meter_unit ?? null,
        metadata: parsed.data.metadata ?? {},
        notes: parsed.data.notes ?? null,
      })
      .returning();
    return reply.code(201).send({ asset: row });
  });

  app.patch<{ Params: { id: string } }>('/api/assets/:id', async (req, reply) => {
    const parsed = UpdateAssetSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_payload', details: parsed.error.flatten().fieldErrors });
    }
    const db = getDb();

    // Clearing meter_unit while meter-cadence items depend on it would
    // orphan their schedules — refuse until those items change first.
    if ('meter_unit' in parsed.data && parsed.data.meter_unit == null) {
      const [dependent] = await db
        .select({ n: count() })
        .from(maintenance_items)
        .where(
          and(
            eq(maintenance_items.asset_id, req.params.id),
            eq(maintenance_items.active, true),
          ),
        );
      if (dependent && dependent.n > 0) {
        const items = await db.query.maintenance_items.findMany({
          columns: { interval_meter: true },
          where: and(eq(maintenance_items.asset_id, req.params.id), eq(maintenance_items.active, true)),
        });
        if (items.some((i) => i.interval_meter != null)) {
          return reply.code(400).send({
            error: 'meter_in_use',
            message: 'Active meter-cadence items depend on this meter. Update or deactivate them first.',
          });
        }
      }
    }

    const [row] = await db.update(assets).set(parsed.data).where(eq(assets.id, req.params.id)).returning();
    if (!row) return reply.code(404).send({ error: 'not_found' });
    return { asset: row };
  });

  app.delete<{ Params: { id: string } }>('/api/assets/:id', async (req, reply) => {
    const db = getDb();
    const [row] = await db.delete(assets).where(eq(assets.id, req.params.id)).returning({ id: assets.id });
    if (!row) return reply.code(404).send({ error: 'not_found' });
    return { deleted: true };
  });

  // ─── Meter readings ──────────────────────────────────────────────────

  app.post<{ Params: { id: string } }>('/api/assets/:id/readings', async (req, reply) => {
    const parsed = CreateMeterReadingSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_payload', details: parsed.error.flatten().fieldErrors });
    }
    const db = getDb();
    const asset = await db.query.assets.findFirst({ where: eq(assets.id, req.params.id) });
    if (!asset) return reply.code(404).send({ error: 'not_found' });
    if (!asset.meter_unit) {
      return reply.code(400).send({ error: 'no_meter', message: 'This asset has no meter_unit.' });
    }

    const tz = await getAppTz();
    const [row] = await db
      .insert(asset_meter_readings)
      .values({
        asset_id: asset.id,
        reading: parsed.data.reading,
        recorded_on: parsed.data.recorded_on ?? todayInTz(tz),
        notes: parsed.data.notes ?? null,
        source: 'manual',
      })
      .returning();
    // A fresh reading can resolve the "meter reading is stale" nag
    // immediately (rule ships with the awareness build; no-op until then).
    try {
      await clearAttentionForSource(db, 'asset', asset.id, ['meter_reading_stale']);
    } catch {
      // Best-effort only.
    }
    return reply.code(201).send({ reading: row });
  });

  // ─── Maintenance items ───────────────────────────────────────────────

  app.get<{ Querystring: { asset_id?: string; include_inactive?: string } }>(
    '/api/maintenance',
    async (req) => {
      const db = getDb();
      const conditions = [];
      if (req.query.include_inactive !== 'true') conditions.push(eq(maintenance_items.active, true));
      if (req.query.asset_id) conditions.push(eq(maintenance_items.asset_id, req.query.asset_id));

      const items = await db.query.maintenance_items.findMany({
        where: conditions.length ? and(...conditions) : undefined,
        with: { asset: { columns: { id: true, name: true, kind: true, meter_unit: true } } },
        orderBy: [asc(maintenance_items.name)],
      });

      const assetIds = [...new Set(items.map((i) => i.asset_id).filter((v): v is string => v != null))];
      const readings = await latestReadingByAsset(db, assetIds);
      const tz = await getAppTz();
      const today = todayInTz(tz);

      const rows = items
        .map((i) => ({
          ...withDueState(i, today, i.asset_id ? (readings.get(i.asset_id) ?? null) : null),
          asset: i.asset ?? null,
        }))
        .sort(dueSort);
      return { items: rows, today };
    },
  );

  app.get<{ Params: { id: string } }>('/api/maintenance/:id', async (req, reply) => {
    const db = getDb();
    const item = await db.query.maintenance_items.findFirst({
      where: eq(maintenance_items.id, req.params.id),
      with: { asset: { columns: { id: true, name: true, kind: true, meter_unit: true } } },
    });
    if (!item) return reply.code(404).send({ error: 'not_found' });

    const logs = await db.query.maintenance_logs.findMany({
      where: eq(maintenance_logs.item_id, item.id),
      orderBy: [desc(maintenance_logs.completed_on)],
    });
    const readings = item.asset_id ? await latestReadingByAsset(db, [item.asset_id]) : new Map<string, number>();
    const tz = await getAppTz();
    const today = todayInTz(tz);
    const latest = item.asset_id ? (readings.get(item.asset_id) ?? null) : null;
    return { item: { ...withDueState(item, today, latest), asset: item.asset ?? null }, logs, today };
  });

  app.post('/api/maintenance', async (req, reply) => {
    const parsed = CreateMaintenanceItemSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_payload', details: parsed.error.flatten().fieldErrors });
    }
    const db = getDb();
    const d = parsed.data;

    const meterError = await validateMeterInterval(db, d.interval_meter ?? null, d.asset_id ?? null);
    if (meterError) return reply.code(400).send({ error: 'invalid_cadence', message: meterError });

    // Domain: explicit > inherit from asset > Inbox (tasks precedent).
    let domainId = d.domain_id ?? null;
    if (!domainId && d.asset_id) {
      const asset = await db.query.assets.findFirst({
        columns: { domain_id: true },
        where: eq(assets.id, d.asset_id),
      });
      domainId = asset?.domain_id ?? null;
    }
    domainId ??= INBOX_DOMAIN_ID;

    const tz = await getAppTz();
    const today = todayInTz(tz);
    const cadence = {
      interval_days: d.interval_days ?? null,
      interval_months: d.interval_months ?? null,
      interval_meter: d.interval_meter ?? null,
    };

    // Materialize next-due: explicit override > seed from provided history
    // > anchor the date axis at today (a new quarterly item is due one
    // quarter out, not instantly overdue). The meter axis stays null until
    // there's a meter to anchor to.
    const seeded = nextAfterCompletion({
      completedOn: d.last_completed_on ?? today,
      meterAtCompletion: d.last_completed_meter ?? null,
      cadence,
    });
    const nextDueDate = d.next_due_date !== undefined ? d.next_due_date : seeded.next_due_date;
    const nextDueMeter = d.next_due_meter !== undefined ? d.next_due_meter : seeded.next_due_meter;

    const [row] = await db
      .insert(maintenance_items)
      .values({
        name: d.name,
        notes: d.notes ?? null,
        asset_id: d.asset_id ?? null,
        domain_id: domainId,
        ...cadence,
        lead_days: d.lead_days ?? 14,
        lead_meter: d.lead_meter ?? null,
        next_due_date: nextDueDate,
        next_due_meter: nextDueMeter,
        last_completed_on: d.last_completed_on ?? null,
        last_completed_meter: d.last_completed_meter ?? null,
        metadata: d.metadata ?? {},
      })
      .returning();
    return reply.code(201).send({ item: row });
  });

  app.patch<{ Params: { id: string } }>('/api/maintenance/:id', async (req, reply) => {
    const parsed = UpdateMaintenanceItemSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_payload', details: parsed.error.flatten().fieldErrors });
    }
    const db = getDb();
    const existing = await db.query.maintenance_items.findFirst({
      where: eq(maintenance_items.id, req.params.id),
    });
    if (!existing) return reply.code(404).send({ error: 'not_found' });
    const d = parsed.data;

    // Merged-cadence validation — the Zod XOR/at-least-one checks can't see
    // the columns a partial patch leaves untouched.
    const merged = {
      interval_days: 'interval_days' in d ? (d.interval_days ?? null) : existing.interval_days,
      interval_months: 'interval_months' in d ? (d.interval_months ?? null) : existing.interval_months,
      interval_meter: 'interval_meter' in d ? (d.interval_meter ?? null) : existing.interval_meter,
    };
    if (merged.interval_days == null && merged.interval_months == null && merged.interval_meter == null) {
      return reply.code(400).send({
        error: 'invalid_cadence',
        message: 'At least one of interval_days, interval_months, interval_meter is required.',
      });
    }
    if (merged.interval_days != null && merged.interval_months != null) {
      return reply.code(400).send({
        error: 'invalid_cadence',
        message: 'Use interval_days or interval_months, not both.',
      });
    }
    const mergedAssetId = 'asset_id' in d ? (d.asset_id ?? null) : existing.asset_id;
    const meterError = await validateMeterInterval(db, merged.interval_meter, mergedAssetId);
    if (meterError) return reply.code(400).send({ error: 'invalid_cadence', message: meterError });

    const update: Partial<typeof maintenance_items.$inferInsert> = {};
    if (d.name !== undefined) update.name = d.name;
    if ('notes' in d) update.notes = d.notes ?? null;
    if ('asset_id' in d) update.asset_id = d.asset_id ?? null;
    if (d.domain_id !== undefined) update.domain_id = d.domain_id;
    if ('interval_days' in d) update.interval_days = d.interval_days ?? null;
    if ('interval_months' in d) update.interval_months = d.interval_months ?? null;
    if ('interval_meter' in d) update.interval_meter = d.interval_meter ?? null;
    if (d.lead_days !== undefined) update.lead_days = d.lead_days;
    if ('lead_meter' in d) update.lead_meter = d.lead_meter ?? null;
    if (d.active !== undefined) update.active = d.active;
    if (d.metadata !== undefined) update.metadata = d.metadata;

    // Cadence edits recompute the materialized next-due from the last
    // completion (today-anchored when there's none) — unless the patch
    // pins next_due_* explicitly.
    const cadenceChanged =
      'interval_days' in d || 'interval_months' in d || 'interval_meter' in d;
    if ('next_due_date' in d) update.next_due_date = d.next_due_date ?? null;
    if ('next_due_meter' in d) update.next_due_meter = d.next_due_meter ?? null;
    if (cadenceChanged && !('next_due_date' in d) && !('next_due_meter' in d)) {
      const tz = await getAppTz();
      const today = todayInTz(tz);
      let meterAnchor = existing.last_completed_meter;
      if (meterAnchor == null && merged.interval_meter != null && mergedAssetId) {
        const readings = await latestReadingByAsset(db, [mergedAssetId]);
        meterAnchor = readings.get(mergedAssetId) ?? null;
      }
      const next = nextAfterCompletion({
        completedOn: existing.last_completed_on ?? today,
        meterAtCompletion: meterAnchor,
        cadence: merged,
      });
      update.next_due_date = next.next_due_date;
      update.next_due_meter = next.next_due_meter;
    }

    const [row] = await db
      .update(maintenance_items)
      .set(update)
      .where(eq(maintenance_items.id, req.params.id))
      .returning();
    return { item: row };
  });

  app.delete<{ Params: { id: string } }>('/api/maintenance/:id', async (req, reply) => {
    const db = getDb();
    const [row] = await db
      .delete(maintenance_items)
      .where(eq(maintenance_items.id, req.params.id))
      .returning({ id: maintenance_items.id });
    if (!row) return reply.code(404).send({ error: 'not_found' });
    return { deleted: true };
  });

  // ─── Completion ──────────────────────────────────────────────────────

  app.post<{ Params: { id: string } }>('/api/maintenance/:id/complete', async (req, reply) => {
    const parsed = CompleteMaintenanceSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_payload', details: parsed.error.flatten().fieldErrors });
    }
    const db = getDb();
    const tz = await getAppTz();
    const result = await completeMaintenanceItem(db, req.params.id, {
      completedOn: parsed.data.completed_on ?? todayInTz(tz),
      meter: parsed.data.meter ?? null,
      notes: parsed.data.notes ?? null,
      cost: parsed.data.cost ?? null,
      source: 'manual',
    });
    if (!result) return reply.code(404).send({ error: 'not_found' });
    return { item: result.item, logged: result.logged };
  });

  // Undo a completion: remove the log, re-derive last_completed_* and the
  // materialized next-due from the remaining history (fresh-create
  // semantics when none remains: date axis anchored at today, meter null).
  app.delete<{ Params: { id: string; logId: string } }>(
    '/api/maintenance/:id/logs/:logId',
    async (req, reply) => {
      const db = getDb();
      const item = await db.query.maintenance_items.findFirst({
        where: eq(maintenance_items.id, req.params.id),
      });
      if (!item) return reply.code(404).send({ error: 'not_found' });

      const [deleted] = await db
        .delete(maintenance_logs)
        .where(and(eq(maintenance_logs.id, req.params.logId), eq(maintenance_logs.item_id, item.id)))
        .returning({ id: maintenance_logs.id });
      if (!deleted) return reply.code(404).send({ error: 'not_found' });

      const latestLog = await db.query.maintenance_logs.findFirst({
        where: eq(maintenance_logs.item_id, item.id),
        orderBy: [desc(maintenance_logs.completed_on)],
      });
      const tz = await getAppTz();
      const today = todayInTz(tz);
      const next = nextAfterCompletion({
        completedOn: latestLog?.completed_on ?? today,
        meterAtCompletion: latestLog?.meter_at_completion ?? null,
        cadence: {
          interval_days: item.interval_days,
          interval_months: item.interval_months,
          interval_meter: item.interval_meter,
        },
      });
      const [row] = await db
        .update(maintenance_items)
        .set({
          last_completed_on: latestLog?.completed_on ?? null,
          last_completed_meter: latestLog?.meter_at_completion ?? null,
          next_due_date: next.next_due_date,
          next_due_meter: next.next_due_meter,
        })
        .where(eq(maintenance_items.id, item.id))
        .returning();
      return { item: row };
    },
  );
};
