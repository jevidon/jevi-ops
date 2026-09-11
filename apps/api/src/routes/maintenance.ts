import { z, ZodError } from 'zod';
import { AssetContextError, assetMarkdownExport, assetSnapshotMarker, assetSourceReferences, buildAssetContext } from '../lib/asset-context.js';
import { requireOwnerSession } from '../lib/owner-session.js';
import { createAsset, updateAsset } from '../lib/asset-commands.js';
import { createMaintenanceItem, updateMaintenanceItem } from '../lib/maintenance-commands.js';
import { CommandError } from '../lib/command-error.js';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { and, asc, count, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  CompleteMaintenanceSchema,
  CreateAssetSchema,
  UpdateAssetSchema,
  CreateMaintenanceItemSchema,
  UpdateMaintenanceItemSchema,
  CreateMeterReadingSchema,
  SetBaselineSchema,
  UpdateMaintenanceLogSchema,
  UpdateMeterReadingSchema,
  effectiveDomainId,
  maintenanceDueState,
  maintenanceTracked,
} from '@jevi-ops/shared';
import { getAppSettings } from '../lib/app-settings.js';
import { clearAttentionForSource } from '../lib/attention.js';
import { getDb } from '../lib/db.js';
import { DocConflict, DocVersionRequired, deleteDocRevisions } from '../lib/docs.js';
import {
  MaintenanceConflict,
  MaintenanceNeedsDetails,
  completeMaintenanceItem,
  latestLog,
  lockItem,
  loadAsset,
  reconcileGeneratedWork,
  reconcileItemTask,
  rederiveAndReconcile,
  upsertBaseline,
  type ItemRow,
  type ScheduleContext,
} from '../lib/maintenance.js';
import { runMaintenanceSweep } from '../lib/maintenance-sweep.js';
import type { Tx } from '../lib/maintenance-tx.js';
import {
  ReadingRejected,
  latestReadingRowByAsset,
  recordReading,
  updateReading,
  voidReading,
  type LatestReading,
} from '../lib/meter-readings.js';
import { todayInTz } from '../lib/tz.js';
import { listVisits, spendSummary } from '../lib/visits.js';
import {
  assets, attention_items, asset_meter_readings, maintenance_items, maintenance_logs, maintenance_visits, projects, tasks,
} from '../db/schema.js';

// Maintenance module (migrations 0047 + 0048 + 0049): assets + meter
// readings + maintenance items + completion logs. Deliberately flat JSON
// with no UI coupling — the future vehicle-agent drives these same endpoints
// headlessly. Cadence semantics (policies, re-anchor from completion,
// whichever-first over date/meter) live in @jevi-ops/shared/maintenance;
// every authoritative write goes through lib/maintenance.ts in a
// transaction with the item locked, and every reading through
// lib/meter-readings.ts, validated.
//
// Provenance is derived from the credential, never trusted from the
// payload: a session is always 'manual'; a named API token is 'agent'
// unless it declares 'import'.

function provenance(req: FastifyRequest, declared?: 'agent' | 'import'): { source: 'manual' | 'agent' | 'import'; actor: string } {
  const actor = req.authMethod === 'api_token' ? req.user!.email : `session:${req.user!.email}`;
  const source = req.authMethod === 'api_token' ? (declared ?? 'agent') : 'manual';
  return { source, actor };
}

// The lib's typed failures → HTTP. Returns true when it sent a reply.
function sendMaintenanceError(reply: FastifyReply, err: unknown): boolean {
  if (err instanceof MaintenanceNeedsDetails) {
    reply.code(400).send({ error: 'needs_details', policy: err.policy, fields: err.fields, message: err.message });
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
  return false;
}


function sendCommandError(reply: FastifyReply, err: unknown): boolean {
  if (err instanceof ZodError) {
    reply.code(400).send({ error: 'invalid_payload', details: err.flatten().fieldErrors });
    return true;
  }
  if (err instanceof CommandError) {
    reply.code(err.status).send({ error: err.code, message: err.message, ...err.details });
    return true;
  }
  if (err instanceof DocConflict) {
    reply.code(409).send({ error: 'doc_conflict', ...err.current, message: err.message });
    return true;
  }
  if (err instanceof DocVersionRequired) {
    reply.code(400).send({ error: 'doc_version_required', message: err.message });
    return true;
  }
  return false;
}

type AssetRow = typeof assets.$inferSelect;
type ItemWithAsset = ItemRow & { asset?: Pick<AssetRow, 'id' | 'name' | 'kind' | 'meter_unit' | 'domain_id' | 'lifecycle'> | null };

async function policyContext(): Promise<{ today: string; staleDays: number; currency: string }> {
  const s = await getAppSettings();
  return { today: todayInTz(s.timezone), staleDays: s.meter_stale_days, currency: s.currency };
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
    // Shared scope: false rows keep a due_state for display but count and
    // prompt nowhere (Work card, Next up, sweep, attention all agree).
    tracked: maintenanceTracked(item, item.asset ?? null),
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

const ASSET_EMBED = { columns: { id: true, name: true, kind: true, meter_unit: true, domain_id: true, lifecycle: true } } as const;

export const maintenanceRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.requireAuth);

  // A reading correction can tip a meter-cadence item over its threshold;
  // surface it now rather than at 4am. Best-effort, never fails the write.
  async function sweepAfterReadingChange(req: FastifyRequest, assetId: string): Promise<void> {
    try {
      await runMaintenanceSweep(getDb());
    } catch (err) {
      req.log.warn({ err, assetId }, 'post-reading maintenance sweep failed');
    }
  }

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

  // Asset + domain + the authoritative latest reading + recent readings +
  // its items with due_state + the projects grouped under it + spend this
  // year — one round-trip. This response is also the future agent's
  // per-asset context bundle.
  app.get<{ Params: { id: string } }>('/api/assets/:id', async (req, reply) => {
    return getDb().transaction(async (db) => {
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

    // The latest reading comes from the same query every due-state path
    // uses — never derived from the paginated history above.
    const latest = (await latestReadingRowByAsset(db, [asset.id])).get(asset.id) ?? null;
    const withState = items.map((i) => withDueState(i, ctx, latest)).sort(dueSort);
    const [visits, spend] = await Promise.all([listVisits(db, asset.id), spendSummary(db, asset.id, yearStart, ctx.currency)]);
    const { domain, ...assetRow } = asset;
    const [snapshot, sourceRefs, totalRows] = await Promise.all([
      assetSnapshotMarker(db, asset.id), assetSourceReferences(db, asset.id, 'owner'),
      db.execute(sql`select (select count(*)::int from asset_meter_readings where asset_id=${asset.id}::uuid) as readings, (select count(*)::int from source_links where asset_id=${asset.id}::uuid) as sources`),
    ]);
    const totals = totalRows[0] as unknown as { readings: number; sources: number };
    return {
      context_version: 1, snapshot, generated_at: new Date().toISOString(),
      source_references: sourceRefs,
      pagination: {
        readings: { total: totals.readings, limit: 50, truncated: totals.readings > readings.length },
        sources: { total: totals.sources, limit: 50, truncated: totals.sources > sourceRefs.length },
        projects: { scope: 'non_archived', total: projectRows.length, truncated: false },
        visits: { total: visits.length, truncated: false },
        follow_up: `/api/assets/${asset.id}/context?audience=owner&expected_snapshot=${snapshot}`,
      },
      asset: assetRow,
      domain: domain ?? null,
      latest_reading: latest,
      readings,
      items: withState,
      projects: projectRows,
      // Service visits (0051): planned first, then done newest first.
      visits,
      // Allocated line costs across all completions this year…
      cost_ytd: Number(costRow?.total ?? 0),
      // …versus invoice-grounded spend in the household currency (0052),
      // with foreign invoices and unpriced work reported apart.
      spend,
      spend_ytd: spend.total,
      today: ctx.today,
      meter_stale_days: ctx.staleDays,
    };
    }, { isolationLevel: 'repeatable read', accessMode: 'read only' });
  });

  app.get<{ Params: { id: string } }>('/api/assets/:id/context', async (req, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(req.params);
    const query = z.object({ audience: z.enum(['owner', 'research']).default('research'), offset: z.coerce.number().int().min(0).max(1_000_000).default(0), limit: z.coerce.number().int().min(1).max(100).default(50), expected_snapshot: z.string().regex(/^[0-9a-f]{64}$/).optional() }).safeParse(req.query);
    if (!params.success || !query.success) return reply.code(400).send({ error: 'invalid_context_request' });
    if (query.data.audience === 'owner') { await requireOwnerSession(req, reply); if (reply.sent) return; }
    try {
      return await getDb().transaction((db) => buildAssetContext(db, params.data.id, { audience: query.data.audience, offset: query.data.offset, limit: query.data.limit, expectedSnapshot: query.data.expected_snapshot }), { isolationLevel: 'repeatable read', accessMode: 'read only' });
    } catch (error) { if (error instanceof AssetContextError) return reply.code(error.status).send({ error: error.code }); throw error; }
  });
  app.get<{ Params: { id: string } }>('/api/assets/:id/export.md', { preHandler: requireOwnerSession }, async (req, reply) => {
    if (!z.string().uuid().safeParse(req.params.id).success) return reply.code(400).send({ error: 'invalid_asset_id' });
    try {
      const context = await getDb().transaction((db) => buildAssetContext(db, req.params.id, { audience: 'owner', limit: 100 }), { isolationLevel: 'repeatable read', accessMode: 'read only' });
      return reply.type('text/markdown; charset=utf-8').header('Cache-Control', 'private, no-store')
        .header('Content-Disposition', `attachment; filename="vehicle-${req.params.id}.md"`)
        .header('X-Content-Type-Options', 'nosniff').header('Content-Security-Policy', "sandbox; default-src 'none'")
        .send(assetMarkdownExport(context));
    } catch (error) { if (error instanceof AssetContextError) return reply.code(error.status).send({ error: error.code }); throw error; }
  });

  app.post('/api/assets', async (req, reply) => {
    try {
      const row = await createAsset(getDb(), CreateAssetSchema.parse(req.body));
      return reply.code(201).send({ asset: row });
    } catch (err) {
      if (sendCommandError(reply, err)) return;
      throw err;
    }
  });

  // Shared command preserves fact CAS, gallery operations, document versions,
  // lifecycle/task reconciliation and inherited domain routing atomically.
  app.patch<{ Params: { id: string } }>('/api/assets/:id', async (req, reply) => {
    try {
      const asset = await updateAsset(getDb(), req.params.id, UpdateAssetSchema.parse(req.body), await policyContext(), provenance(req).actor);
      return { asset };
    } catch (err) {
      if (sendCommandError(reply, err)) return;
      throw err;
    }
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
      await deleteDocRevisions(tx, 'asset', existing.id);
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
    const { source, actor } = provenance(req, parsed.data.source);
    let written: Awaited<ReturnType<typeof recordReading>>;
    try {
      written = await recordReading(db, {
        assetId: asset.id,
        reading: parsed.data.reading,
        recordedOn: parsed.data.recorded_on ?? today,
        today,
        source,
        actor,
        notes: parsed.data.notes ?? null,
        eventKey: parsed.data.event_key ?? null,
        allowDecrease: parsed.data.allow_decrease,
      });
    } catch (err) {
      if (sendMaintenanceError(reply, err)) return reply;
      throw err;
    }

    // A fresh reading resolves the "meter reading is stale" nag immediately,
    // and can tip a meter-cadence item into its due window — run the sweep
    // now so a big odometer jump surfaces today. Both best-effort: never
    // fail the write.
    if (written.logged) {
      try {
        await clearAttentionForSource(db, 'asset', asset.id, ['meter_reading_stale']);
      } catch (err) {
        req.log.warn({ err, assetId: asset.id }, 'post-reading attention clear failed');
      }
      await sweepAfterReadingChange(req, asset.id);
    }
    return reply.code(written.logged ? 201 : 200).send({ reading: written.row, logged: written.logged });
  });

  // Correct a reading. Validated against its neighbours; when the reading
  // was captured by a completion, that service's evidence (meter, date)
  // follows the correction and the schedule re-derives — the reading and
  // the log are one fact, never two.
  app.patch<{ Params: { id: string; rid: string } }>('/api/assets/:id/readings/:rid', async (req, reply) => {
    const parsed = UpdateMeterReadingSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_payload', details: parsed.error.flatten().fieldErrors });
    }
    const db = getDb();
    const ctx = await policyContext();
    let result: { reading: typeof asset_meter_readings.$inferSelect; item: ItemRow | null } | null;
    try {
      result = await db.transaction(async (tx) => {
        const row = await updateReading(tx, {
          assetId: req.params.id,
          readingId: req.params.rid,
          today: ctx.today,
          reading: parsed.data.reading,
          recordedOn: parsed.data.recorded_on,
          notes: parsed.data.notes,
          allowDecrease: parsed.data.allow_decrease,
        });
        if (!row) return null;
        const item = await syncLinkedLog(tx, row, ctx);
        return { reading: row, item };
      });
    } catch (err) {
      if (sendMaintenanceError(reply, err)) return reply;
      throw err;
    }
    if (!result) return reply.code(404).send({ error: 'not_found' });
    if (parsed.data.reading !== undefined || parsed.data.recorded_on !== undefined) await sweepAfterReadingChange(req, req.params.id);
    return result;
  });

  // Corrections VOID, never delete — history keeps its meaning and the
  // reading stays auditable. A voided completion reading leaves its log
  // with an unknown meter (the service happened; the number was wrong).
  app.delete<{ Params: { id: string; rid: string } }>('/api/assets/:id/readings/:rid', async (req, reply) => {
    const db = getDb();
    const ctx = await policyContext();
    const result = await db.transaction(async (tx) => {
      const row = await voidReading(tx, req.params.id, req.params.rid);
      if (!row) return null;
      // Every completion that stood on this reading (one, or a visit's
      // several) now has an unknown meter.
      const linked = await tx.select().from(maintenance_logs).where(eq(maintenance_logs.reading_id, row.id));
      let item: ItemRow | null = null;
      for (const log of linked) {
        const locked = await lockItem(tx, log.item_id);
        const before = await latestLog(tx, log.item_id);
        await tx
          .update(maintenance_logs)
          .set({ meter_at_completion: null, reading_id: null })
          .where(eq(maintenance_logs.id, log.id));
        if (locked && before?.id === log.id) item = await rederiveAndReconcile(tx, locked, ctx);
        else if (locked) item = locked;
      }
      await tx.update(maintenance_visits).set({ meter: null, reading_id: null }).where(eq(maintenance_visits.reading_id, row.id));
      return { reading: row, voided: true, item };
    });
    if (!result) return reply.code(404).send({ error: 'not_found' });
    await sweepAfterReadingChange(req, req.params.id);
    return result;
  });

  // The linked-log half of a reading correction. Returns the item when a
  // completion log was linked (re-derived if that log is the latest
  // evidence), else null.
  async function syncLinkedLog(
    tx: Tx,
    row: typeof asset_meter_readings.$inferSelect,
    ctx: ScheduleContext,
  ): Promise<ItemRow | null> {
    // One completion, or every line of a visit (0051) — all stood on this
    // reading, all follow the correction; the visit's own copy too.
    const linked = await tx.select().from(maintenance_logs).where(eq(maintenance_logs.reading_id, row.id));
    let last: ItemRow | null = null;
    for (const log of linked) {
      const item = await lockItem(tx, log.item_id);
      if (!item) continue;
      const before = await latestLog(tx, item.id);
      await tx
        .update(maintenance_logs)
        .set({ meter_at_completion: row.reading, completed_on: row.recorded_on })
        .where(eq(maintenance_logs.id, log.id));
      const after = await latestLog(tx, item.id);
      last = before?.id === log.id || after?.id === log.id ? await rederiveAndReconcile(tx, item, ctx) : item;
    }
    await tx.update(maintenance_visits).set({ meter: row.reading, visited_on: row.recorded_on }).where(eq(maintenance_visits.reading_id, row.id));
    return last;
  }

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
    try {
      const item = await createMaintenanceItem(getDb(), CreateMaintenanceItemSchema.parse(req.body), provenance(req).actor);
      return reply.code(201).send({ item });
    } catch (err) {
      if (sendCommandError(reply, err)) return;
      throw err;
    }
  });

  app.patch<{ Params: { id: string } }>('/api/maintenance/:id', async (req, reply) => {
    try {
      const item = await updateMaintenanceItem(getDb(), req.params.id, UpdateMaintenanceItemSchema.parse(req.body), await policyContext());
      return { item };
    } catch (err) {
      if (sendCommandError(reply, err)) return;
      throw err;
    }
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
    let result: Awaited<ReturnType<typeof completeMaintenanceItem>>;
    try {
      result = await completeMaintenanceItem(db, req.params.id, {
        completedOn,
        today,
        meter: parsed.data.meter ?? null,
        allowDecrease: parsed.data.allow_decrease,
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
    } catch (err) {
      if (sendMaintenanceError(reply, err)) return reply;
      throw err;
    }
    if (!result) return reply.code(404).send({ error: 'not_found' });
    return { item: result.item, log: result.log, logged: result.logged, historical: result.historical };
  });

  // Seed evidence ("last done on … at …") — create or edit the item's
  // baseline without inventing a completion. The Next up "set a baseline"
  // prompt lands here.
  app.post<{ Params: { id: string } }>('/api/maintenance/:id/baseline', async (req, reply) => {
    const parsed = SetBaselineSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_payload', details: parsed.error.flatten().fieldErrors });
    }
    const db = getDb();
    const ctx = await policyContext();
    if (parsed.data.completed_on > ctx.today) {
      return reply.code(400).send({ error: 'future_completion', message: 'A baseline cannot be dated in the future.' });
    }
    const { actor } = provenance(req);
    const result = await db.transaction(async (tx) => {
      const item = await lockItem(tx, req.params.id);
      if (!item) return null;
      return upsertBaseline(tx, item, { completedOn: parsed.data.completed_on, meter: parsed.data.meter ?? null, actor }, ctx);
    });
    if (!result) return reply.code(404).send({ error: 'not_found' });
    return result;
  });

  // Edit a log (the way to fix a baseline or a typo'd date/meter). The
  // schedule re-derives only when this log is the latest evidence — before
  // or after the edit — so correcting old history never disturbs a pinned
  // current deadline. The linked completion reading follows the meter.
  app.patch<{ Params: { id: string; logId: string } }>('/api/maintenance/:id/logs/:logId', async (req, reply) => {
    const parsed = UpdateMaintenanceLogSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_payload', details: parsed.error.flatten().fieldErrors });
    }
    const db = getDb();
    const ctx = await policyContext();
    const { actor } = provenance(req);
    let result: { item: ItemRow; log: typeof maintenance_logs.$inferSelect } | { error: 'edit_the_visit' } | null;
    try {
      result = await db.transaction(async (tx) => {
        const item = await lockItem(tx, req.params.id);
        if (!item) return null;
        const [current] = await tx
          .select()
          .from(maintenance_logs)
          .where(and(eq(maintenance_logs.id, req.params.logId), eq(maintenance_logs.item_id, item.id)));
        if (!current) return null;
        // A completion done at a visit (0051) stands on the visit's single
        // reading with its siblings: its date and meter are the VISIT's to
        // change. Notes and the allocated cost stay line-specific.
        if (current.visit_id && (parsed.data.meter_at_completion !== undefined || parsed.data.completed_on !== undefined)) {
          return { error: 'edit_the_visit' as const };
        }
        const before = await latestLog(tx, item.id);
        const { allow_decrease, ...logPatch } = parsed.data;
        const [log] = await tx
          .update(maintenance_logs)
          .set(logPatch)
          .where(and(eq(maintenance_logs.id, req.params.logId), eq(maintenance_logs.item_id, item.id)))
          .returning();
        if (!log) return null;

        // Keep the linked completion reading in step with the corrected log.
        let linked = log;
        const asset = await loadAsset(tx, item.asset_id);
        const meterTouched = parsed.data.meter_at_completion !== undefined;
        const dateTouched = parsed.data.completed_on !== undefined;
        if (log.reading_id && (meterTouched || dateTouched)) {
          if (parsed.data.meter_at_completion === null) {
            await voidReading(tx, asset?.id ?? '', log.reading_id);
            const [l] = await tx.update(maintenance_logs).set({ reading_id: null }).where(eq(maintenance_logs.id, log.id)).returning();
            linked = l ?? log;
          } else if (asset) {
            await updateReading(tx, {
              assetId: asset.id,
              readingId: log.reading_id,
              today: ctx.today,
              reading: log.meter_at_completion ?? undefined,
              recordedOn: dateTouched ? log.completed_on : undefined,
              allowDecrease: allow_decrease,
            });
          }
        } else if (!log.reading_id && meterTouched && log.meter_at_completion != null && asset?.meter_unit && !log.is_baseline) {
          // A completion corrected to carry a meter it didn't have: that's a
          // reading now, like any completion's.
          const { row } = await recordReading(tx, {
            assetId: asset.id,
            reading: log.meter_at_completion,
            recordedOn: log.completed_on,
            today: ctx.today,
            source: 'completion',
            actor,
            allowDecrease: allow_decrease,
          });
          const [l] = await tx.update(maintenance_logs).set({ reading_id: row.id }).where(eq(maintenance_logs.id, log.id)).returning();
          linked = l ?? log;
        }

        const after = await latestLog(tx, item.id);
        const updated = before?.id === log.id || after?.id === log.id ? await rederiveAndReconcile(tx, item, ctx) : item;
        return { item: updated, log: linked };
      });
    } catch (err) {
      if (sendMaintenanceError(reply, err)) return reply;
      throw err;
    }
    if (!result) return reply.code(404).send({ error: 'not_found' });
    if ('error' in result) {
      return reply.code(409).send({
        error: 'edit_the_visit',
        message: 'This completion was done at a service visit. Change the date or odometer on the visit — every line and its reading move together.',
      });
    }
    return result;
  });

  // Undo a completion: remove the event, void the reading it created (an
  // independently logged reading stays), and re-derive the schedule from
  // the remaining evidence — only if the removed event was the latest;
  // removing older history moves nothing. The baseline row is not
  // deletable — edit it.
  app.delete<{ Params: { id: string; logId: string } }>('/api/maintenance/:id/logs/:logId', async (req, reply) => {
    const db = getDb();
    const ctx = await policyContext();
    const result = await db.transaction(async (tx) => {
      const item = await lockItem(tx, req.params.id);
      if (!item) return { error: 404 as const };
      const [log] = await tx
        .select()
        .from(maintenance_logs)
        .where(and(eq(maintenance_logs.id, req.params.logId), eq(maintenance_logs.item_id, item.id)));
      if (!log) return { error: 404 as const };
      if (log.is_baseline) return { error: 409 as const };

      const before = await latestLog(tx, item.id);
      await tx.delete(maintenance_logs).where(eq(maintenance_logs.id, log.id));
      // The reading this completion created goes with it — unless it is a
      // visit's single reading (0051), which the visit and its other lines
      // still stand on; undo the visit to void that one.
      if (log.reading_id && !log.visit_id) {
        await tx
          .update(asset_meter_readings)
          .set({ voided_at: new Date().toISOString() })
          .where(and(eq(asset_meter_readings.id, log.reading_id), isNull(asset_meter_readings.voided_at)));
      }
      const updated = before?.id === log.id ? await rederiveAndReconcile(tx, item, ctx) : item;
      return { item: updated };
    });
    if ('error' in result) {
      if (result.error === 404) return reply.code(404).send({ error: 'not_found' });
      return reply.code(409).send({ error: 'baseline_not_deletable', message: 'The baseline is seed evidence — edit it instead.' });
    }
    return result;
  });
};
