-- ─────────────────────────────────────────────────────────────────────────
-- jevi-ops — seed data (fresh installs / dev only)
-- ─────────────────────────────────────────────────────────────────────────
--
-- Run AFTER schema-selfhost.sql on a brand-new database:
--   psql "$DATABASE_URL" -f seed.sql
--
-- Do NOT run when migrating an existing deployment — the restored data
-- dump already contains these rows (see MIGRATION.md).
--
-- ─────────────────────────────────────────────────────────────────────────

-- New installations start with system records only. Optional sample domains
-- live in seed-demo.sql and are never part of automatic bootstrap.

-- Inbox: system domain used when a task has no natural home
-- (added in migration 0026). UUID is hardcoded — packages/shared/src/
-- constants/domains.ts and several API paths reference it directly.
-- Do not change this UUID.
insert into stewardship_domains (id, name, description, fruit_definition, failure_patterns, expected_cadence, is_system)
values (
  'acf035ee-b247-4c96-a07e-5946bc2b2e91',
  'Inbox',
  'Unsorted tasks awaiting a real home',
  null,
  '[]'::jsonb,
  null,
  true
) on conflict (name) do nothing;

-- App settings singleton (from migration 0022).
insert into app_settings (id, timezone) values (true, 'America/Denver')
on conflict (id) do nothing;

-- Health history singleton (from migration 0024).
insert into health_history (id) values (true) on conflict (id) do nothing;
