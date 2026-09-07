import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { and, asc, count, desc, eq, isNull, sql } from 'drizzle-orm';
import {
  CompleteMaintenanceSchema,
  CreateAssetSchema,
  CreateMaintenanceItemSchema,
  CreateMeterReadingSchema,
  UpdateAssetSchema,
  UpdateMaintenanceItemSchema,
  UpdateMaintenanceLogSchema,
  UpdateMeterReadingSchema,
  effectiveDomainId,
  maintenanceDueState,
} from '@jevi-ops/shared';
import { getAppSettings } from '../lib/app-settings.js';
import { clearAttentionForSource } from '../lib/attention.js';
import { getDb } from '../lib/db.js';
import type { Db } from '../lib/db.js';
import {
  completeMaintenanceItem,
  deriveSchedule,
  lockItem,
  loadAsset,
  reconcileGeneratedWork,
  rederiveAndReconcile,
  type ItemRow,
} from '../lib/maintenance.js';
import { runMaintenanceSweep } from '../lib/maintenance-sweep.js';
import type { DbOrTx } from '../lib/maintenance-tx.js';
import { latestReadingRowByAsset, type LatestReading } from '../lib/meter-readings.js';
import { todayInTz } from '../lib/tz.js';
import {
  asset_meter_readings, assets, attention_items, maintenance_items, maintenance_logs, projects,
  type StoredAttachment,
} from '../db/schema.js';

// Maintenance module (migrations 0047 + 0048): assets + meter readings +
// maintenance items + completion logs. Deliberately flat JSON with no UI
// coupling — the future vehicle-agent drives these same endpoints
// headlessly. Cadence semantics (policies, re-anchor from completion,
// whichever-first over date/meter) live in @jevi-ops/shared/maintenance;
// every authoritative write goes through lib/maintenance.ts in a
// transaction with the item locked.
//
// Provenance is derived from the credential, never trusted from the
// payload: a session is always 'manual'; a named API token is 'agent'
// unless it declares 'import'.

function provenance(req: FastifyRequest, declared?: 'agent' | 'import'): { source: 'manual' | 'agent' | 'import'; actor: string } {
  const actor = req.authMethod === 'api_token' ? req.user!.email : `session:${req.user!.email}`;
  const source = req.authMethod === 'api_token' ? (declared ?? 'agent') : 'manual';
  return { source, actor };
}

type AssetRow = typeof assets.$inferSelect;
type ItemWithAsset = ItemRow & { asset?: Pick<AssetRow, 'id' | 'name' | 'kind' | 'meter_unit' | 'domain_id' | 'lifecycle'> | null };

async function policyContext(): Promise<{ today: string; staleDays: number }> {
  const s = await getAppSettings();
  return { today: todayInTz(s.timezone), staleDays: s.meter_stale_days };
}

function withDueState(
  item: ItemWithAsset,
  ctx: { today: string; staleDays: number },
  latest: LatestReading | null,
) {
  return {
    ...item,
    asset: item.asset ?? null,
    effective_domain_id: effectiveDomainId(item, item.asset ?? null),
    latest_reading: latest?.reading ?? null,
    latest_reading_on: latest?.recorded_on ?? null,
    due_state: maintenanceDueState({
      todayIso: ctx.today,
      latestMeter: latest?.reading ?? null,
      latestReadingOn: latest?.recorded_on ?? null,
      staleDays: ctx.staleDays,
      item,
    }),
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

// Cross-table cadence rule: a meter interval (or a prepaid-distance policy)
// only makes sense on an asset with a meter. Returns an error string or null.
async function validateMeterAxis(
  db: DbOrTx,
  policy: string,
  intervalMeter: number | null,
  assetId: string | null,
): Promise<string | null> {
  const needsMeter = intervalMeter != null || policy === 'prepaid_meter';
  if (!needsMeter) return null;
  if (!assetId) return 'A meter cadence requires the item to be attached to an asset with a meter_unit.';
  const asset = await loadAsset(db, assetId);
  if (!asset) return 'asset_id does not exist.';
  if (!asset.meter_unit) return 'A meter cadence requires the asset to have a meter_unit.';
  return null;
}

const ASSET_EMBED = { columns: { id: true, name: true, kind: true, meter_unit: true, domain_id: true, lifecycle: true } } as const;

export const maintenanceRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.requireAuth);

  // ─── Assets ───────────────────────────────────────────────────────────

  app.get<{ Querystring: { include_archived?: string } }>('/api/assets', async (req) => {
    const db = getDb();
    const includeAll = req.query.include_archived === 'true';
    const rows = await db.query.assets.findMany({ orderBy: [asc(assets.name)] });
    // Default view: what's still around (active + stored). Sold/archived
    // keep their history but only show on request.
    const visible = includeAll ? rows : rows.filter((a) => a.lifecycle === 'active' || a.lifecycle === 'stored');
    const readings = await latestReadingRowByAsset(db, visible.map((a) => a.id));
    const { today } = await policyContext();

    const counts = await db
      .select({ asset_id: maintenance_items.asset_id, n: count() })
      .from(maintenance_items)
      .where(eq(maintenance_items.active, true))
      .groupBy(maintenance_items.asset_id);
    const countMap = new Map(counts.map((c) => [c.asset_id, c.n]));

    return {
      assets: visible.map((a) => {
        const latest = readings.get(a.id) ?? null;
        const daysSince = latest
          ? Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${latest.recorded_on}T12:00:00Z`)) / 86_400_000)
          : null;
        return {
          ...a,
          latest_reading: latest?.reading ?? null,
          latest_reading_on: latest?.recorded_on ?? null,
          latest_reading_days_ago: daysSince,
          active_item_count: countMap.get(a.id) ?? 0,
        };
      }),
    };
  });

  // Asset + domain + recent readings + its items with due_state + the
  // projects grouped under it + spend this year — one round-trip. This
  // response is also the future agent's per-asset context bundle.
  app.get<{ Params: { id: string } }>('/api/assets/:id', async (req, reply) => {
    const db = getDb();
    const asset = await db.query.assets.findFirst({
      where: eq(assets.id, req.params.id),
      with: { domain: { columns: { id: true, name: true } } },
    });
    if (!asset) return reply.code(404).send({ error: 'not_found' });
    const ctx = await policyContext();
    const yearStart = `${ctx.today.slice(0, 4)}-01-01`;

    const [readings, items, projectRows, costRow] = await Promise.all([
      db.query.asset_meter_readings.findMany({
        where: eq(asset_meter_readings.asset_id, asset.id),
        orderBy: [desc(asset_meter_readings.recorded_on), desc(asset_meter_readings.created_at)],
        limit: 50,
      }),
      db.query.maintenance_items.findMany({
        where: eq(maintenance_items.asset_id, asset.id),
        with: { asset: ASSET_EMBED },
        orderBy: [asc(maintenance_items.name)],
      }),
      db.query.projects.findMany({
        columns: { id: true, name: true, status: true, kind: true, color: true, target_date: true, description: true, created_at: true },
        where: and(eq(projects.asset_id, asset.id), sql`${projects.status} <> 'archived'`),
        orderBy: [desc(projects.created_at)],
      }),
      // Logged completion costs this app-tz year, across the asset's items.
      db
        .select({ total: sql<string>`coalesce(sum(${maintenance_logs.cost}), 0)` })
        .from(maintenance_logs)
        .innerJoin(maintenance_items, eq(maintenance_items.id, maintenance_logs.item_id))
        .where(and(eq(maintenance_items.asset_id, asset.id), sql`${maintenance_logs.completed_on} >= ${yearStart}`))
        .then((rows) => rows[0]),
    ]);

    const latest = (await latestReadingRowByAsset(db, [asset.id])).get(asset.id) ?? null;
    const withState = items.map((i) => withDueState(i, ctx, latest)).sort(dueSort);
    const { domain, ...assetRow } = asset;
    return {
      asset: assetRow,
      domain: domain ?? null,
      readings,
      items: withState,
      projects: projectRows,
      cost_ytd: Number(costRow?.total ?? 0),
      today: ctx.today,
      meter_stale_days: ctx.staleDays,
    };
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
    const existing = await db.query.assets.findFirst({ where: eq(assets.id, req.params.id) });
    if (!existing) return reply.code(404).send({ error: 'not_found' });
    const d = parsed.data;

    // Unit lock: once a reading exists, relabelling km→mi would silently
    // change what every historical number and threshold means.
    if ('meter_unit' in d && d.meter_unit !== existing.meter_unit) {
      const [n] = await db
        .select({ n: count() })
        .from(asset_meter_readings)
        .where(eq(asset_meter_readings.asset_id, existing.id));
      if (n && n.n > 0) {
        return reply.code(400).send({
          error: 'meter_unit_locked',
          message: 'This asset has readings; its meter unit cannot change. Create a new asset for a different meter.',
        });
      }
      if (d.meter_unit == null) {
        const dependent = await db.query.maintenance_items.findMany({
          columns: { id: true },
          where: and(
            eq(maintenance_items.asset_id, existing.id),
            eq(maintenance_items.active, true),
            sql`(${maintenance_items.interval_meter} is not null or ${maintenance_items.policy} = 'prepaid_meter')`,
          ),
        });
        if (dependent.length > 0) {
          return reply.code(400).send({
            error: 'meter_in_use',
            message: 'Active meter-cadence items depend on this meter. Update or deactivate them first.',
          });
        }
      }
    }

    const { attachments, ...rest } = d;
    const update: Partial<typeof assets.$inferInsert> = { ...rest };
    // Zod's Attachment and the persisted StoredAttachment are the same shape
    // spelled twice (notes route precedent) — cast at the boundary.
    if (attachments) update.attachments = attachments as StoredAttachment[];
    // Lifecycle ⇄ archived_at stay consistent whichever one the caller sets.
    if (d.lifecycle) {
      if (d.lifecycle === 'active') update.archived_at = null;
      else if (!('archived_at' in d)) update.archived_at = existing.archived_at ?? new Date().toISOString();
    } else if ('archived_at' in d) {
      update.lifecycle = d.archived_at ? 'archived' : 'active';
    }

    const leavingActive = existing.lifecycle === 'active' && update.lifecycle && update.lifecycle !== 'active';
    const row = await db.transaction(async (tx) => {
      const [updated] = await tx.update(assets).set(update).where(eq(assets.id, existing.id)).returning();
      if (leavingActive) {
        // A sold/stored/archived asset keeps its schedules but its generated
        // work is noise — retire it.
        const items = await tx
          .select({ id: maintenance_items.id })
          .from(maintenance_items)
          .where(eq(maintenance_items.asset_id, existing.id));
        await reconcileGeneratedWork(tx, items.map((i) => i.id));
        await tx
          .delete(attention_items)
          .where(and(eq(attention_items.source_type, 'asset'), eq(attention_items.source_id, existing.id)));
      }
      return updated;
    });
    return { asset: row };
  });

  // Delete is for mistakes; a car you sold is lifecycle:'sold'. Refused
  // while meter-cadence items depend on the meter — deleting the asset
  // would leave schedules that can never be evaluated.
  app.delete<{ Params: { id: string } }>('/api/assets/:id', async (req, reply) => {
    const db = getDb();
    const existing = await db.query.assets.findFirst({ where: eq(assets.id, req.params.id) });
    if (!existing) return reply.code(404).send({ error: 'not_found' });
    const meterItems = await db
      .select({ id: maintenance_items.id })
      .from(maintenance_items)
      .where(
        and(
          eq(maintenance_items.asset_id, existing.id),
          sql`(${maintenance_items.interval_meter} is not null or ${maintenance_items.policy} = 'prepaid_meter')`,
        ),
      );
    if (meterItems.length > 0) {
      return reply.code(409).send({
        error: 'asset_has_meter_items',
        message: `${meterItems.length} meter-cadence item(s) depend on this asset. Archive the asset (lifecycle) or delete those items first.`,
      });
    }
    await db.transaction(async (tx) => {
      const items = await tx
        .select({ id: maintenance_items.id })
        .from(maintenance_items)
        .where(eq(maintenance_items.asset_id, existing.id));
      await reconcileGeneratedWork(tx, items.map((i) => i.id));
      await tx.delete(assets).where(eq(assets.id, existing.id));
    });
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

    const { today } = await policyContext();
    const recordedOn = parsed.data.recorded_on ?? today;
    if (recordedOn > today) {
      return reply.code(400).send({ error: 'future_reading', message: 'A reading cannot be dated in the future.' });
    }
    // Cumulative meters only go up. A lower value than the latest prior
    // reading is a typo unless the meter was replaced (allow_decrease).
    const latest = (await latestReadingRowByAsset(db, [asset.id])).get(asset.id) ?? null;
    if (latest && latest.recorded_on <= recordedOn && parsed.data.reading < latest.reading && !parsed.data.allow_decrease) {
      return reply.code(400).send({
        error: 'reading_decreased',
        message: `Lower than the latest reading (${latest.reading} on ${latest.recorded_on}). Pass allow_decrease if the meter was replaced.`,
      });
    }

    const { source, actor } = provenance(req, parsed.data.source);
    const [inserted] = await db
      .insert(asset_meter_readings)
      .values({
        asset_id: asset.id,
        reading: parsed.data.reading,
        recorded_on: recordedOn,
        notes: parsed.data.notes ?? null,
        source,
        actor,
        event_key: parsed.data.event_key ?? null,
      })
      .onConflictDoNothing({ target: asset_meter_readings.event_key, where: sql`event_key is not null` })
      .returning();
    const row =
      inserted ??
      (parsed.data.event_key
        ? await db.query.asset_meter_readings.findFirst({ where: eq(asset_meter_readings.event_key, parsed.data.event_key) })
        : undefined);

    // A fresh reading resolves the "meter reading is stale" nag immediately,
    // and can tip a meter-cadence item into its due window — run the sweep
    // now so a big odometer jump surfaces today. Both best-effort: never
    // fail the write.
    try {
      await clearAttentionForSource(db, 'asset', asset.id, ['meter_reading_stale']);
      await runMaintenanceSweep(db);
    } catch (err) {
      req.log.warn({ err, assetId: asset.id }, 'post-reading maintenance sweep failed');
    }
    return reply.code(inserted ? 201 : 200).send({ reading: row, logged: Boolean(inserted) });
  });

  app.patch<{ Params: { id: string; rid: string } }>('/api/assets/:id/readings/:rid', async (req, reply) => {
    const parsed = UpdateMeterReadingSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_payload', details: parsed.error.flatten().fieldErrors });
    }
    const db = getDb();
    const { today } = await policyContext();
    if (parsed.data.recorded_on && parsed.data.recorded_on > today) {
      return reply.code(400).send({ error: 'future_reading', message: 'A reading cannot be dated in the future.' });
    }
    const [row] = await db
      .update(asset_meter_readings)
      .set(parsed.data)
      .where(and(eq(asset_meter_readings.id, req.params.rid), eq(asset_meter_readings.asset_id, req.params.id)))
      .returning();
    if (!row) return reply.code(404).send({ error: 'not_found' });
    return { reading: row };
  });

  // Corrections VOID, never delete — history keeps its meaning and the
  // reading stays auditable.
  app.delete<{ Params: { id: string; rid: string } }>('/api/assets/:id/readings/:rid', async (req, reply) => {
    const db = getDb();
    const [row] = await db
      .update(asset_meter_readings)
      .set({ voided_at: new Date().toISOString() })
      .where(
        and(
          eq(asset_meter_readings.id, req.params.rid),
          eq(asset_meter_readings.asset_id, req.params.id),
          isNull(asset_meter_readings.voided_at),
        ),
      )
      .returning();
    if (!row) return reply.code(404).send({ error: 'not_found' });
    return { reading: row, voided: true };
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
        with: { asset: ASSET_EMBED },
        orderBy: [asc(maintenance_items.name)],
      });

      const assetIds = [...new Set(items.map((i) => i.asset_id).filter((v): v is string => v != null))];
      const readings = await latestReadingRowByAsset(db, assetIds);
      const ctx = await policyContext();

      const rows = items
        .map((i) => withDueState(i, ctx, i.asset_id ? (readings.get(i.asset_id) ?? null) : null))
        .sort(dueSort);
      return { items: rows, today: ctx.today, meter_stale_days: ctx.staleDays };
    },
  );

  app.get<{ Params: { id: string } }>('/api/maintenance/:id', async (req, reply) => {
    const db = getDb();
    const item = await db.query.maintenance_items.findFirst({
      where: eq(maintenance_items.id, req.params.id),
      with: { asset: ASSET_EMBED },
    });
    if (!item) return reply.code(404).send({ error: 'not_found' });

    const logs = await db.query.maintenance_logs.findMany({
      where: eq(maintenance_logs.item_id, item.id),
      orderBy: [desc(maintenance_logs.completed_on), desc(maintenance_logs.created_at)],
    });
    const latest = item.asset_id ? (await latestReadingRowByAsset(db, [item.asset_id])).get(item.asset_id) ?? null : null;
    const ctx = await policyContext();
    return { item: withDueState(item, ctx, latest), logs, today: ctx.today };
  });

  app.post('/api/maintenance', async (req, reply) => {
    const parsed = CreateMaintenanceItemSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_payload', details: parsed.error.flatten().fieldErrors });
    }
    const db = getDb();
    const d = parsed.data;
    const policy = d.policy ?? 'interval';

    const meterError = await validateMeterAxis(db, policy, d.interval_meter ?? null, d.asset_id ?? null);
    if (meterError) return reply.code(400).send({ error: 'invalid_cadence', message: meterError });

    const { actor } = provenance(req);
    const row = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(maintenance_items)
        .values({
          name: d.name,
          notes: d.notes ?? null,
          asset_id: d.asset_id ?? null,
          // Null = inherit the asset's domain (else Inbox) at read time.
          domain_id: d.domain_id ?? null,
          policy,
          system: d.system ?? null,
          interval_days: d.interval_days ?? null,
          interval_months: d.interval_months ?? null,
          interval_meter: d.interval_meter ?? null,
          lead_days: d.lead_days ?? 14,
          lead_meter: d.lead_meter ?? null,
          metadata: d.metadata ?? {},
        })
        .returning();
      if (!created) throw new Error('insert returned no row');

      // Seed history is EVIDENCE — an explicit baseline log, editable but
      // not deletable — so undo and re-derivation always have it.
      if (d.last_completed_on) {
        await tx.insert(maintenance_logs).values({
          item_id: created.id,
          completed_on: d.last_completed_on,
          meter_at_completion: d.last_completed_meter ?? null,
          source: 'import',
          actor,
          is_baseline: true,
          notes: 'Baseline',
        });
      }

      // Materialise next-due from evidence (or the creation-date anchor),
      // then let an explicit override pin either axis ("brakes due at
      // 150,000 km") without inventing a completion.
      const asset = await loadAsset(tx, created.asset_id);
      const derived = await deriveSchedule(tx, created, asset);
      if (d.next_due_date !== undefined) derived.next_due_date = d.next_due_date;
      if (d.next_due_meter !== undefined) derived.next_due_meter = d.next_due_meter;
      // A baseline meter with no explicit override still seeds the axis.
      if (derived.next_due_meter == null && d.last_completed_meter != null && d.interval_meter != null && d.next_due_meter === undefined) {
        derived.next_due_meter = d.last_completed_meter + d.interval_meter;
      }
      const [updated] = await tx.update(maintenance_items).set(derived).where(eq(maintenance_items.id, created.id)).returning();
      return updated ?? created;
    });
    return reply.code(201).send({ item: row });
  });

  app.patch<{ Params: { id: string } }>('/api/maintenance/:id', async (req, reply) => {
    const parsed = UpdateMaintenanceItemSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_payload', details: parsed.error.flatten().fieldErrors });
    }
    const db = getDb();
    const d = parsed.data;

    const result = await db.transaction(async (tx) => {
      const existing = await lockItem(tx, req.params.id);
      if (!existing) return { error: 404 as const };

      // Merged-cadence validation — the Zod checks can't see the columns a
      // partial patch leaves untouched.
      const merged = {
        policy: d.policy ?? existing.policy,
        interval_days: 'interval_days' in d ? (d.interval_days ?? null) : existing.interval_days,
        interval_months: 'interval_months' in d ? (d.interval_months ?? null) : existing.interval_months,
        interval_meter: 'interval_meter' in d ? (d.interval_meter ?? null) : existing.interval_meter,
      };
      if (merged.policy === 'interval' && merged.interval_days == null && merged.interval_months == null && merged.interval_meter == null) {
        return { error: 400 as const, message: 'Interval items need interval_days, interval_months, or interval_meter.' };
      }
      if (merged.interval_days != null && merged.interval_months != null) {
        return { error: 400 as const, message: 'Use interval_days or interval_months, not both.' };
      }
      const mergedAssetId = 'asset_id' in d ? (d.asset_id ?? null) : existing.asset_id;
      const meterError = await validateMeterAxis(tx, merged.policy, merged.interval_meter, mergedAssetId);
      if (meterError) return { error: 400 as const, message: meterError };

      const update: Partial<typeof maintenance_items.$inferInsert> = {};
      if (d.name !== undefined) update.name = d.name;
      if ('notes' in d) update.notes = d.notes ?? null;
      if ('asset_id' in d) update.asset_id = d.asset_id ?? null;
      if ('domain_id' in d) update.domain_id = d.domain_id ?? null;
      if (d.policy !== undefined) update.policy = d.policy;
      if ('system' in d) update.system = d.system ?? null;
      if ('interval_days' in d) update.interval_days = d.interval_days ?? null;
      if ('interval_months' in d) update.interval_months = d.interval_months ?? null;
      if ('interval_meter' in d) update.interval_meter = d.interval_meter ?? null;
      if (d.lead_days !== undefined) update.lead_days = d.lead_days;
      if ('lead_meter' in d) update.lead_meter = d.lead_meter ?? null;
      if (d.active !== undefined) update.active = d.active;
      if (d.metadata !== undefined) update.metadata = d.metadata;

      // Schedule stability: an axis is re-derived ONLY when the value of
      // something that defines it actually changed — a form that echoes
      // every field back must not move a due date. An explicit next_due_*
      // in the patch pins its axis regardless.
      const policyChanged = merged.policy !== existing.policy;
      const dateAxisChanged =
        policyChanged ||
        merged.interval_days !== existing.interval_days ||
        merged.interval_months !== existing.interval_months;
      const meterAxisChanged =
        policyChanged || merged.interval_meter !== existing.interval_meter || mergedAssetId !== existing.asset_id;

      if (dateAxisChanged || meterAxisChanged) {
        const asset = await loadAsset(tx, mergedAssetId);
        const derived = await deriveSchedule(tx, { ...existing, ...merged, asset_id: mergedAssetId }, asset);
        if (dateAxisChanged && !('next_due_date' in d)) update.next_due_date = derived.next_due_date;
        if (meterAxisChanged && !('next_due_meter' in d)) update.next_due_meter = derived.next_due_meter;
      }
      if ('next_due_date' in d) update.next_due_date = d.next_due_date ?? null;
      if ('next_due_meter' in d) update.next_due_meter = d.next_due_meter ?? null;

      const [row] = await tx.update(maintenance_items).set(update).where(eq(maintenance_items.id, existing.id)).returning();

      // Deactivating retires the generated work; a changed occurrence (new
      // thresholds) lets the next sweep spawn the right task.
      if (d.active === false && existing.active) await reconcileGeneratedWork(tx, [existing.id]);
      return { item: row };
    });

    if ('error' in result) {
      if (result.error === 404) return reply.code(404).send({ error: 'not_found' });
      return reply.code(400).send({ error: 'invalid_cadence', message: result.message });
    }
    return result;
  });

  app.delete<{ Params: { id: string } }>('/api/maintenance/:id', async (req, reply) => {
    const db = getDb();
    const deleted = await db.transaction(async (tx) => {
      const existing = await lockItem(tx, req.params.id);
      if (!existing) return false;
      await reconcileGeneratedWork(tx, [existing.id]);
      await tx.delete(maintenance_items).where(eq(maintenance_items.id, existing.id));
      return true;
    });
    if (!deleted) return reply.code(404).send({ error: 'not_found' });
    return { deleted: true };
  });

  // ─── Completion ──────────────────────────────────────────────────────

  app.post<{ Params: { id: string } }>('/api/maintenance/:id/complete', async (req, reply) => {
    const parsed = CompleteMaintenanceSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_payload', details: parsed.error.flatten().fieldErrors });
    }
    const db = getDb();
    const { today } = await policyContext();
    const completedOn = parsed.data.completed_on ?? today;
    if (completedOn > today) {
      return reply.code(400).send({ error: 'future_completion', message: 'A completion cannot be dated in the future.' });
    }
    const { source, actor } = provenance(req, parsed.data.source);
    const result = await completeMaintenanceItem(db, req.params.id, {
      completedOn,
      meter: parsed.data.meter ?? null,
      notes: parsed.data.notes ?? null,
      cost: parsed.data.cost ?? null,
      source,
      actor,
      runId: parsed.data.run_id ?? null,
      eventKey: parsed.data.event_key ?? null,
      issuedUntil: parsed.data.issued_until ?? null,
      purchasedTo: parsed.data.purchased_to ?? null,
      finding: parsed.data.finding ?? null,
      nextReviewOn: parsed.data.next_review_on ?? null,
      nextReviewMeter: parsed.data.next_review_meter ?? null,
    });
    if (!result) return reply.code(404).send({ error: 'not_found' });
    return { item: result.item, log: result.log, logged: result.logged, historical: result.historical };
  });

  // Edit a log (the way to fix a baseline or a typo'd date/meter). The
  // schedule re-derives from evidence afterwards.
  app.patch<{ Params: { id: string; logId: string } }>('/api/maintenance/:id/logs/:logId', async (req, reply) => {
    const parsed = UpdateMaintenanceLogSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_payload', details: parsed.error.flatten().fieldErrors });
    }
    const db = getDb();
    const result = await db.transaction(async (tx) => {
      const item = await lockItem(tx, req.params.id);
      if (!item) return null;
      const [log] = await tx
        .update(maintenance_logs)
        .set(parsed.data)
        .where(and(eq(maintenance_logs.id, req.params.logId), eq(maintenance_logs.item_id, item.id)))
        .returning();
      if (!log) return null;
      // Keep the linked completion reading in step with the corrected log.
      if (log.reading_id && (parsed.data.meter_at_completion !== undefined || parsed.data.completed_on !== undefined)) {
        const rset: Partial<typeof asset_meter_readings.$inferInsert> = {};
        if (parsed.data.completed_on !== undefined) rset.recorded_on = parsed.data.completed_on;
        if (parsed.data.meter_at_completion != null) rset.reading = parsed.data.meter_at_completion;
        if (Object.keys(rset).length) await tx.update(asset_meter_readings).set(rset).where(eq(asset_meter_readings.id, log.reading_id));
      }
      const updated = await rederiveAndReconcile(tx, item);
      return { item: updated, log };
    });
    if (!result) return reply.code(404).send({ error: 'not_found' });
    return result;
  });

  // Undo a completion: remove the event, void the reading it created (an
  // independently logged reading stays), and re-derive the schedule from
  // the remaining evidence. The baseline row is not deletable — edit it.
  app.delete<{ Params: { id: string; logId: string } }>('/api/maintenance/:id/logs/:logId', async (req, reply) => {
    const db = getDb();
    const result = await db.transaction(async (tx) => {
      const item = await lockItem(tx, req.params.id);
      if (!item) return { error: 404 as const };
      const [log] = await tx
        .select()
        .from(maintenance_logs)
        .where(and(eq(maintenance_logs.id, req.params.logId), eq(maintenance_logs.item_id, item.id)));
      if (!log) return { error: 404 as const };
      if (log.is_baseline) return { error: 409 as const };

      await tx.delete(maintenance_logs).where(eq(maintenance_logs.id, log.id));
      if (log.reading_id) {
        await tx
          .update(asset_meter_readings)
          .set({ voided_at: new Date().toISOString() })
          .where(and(eq(asset_meter_readings.id, log.reading_id), isNull(asset_meter_readings.voided_at)));
      }
      const updated = await rederiveAndReconcile(tx, item);
      return { item: updated };
    });
    if ('error' in result) {
      if (result.error === 404) return reply.code(404).send({ error: 'not_found' });
      return reply.code(409).send({ error: 'baseline_not_deletable', message: 'The baseline is seed evidence — edit it instead.' });
    }
    return result;
  });
};
