import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { VehicleIdentitySchema, VehicleMetadataSchema, VehiclePreferencesSchema, vehicleDisplayName } from '@jevi-ops/shared';
import { assets, doc_revisions, maintenance_items, maintenance_logs, projects, stewardship_domains } from '../src/db/schema.js';
import { getDb } from '../src/lib/db.js';
import { createAsset, updateAsset } from '../src/lib/asset-commands.js';
import { createMaintenanceItem, updateMaintenanceItem } from '../src/lib/maintenance-commands.js';
import { createDomain, createProject } from '../src/lib/structure-commands.js';
import { CommandError } from '../src/lib/command-error.js';
import { DocConflict } from '../src/lib/docs.js';
import { addReading, createAsset as fixtureAsset, getItem, today } from './helpers.js';

const actor = 'session:vehicle-command-test';
async function context() { return { today: await today(), staleDays: 30 }; }

describe('vehicle metadata conventions', () => {
  it('requires the wizard identity without requiring extra facts or inferring trim specifications', () => {
    expect(VehicleIdentitySchema.safeParse({ make: 'Toyota', model: 'Prado' }).success).toBe(false);
    const identity = VehicleIdentitySchema.parse({ year: 2015, make: 'Toyota', model: 'Land Cruiser Prado', variant: 'TX', chassis_id: '00123' });
    expect(vehicleDisplayName(identity)).toBe('2015 Toyota Land Cruiser Prado TX');
    expect(identity.chassis_id).toBe('00123');
    expect(identity).not.toHaveProperty('engine');
    expect(VehicleIdentitySchema.parse({ ...identity, variant: null }).variant).toBeNull();
  });

  it('keeps independent preferences, explicit gaps and partial evidence', () => {
    const metadata = VehicleMetadataSchema.parse({
      vehicle_preferences: { practical_involvement: 'service_provider', confidence: 'new', improvement_interest: 'actively_planning', detail: 'detailed' },
      vehicle_answer_states: { fields: { vin: 'unknown', engine: 'not_asked', jurisdiction: 'deferred' } },
      vehicle_ownership_evidence: { purchase_date: { precision: 'month', value: '2024-03' }, purchase_reading: { amount: 55000, unit: 'mi' } },
      based_country: 'NZ', registration_country: 'US', custom_fact: { preserve: true },
    });
    expect(metadata).not.toHaveProperty('purchased_on');
    expect(metadata.custom_fact).toEqual({ preserve: true });
    expect(VehiclePreferencesSchema.safeParse({ persona: 'expert' }).success).toBe(false);
  });

  it('does not tighten generic asset creation and preserves provenance without coercion', async () => {
    await expect(createAsset(getDb(), { name: 'Generic record', metadata: { year: 'Uncertain', vin: 123 } })).resolves.toMatchObject({ kind: 'other' });
    await expect(createAsset(getDb(), { name: 'Minimal vehicle', kind: 'vehicle' })).resolves.toMatchObject({ kind: 'vehicle' });
    await expect(createAsset(getDb(), { name: 'Bad new vehicle facts', kind: 'vehicle', metadata: { vin: 123 } })).rejects.toBeInstanceOf(z.ZodError);
    const vin = { value: '00123', source: 'owner', observed_on: '2026-01-01', source_location: 'page 2', recorded_at: '2026-01-02T00:00:00Z' };
    const asset = await createAsset(getDb(), { name: 'Vehicle', kind: 'vehicle', metadata: { vin, owner_extension: ['keep'] } });
    const saved = await updateAsset(getDb(), asset.id, { metadata_patch: { set: { based_country: { value: 'NZ', expected: null } } } }, await context(), actor);
    expect(saved.metadata).toEqual({ vin, owner_extension: ['keep'], based_country: 'NZ' });
  });

  it('leaves legacy facts unchanged on an unrelated save and rejects stale CAS even with a replacement object', async () => {
    const asset = await fixtureAsset({ metadata: { year: '2015', make: 'Toyota' } });
    const ctx = await context();
    const saved = await updateAsset(getDb(), asset.id, { metadata_patch: { set: { based_country: { value: 'NZ', expected: null } } } }, ctx, actor);
    expect(saved.metadata.year).toBe('2015');
    await expect(updateAsset(getDb(), asset.id, {
      metadata: { make: 'Fake stale value' },
      metadata_patch: { set: { make: { value: 'Lexus', expected: 'Fake stale value' } } },
    }, ctx, actor)).rejects.toMatchObject({ code: 'fact_conflict' });
    expect((await getDb().query.assets.findFirst({ where: eq(assets.id, asset.id) }))?.metadata.make).toBe('Toyota');
  });
});

describe('shared onboarding commands compose atomically', () => {
  it('rolls back asset, domain, project, baseline and schedule when a later command is rejected', async () => {
    const db = getDb();
    let domainId = '', assetId = '', projectId = '', itemId = '';
    await expect(db.transaction(async (tx) => {
      const domain = await createDomain(tx, { name: 'Rollback domain' }); domainId = domain.id;
      const asset = await createAsset(tx, { name: 'Rollback vehicle', kind: 'vehicle', domain_id: domain.id, meter_unit: 'km' }); assetId = asset.id;
      const project = await createProject(tx, { name: 'Candidate upgrade', asset_id: asset.id, status: 'idea' }); projectId = project.id;
      expect(project.domain_id).toBe(domain.id);
      const item = await createMaintenanceItem(tx, { name: 'Service', asset_id: asset.id, interval_months: 12, last_completed_on: '2025-01-01' }, actor); itemId = item.id;
      await updateMaintenanceItem(tx, item.id, { interval_months: null }, await context());
    })).rejects.toBeInstanceOf(CommandError);
    expect(await db.query.assets.findFirst({ where: eq(assets.id, assetId) })).toBeUndefined();
    expect(await db.query.stewardship_domains.findFirst({ where: eq(stewardship_domains.id, domainId) })).toBeUndefined();
    expect(await db.query.projects.findFirst({ where: eq(projects.id, projectId) })).toBeUndefined();
    expect(await db.query.maintenance_items.findFirst({ where: eq(maintenance_items.id, itemId) })).toBeUndefined();
    expect(await db.query.maintenance_logs.findMany({ where: eq(maintenance_logs.item_id, itemId) })).toHaveLength(0);
  });

  it('keeps a seeded narrative in revision history and rolls back other writes on stale document version', async () => {
    const db = getDb();
    const asset = await createAsset(db, { name: 'Vehicle', kind: 'vehicle', doc_md: '# Original' });
    const ctx = await context();
    await updateAsset(db, asset.id, { doc_md: '# Revised', doc_version: 1 }, ctx, actor);
    await expect(db.transaction(async (tx) => {
      await createProject(tx, { name: 'Must roll back', asset_id: asset.id });
      await updateAsset(tx, asset.id, { name: 'Must roll back', doc_md: '# Stale', doc_version: 1 }, ctx, actor);
    })).rejects.toBeInstanceOf(DocConflict);
    expect(await db.query.projects.findMany({ where: eq(projects.asset_id, asset.id) })).toHaveLength(0);
    expect((await db.query.assets.findFirst({ where: eq(assets.id, asset.id) }))?.name).toBe('Vehicle');
    expect(await db.query.doc_revisions.findMany({ where: eq(doc_revisions.entity_id, asset.id) })).toEqual(expect.arrayContaining([
      expect.objectContaining({ version: 1, body: '# Original' }), expect.objectContaining({ version: 2, body: '# Revised', actor }),
    ]));
  });

  it('preserves unit locking and evidence-derived schedules through the commands', async () => {
    const asset = await createAsset(getDb(), { name: 'Vehicle', kind: 'vehicle', meter_unit: 'km' });
    await addReading(asset.id, 87600, await today());
    await expect(updateAsset(getDb(), asset.id, { meter_unit: 'mi' }, await context(), actor)).rejects.toMatchObject({ code: 'meter_unit_locked' });
    const item = await createMaintenanceItem(getDb(), {
      name: 'Service', asset_id: asset.id, interval_months: 6, interval_meter: 5000,
      last_completed_on: '2026-01-01', last_completed_meter: 85000, next_due_date: '2026-10-01',
    }, actor);
    expect(item.next_due_meter).toBe(90000);
    expect(item.next_due_date).toBe('2026-10-01');
    await updateMaintenanceItem(getDb(), item.id, { interval_months: 6, interval_meter: 5000 }, await context());
    expect((await getItem(item.id)).next_due_date).toBe('2026-10-01');
    expect(await getDb().query.maintenance_logs.findMany({ where: eq(maintenance_logs.item_id, item.id) })).toEqual([
      expect.objectContaining({ is_baseline: true, completed_on: '2026-01-01', meter_at_completion: 85000, actor }),
    ]);
  });
});
