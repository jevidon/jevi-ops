import type { z } from 'zod';
import { and, asc, count, eq, inArray, isNull, sql } from 'drizzle-orm';
import { CreateAssetSchema, UpdateAssetSchema, INBOX_DOMAIN_ID, maintenanceTaskTitle, validateVehicleMetadataKeys } from '@jevi-ops/shared';
import { assets, asset_meter_readings, attention_items, maintenance_items, projects, tasks, type StoredAttachment } from '../db/schema.js';
import { invalidateVehicleAssessments } from './knowledge-invalidation.js';
import { saveDoc } from './docs.js';
import { reconcileGeneratedWork, reconcileItemTask, type AssetRow, type ScheduleContext } from './maintenance.js';
import { inTransaction, type DbOrTx } from './maintenance-tx.js';
import { CommandError, jsonEqual } from './command-error.js';

export async function createAsset(db: DbOrTx, input: z.input<typeof CreateAssetSchema>): Promise<AssetRow> {
  const data = CreateAssetSchema.parse(input);
  if (data.kind === 'vehicle') validateVehicleMetadataKeys(data.metadata ?? {});
  return inTransaction(db, async (tx) => {
    const [row] = await tx.insert(assets).values({
      name: data.name,
      kind: data.kind ?? 'other',
      domain_id: data.domain_id ?? null,
      meter_unit: data.meter_unit ?? null,
      metadata: data.metadata ?? {},
      notes: data.notes ?? null,
      doc_md: data.doc_md || null,
    }).returning();
    if (!row) throw new Error('insert_returned_no_row');
    return row;
  });
}

// Lock the asset before its ordered item set. Callers that combine multiple
// assets must acquire the entire asset set in ascending ID order first.
export async function updateAsset(
  db: DbOrTx,
  assetId: string,
  input: z.input<typeof UpdateAssetSchema>,
  ctx: ScheduleContext,
  actor: string,
): Promise<AssetRow> {
  const d = UpdateAssetSchema.parse(input);
  return inTransaction(db, async (tx) => {
    const [existing] = await tx.select().from(assets).where(eq(assets.id, assetId)).for('update');
    if (!existing) throw new CommandError(404, 'not_found', 'Asset not found.');

    // Unit lock: once a reading exists, relabelling km→mi would silently
    // change what every historical number and threshold means.
    if ('meter_unit' in d && d.meter_unit !== existing.meter_unit) {
      const [n] = await tx
        .select({ n: count() })
        .from(asset_meter_readings)
        .where(eq(asset_meter_readings.asset_id, existing.id));
      if (n && n.n > 0) {
        throw new CommandError(400, 'meter_unit_locked', 'This asset has readings; its meter unit cannot change. Create a new asset for a different meter.');
      }
      if (d.meter_unit == null) {
        const dependent = await tx.query.maintenance_items.findMany({
          columns: { id: true },
          where: and(
            eq(maintenance_items.asset_id, existing.id),
            eq(maintenance_items.active, true),
            sql`(${maintenance_items.interval_meter} is not null or ${maintenance_items.policy} = 'prepaid_meter')`,
          ),
        });
        if (dependent.length > 0) {
          throw new CommandError(400, 'meter_in_use', 'Active meter-cadence items depend on this meter. Update or deactivate them first.');
        }
      }
    }

    const { attachments, attachments_patch, metadata_patch, doc_md, doc_version, doc_force, ...rest } = d;
    const update: Partial<typeof assets.$inferInsert> = { ...rest };
    // Zod's Attachment and the persisted StoredAttachment are the same shape
    // spelled twice (notes route precedent) — cast at the boundary.
    if (attachments) update.attachments = attachments as StoredAttachment[];
    // Photo operations against the CURRENT array (under the lock): an
    // upload finishing late appends to what is there now, never to the
    // array it started from.
    if (attachments_patch) {
      let arr: StoredAttachment[] = [...((update.attachments as StoredAttachment[] | undefined) ?? existing.attachments ?? [])];
      const have = new Set(arr.map((a) => a.storage_path));
      for (const a of attachments_patch.add ?? []) {
        if (have.has(a.storage_path)) continue;
        arr.push(a as StoredAttachment);
        have.add(a.storage_path);
      }
      if (attachments_patch.remove?.length) {
        const gone = new Set(attachments_patch.remove);
        arr = arr.filter((a) => !gone.has(a.storage_path));
      }
      if (attachments_patch.hero) {
        const i = arr.findIndex((a) => a.storage_path === attachments_patch.hero);
        if (i > 0) arr = [arr[i]!, ...arr.slice(0, i), ...arr.slice(i + 1)];
      }
      update.attachments = arr;
    }

    if (metadata_patch) {
      const base: Record<string, unknown> = { ...(rest.metadata ?? existing.metadata ?? {}) };
      const conflicts: string[] = [];
      for (const [key, entry] of Object.entries(metadata_patch.set ?? {})) {
        if (entry.expected !== undefined && !jsonEqual(existing.metadata?.[key], entry.expected)) conflicts.push(key);
        else base[key] = entry.value;
      }
      for (const [key, entry] of Object.entries(metadata_patch.unset ?? {})) {
        if (entry.expected !== undefined && !jsonEqual(existing.metadata?.[key], entry.expected)) conflicts.push(key);
        else delete base[key];
      }
      if (conflicts.length > 0) throw new CommandError(409, 'fact_conflict', `Changed since you opened them: ${conflicts.join(', ')}. Reload to see the latest.`, { keys: conflicts, metadata: existing.metadata });
      update.metadata = base;
    }

    if ((d.kind ?? existing.kind) === 'vehicle' && update.metadata) {
      const keys = Object.keys(update.metadata).filter((key) => !jsonEqual(update.metadata![key], existing.metadata?.[key]));
      validateVehicleMetadataKeys(update.metadata, keys);
    }

    // Lifecycle ⇄ archived_at stay consistent whichever one the caller sets.
    if (d.lifecycle) {
      if (d.lifecycle === 'active') update.archived_at = null;
      else if (!('archived_at' in d)) update.archived_at = existing.archived_at ?? new Date().toISOString();
    } else if ('archived_at' in d) {
      update.lifecycle = d.archived_at ? 'archived' : 'active';
    }

    // A doc-only or patch-only PATCH leaves no columns here; Drizzle
    // refuses an empty set, and there is nothing to write anyway.
    let [updated] = Object.keys(update).length > 0
      ? await tx.update(assets).set(update).where(eq(assets.id, existing.id)).returning()
      : [existing];
    if (!updated) throw new CommandError(404, 'not_found', 'Asset not found.');

    if (update.metadata) await invalidateVehicleAssessments(tx, existing.id, existing.metadata ?? {}, updated.metadata ?? {}, actor);

    // The overview document (0050): versioned, revisioned, refused on a
    // stale version — a DocConflict thrown here rolls the whole PATCH
    // back and reaches the client as 409 doc_conflict.
    if (doc_md !== undefined) {
      const saved = await saveDoc(tx, { entityType: 'asset', id: existing.id, body: doc_md, expectedVersion: doc_version ?? null, force: doc_force, actor });
      if (saved) updated = { ...updated, doc_md: saved.doc_md, doc_version: saved.doc_version };
    }

    const items = await tx
      .select({ id: maintenance_items.id, name: maintenance_items.name })
      .from(maintenance_items)
      .where(eq(maintenance_items.asset_id, existing.id))
      .orderBy(asc(maintenance_items.id))
      .for('update');

    const leavingActive = existing.lifecycle === 'active' && updated.lifecycle !== 'active';
    if (leavingActive) {
      // A sold/stored/archived asset keeps its schedules but its generated
      // work is noise — retire it.
      await reconcileGeneratedWork(tx, items.map((i) => i.id));
      await tx
        .delete(attention_items)
        .where(and(eq(attention_items.source_type, 'asset'), eq(attention_items.source_id, existing.id)));
    }

    const domainChanged = 'domain_id' in d && (d.domain_id ?? null) !== existing.domain_id;
    if (domainChanged) {
      const oldDomain = existing.domain_id;
      const newDomain = d.domain_id ?? null;
      const moved = await tx
        .update(projects)
        .set({ domain_id: newDomain })
        .where(and(eq(projects.asset_id, existing.id), oldDomain ? eq(projects.domain_id, oldDomain) : isNull(projects.domain_id)))
        .returning({ id: projects.id });
      if (moved.length > 0) {
        await tx
          .update(tasks)
          .set({ domain_id: newDomain ?? INBOX_DOMAIN_ID })
          .where(and(inArray(tasks.project_id, moved.map((m) => m.id)), eq(tasks.domain_id, oldDomain ?? INBOX_DOMAIN_ID)));
      }
    }

    const nameChanged = d.name !== undefined && d.name !== existing.name;
    if ((domainChanged || nameChanged) && updated.lifecycle === 'active') {
      for (const it of items) {
        await reconcileItemTask(tx, it.id, ctx, { previousTitle: nameChanged ? maintenanceTaskTitle(it, existing) : null });
      }
    }
    return updated;
  });
}
