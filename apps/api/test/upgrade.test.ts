import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { INBOX_DOMAIN_ID } from '@jevi-ops/shared';
import { adminUrl, devUrl } from './db-url.js';

// The upgrade path, not just the clean bootstrap: a database built from the
// 0047-era self-host schema (frozen in fixtures/schema-0047.sql, the file at
// commit ed28da2) and POPULATED the way a real one would be — seed-only
// items, items with completion logs and readings, a live generated task, an
// archived asset — then 0048 and 0049 applied on top, then applied again.
// Raw SQL through its own client; the app's pool stays on jeviops_test.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const DB = 'jeviops_upgrade';
const MIGRATIONS = ['0048_maintenance_hardening.sql', '0049_asset_area.sql', '0050_docs_ideas.sql', '0051_service_visits.sql'].map((f) =>
  resolve(ROOT, 'infrastructure/migrations', f),
);

function upgradeUrl(): string {
  const u = new URL(devUrl());
  u.pathname = `/${DB}`;
  return u.toString();
}

let sql: postgres.Sql;

beforeAll(async () => {
  const admin = postgres(adminUrl(), { max: 1, onnotice: () => {} });
  try {
    await admin.unsafe(`drop database if exists ${DB} with (force)`);
    await admin.unsafe(`create database ${DB}`);
  } finally {
    await admin.end();
  }
  sql = postgres(upgradeUrl(), { max: 1, onnotice: () => {} });
  await sql.file(resolve(ROOT, 'apps/api/test/fixtures/schema-0047.sql'));
  await sql.file(resolve(ROOT, 'infrastructure/seed.sql'));
});
afterAll(async () => {
  await sql.end();
});

describe('0047 → 0048 → 0049', () => {
  it('upgrades a populated database and is idempotent', async () => {
    const domains = await sql`select id from stewardship_domains where is_system = false order by name limit 2`;
    const domainA = domains[0]!.id as string;
    const domainB = (domains[1] ?? domains[0])!.id as string;

    // ─── 0047-era data ───────────────────────────────────────────────
    const [car] = await sql`insert into assets (name, kind, domain_id, meter_unit) values ('Outback', 'vehicle', ${domainA}, 'km') returning id`;
    const [old] = await sql`insert into assets (name, kind, archived_at) values ('Old Hilux', 'vehicle', now()) returning id`;
    await sql`insert into asset_meter_readings (asset_id, reading, recorded_on) values (${car!.id}, 100000, '2026-06-01'), (${car!.id}, 103000, '2026-08-20')`;

    // Seed history lived only on the item in 0047 → must become a baseline log.
    const [seedOnly] = await sql`
      insert into maintenance_items (name, asset_id, domain_id, interval_months, interval_meter, last_completed_on, last_completed_meter, next_due_date, next_due_meter)
      values ('Oil', ${car!.id}, ${domainA}, 6, 5000, '2026-06-01', 100000, '2026-12-01', 105000) returning id`;
    // An item with a real log (no backfill), routed to Inbox in 0047's terms (→ inherit).
    const [withLog] = await sql`
      insert into maintenance_items (name, asset_id, domain_id, interval_months, last_completed_on, next_due_date)
      values ('WoF', ${car!.id}, ${INBOX_DOMAIN_ID}, 12, '2026-03-01', '2027-03-01') returning id`;
    await sql`insert into maintenance_logs (item_id, completed_on, source) values (${withLog!.id}, '2026-03-01', 'manual')`;
    // An explicit cross-domain route: must survive as an override.
    const [override] = await sql`
      insert into maintenance_items (name, asset_id, domain_id, interval_months) values ('Rego', ${car!.id}, ${domainB === domainA ? INBOX_DOMAIN_ID : domainB}, 12) returning id`;
    // A live generated task, linked the 0047 way.
    const [task] = await sql`insert into tasks (title, domain_id, source, due_date) values ('Oil — Outback', ${domainA}, 'maintenance', '2026-09-01') returning id`;
    await sql`update maintenance_items set generated_task_id = ${task!.id} where id = ${seedOnly!.id}`;

    // ─── Upgrade ─────────────────────────────────────────────────────
    for (const m of MIGRATIONS) await sql.file(m);

    const [s] = await sql`select policy, domain_id, system, generated_task_id from maintenance_items where id = ${seedOnly!.id}`;
    expect(s!.policy).toBe('interval');
    expect(s!.domain_id).toBeNull(); // matched the asset's → inherit
    expect(s!.generated_task_id).toBe(task!.id); // the live task survived
    const [w] = await sql`select domain_id from maintenance_items where id = ${withLog!.id}`;
    expect(w!.domain_id).toBeNull(); // Inbox → inherit
    if (domainB !== domainA) {
      const [o] = await sql`select domain_id from maintenance_items where id = ${override!.id}`;
      expect(o!.domain_id).toBe(domainB);
    }

    const baselines = await sql`select is_baseline, completed_on::text as completed_on, meter_at_completion::float as meter, source from maintenance_logs where item_id = ${seedOnly!.id}`;
    expect(baselines).toHaveLength(1);
    expect(baselines[0]).toMatchObject({ is_baseline: true, completed_on: '2026-06-01', meter: 100000, source: 'import' });
    const existingLogs = await sql`select is_baseline from maintenance_logs where item_id = ${withLog!.id}`;
    expect(existingLogs).toHaveLength(1);
    expect(existingLogs[0]!.is_baseline).toBe(false);

    const [oldAsset] = await sql`select lifecycle from assets where id = ${old!.id}`;
    expect(oldAsset!.lifecycle).toBe('archived');
    const [carRow] = await sql`select lifecycle, attachments from assets where id = ${car!.id}`;
    expect(carRow!.lifecycle).toBe('active');
    expect(carRow!.attachments).toEqual([]);

    const cols = await sql`
      select table_name, column_name from information_schema.columns
      where (table_name, column_name) in (
        ('projects', 'asset_id'), ('assets', 'attachments'), ('assets', 'lifecycle'),
        ('maintenance_logs', 'event_key'), ('maintenance_logs', 'reading_id'), ('maintenance_items', 'policy'),
        ('asset_meter_readings', 'voided_at'), ('tasks', 'source_ref'), ('app_settings', 'meter_stale_days'))`;
    expect(cols).toHaveLength(9);
    const [idx] = await sql`select count(*)::int as n from pg_indexes where indexname in ('idx_tasks_source_ref', 'idx_maintenance_logs_event_key', 'idx_projects_asset')`;
    expect(idx!.n).toBe(3);
    const [settings] = await sql`select meter_stale_days from app_settings limit 1`;
    expect(settings!.meter_stale_days).toBe(14);

    // 0050: docs + ideas.
    const docCols = await sql`
      select table_name from information_schema.columns
      where column_name = 'doc_version' and table_name in ('assets', 'projects', 'stewardship_domains')`;
    expect(docCols).toHaveLength(3);
    const [docRev] = await sql`select count(*)::int as n from information_schema.tables where table_name = 'doc_revisions'`;
    expect(docRev!.n).toBe(1);
    const [idea] = await sql`insert into projects (name, domain_id, status) values ('Lift kit', ${domainA}, 'idea') returning status, doc_version`;
    expect(idea!.status).toBe('idea');
    expect(idea!.doc_version).toBe(1);

    // 0051: visits.
    const [visitCols] = await sql`select count(*)::int as n from information_schema.columns where (table_name, column_name) in (('maintenance_visits', 'reading_id'), ('maintenance_visit_items', 'position'), ('maintenance_logs', 'visit_id'))`;
    expect(visitCols!.n).toBe(3);
    const [v] = await sql`insert into maintenance_visits (asset_id, status, planned_on) values (${car!.id}, 'planned', '2026-10-01') returning id`;
    await sql`insert into maintenance_visit_items (visit_id, item_id) values (${v!.id}, ${seedOnly!.id})`;
    await expect(sql`insert into maintenance_visits (asset_id, status) values (${car!.id}, 'done')`).rejects.toThrow(); // done needs a date

    // The (item, day) unique is gone: two same-day services are allowed.
    await sql`insert into maintenance_logs (item_id, completed_on, source, event_key) values (${withLog!.id}, '2026-03-01', 'manual', 'a'), (${withLog!.id}, '2026-03-01', 'manual', 'b')`;
    // …but an event_key is unique.
    await expect(sql`insert into maintenance_logs (item_id, completed_on, source, event_key) values (${withLog!.id}, '2026-04-01', 'manual', 'a')`).rejects.toThrow();

    // ─── Again — every statement is idempotent ───────────────────────
    for (const m of MIGRATIONS) await sql.file(m);
    const [n] = await sql`select count(*)::int as n from maintenance_logs where item_id = ${seedOnly!.id}`;
    expect(n!.n).toBe(1);
  });
});
