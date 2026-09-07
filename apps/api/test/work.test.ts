import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { buildServer } from '../src/server.js';
import { signSession } from '../src/lib/jwt.js';
import { buildWork } from '../src/lib/work.js';
import { getDb } from '../src/lib/db.js';
import { projects, stewardship_domains } from '../src/db/schema.js';
import { addReading, createAsset, createItem, daysFromToday, today } from './helpers.js';

// The asset as an area (0049): assignment promotes an asset into the Work
// payload; project cards carry their asset; the asset bundle carries its
// domain, projects and spend.

let app: FastifyInstance;
let session: string;
let domainId: string;

beforeAll(async () => {
  app = await buildServer();
  await app.ready();
  session = await signSession({ id: '00000000-0000-0000-0000-000000000001', email: 'probe@test.local' });
});
afterAll(async () => {
  await app.close();
});
beforeEach(async () => {
  const [d] = await getDb()
    .select({ id: stewardship_domains.id })
    .from(stewardship_domains)
    .where(eq(stewardship_domains.is_system, false))
    .limit(1);
  domainId = d!.id;
  await getDb().delete(projects);
});

function req(method: 'GET' | 'POST' | 'PATCH', url: string, body?: unknown) {
  return app.inject({ method, url, headers: { authorization: `Bearer ${session}` }, ...(body !== undefined ? { payload: body } : {}) });
}

describe('buildWork — assets band', () => {
  it('only assigned, active assets ride in a domain; counts come from the shared due-state', async () => {
    const assigned = await createAsset({ name: 'Outback', domain_id: domainId });
    await createAsset({ name: 'Purifier', meter_unit: null }); // unassigned
    await createAsset({ name: 'Old Hilux', domain_id: domainId, lifecycle: 'sold' });
    await createItem({ asset_id: assigned.id, baseline: { completed_on: '2026-06-01', meter: 100000 } });
    await createItem({ asset_id: assigned.id, name: 'WoF', interval_meter: null, interval_months: 12, next_due_date: await daysFromToday(-3) });
    await addReading(assigned.id, 101000, await today());

    const work = await buildWork(getDb());
    const domain = work.domains.find((d) => d.id === domainId) ?? work.parked.find((d) => d.id === domainId);
    expect(domain).toBeDefined();
    expect(domain!.assets.map((a) => a.name)).toEqual(['Outback']);
    const card = domain!.assets[0]!;
    expect(card.maintenance).toEqual({ total: 2, overdue: 1, due: 0, due_soon: 0 });
    expect(card.worst).toBe('overdue');
    expect(card.urgency).toBe('over');
    expect(card.latest_reading).toBe(101000);
    expect(card.data).toBe('complete');
    // A slipping vehicle escalates its domain — never calmer than a card inside.
    expect(domain!.urgency).toBe('over');
  });

  it('reports data confidence and a quiet pill for an asset with nothing to say', async () => {
    const a = await createAsset({ name: 'Bike', domain_id: domainId });
    await createItem({ asset_id: a.id, name: 'Chain', interval_months: null, interval_meter: 3000 }); // no baseline, no reading
    const work = await buildWork(getDb());
    const card = work.domains.concat(work.parked).flatMap((d) => d.assets).find((c) => c.name === 'Bike')!;
    expect(card.worst).toBe('ok');
    expect(card.data).toBe('needs_baseline');
    expect(card.urgency).toBe('ok');
    const empty = await createAsset({ name: 'Ladder', domain_id: domainId, meter_unit: null });
    const again = await buildWork(getDb());
    const ladder = again.domains.concat(again.parked).flatMap((d) => d.assets).find((c) => c.id === empty.id)!;
    expect(ladder.worst).toBeNull();
    expect(ladder.urgency).toBe('quiet');
  });

  it('project cards carry their asset; the sort puts slipping assets first', async () => {
    const a = await createAsset({ name: 'Outback', domain_id: domainId, meter_unit: null });
    const b = await createAsset({ name: 'Hilux', domain_id: domainId, meter_unit: null });
    await createItem({ asset_id: b.id, interval_meter: null, next_due_date: await daysFromToday(-1) });
    await getDb().insert(projects).values({ name: 'Roof rack', domain_id: domainId, asset_id: a.id, status: 'active' });
    const work = await buildWork(getDb());
    const domain = work.domains.concat(work.parked).find((d) => d.id === domainId)!;
    expect(domain.assets.map((x) => x.name)).toEqual(['Hilux', 'Outback']);
    const card = domain.projects.find((p) => p.name === 'Roof rack')!;
    expect(card.asset).toEqual({ id: a.id, name: 'Outback' });
    expect(domain.assets.find((x) => x.id === a.id)!.projects).toBe(1);
  });
});

describe('projects ↔ assets', () => {
  it('POST /api/projects with asset_id and no domain inherits the asset domain', async () => {
    const a = await createAsset({ name: 'Outback', domain_id: domainId, meter_unit: null });
    const res = await req('POST', '/api/projects', { name: 'Tow bar', asset_id: a.id });
    expect(res.statusCode).toBe(201);
    expect(res.json().domain_id).toBe(domainId);
    expect(res.json().asset_id).toBe(a.id);
    const detail = await req('GET', `/api/projects/${res.json().id}`);
    expect(detail.json().project.asset).toEqual({ id: a.id, name: 'Outback' });
  });

  it('an unassigned asset leaves the project without a domain', async () => {
    const a = await createAsset({ name: 'Purifier', meter_unit: null });
    const res = await req('POST', '/api/projects', { name: 'Filter upgrade', asset_id: a.id });
    expect(res.statusCode).toBe(201);
    expect(res.json().domain_id).toBeNull();
  });
});

describe('GET /api/assets/:id bundle', () => {
  it('carries the domain, projects, and this year’s logged spend', async () => {
    const a = await createAsset({ name: 'Outback', domain_id: domainId });
    const item = await createItem({ asset_id: a.id, baseline: { completed_on: '2026-06-01', meter: 100000 } });
    await getDb().insert(projects).values({ name: 'Roof rack', domain_id: domainId, asset_id: a.id, status: 'active' });
    await getDb().insert(projects).values({ name: 'Old idea', domain_id: domainId, asset_id: a.id, status: 'archived' });
    await req('POST', `/api/maintenance/${item.id}/complete`, { meter: 104000, cost: 120 });
    await req('POST', `/api/maintenance/${item.id}/complete`, { completed_on: '2025-12-20', cost: 999 }); // last year — history
    const res = await req('GET', `/api/assets/${a.id}`);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.domain.id).toBe(domainId);
    expect(body.projects.map((p: { name: string }) => p.name)).toEqual(['Roof rack']);
    expect(body.cost_ytd).toBe(120);
    expect(body.meter_stale_days).toBe(14);
  });
});
