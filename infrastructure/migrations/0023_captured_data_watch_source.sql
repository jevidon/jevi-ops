-- Migration 0023: add 'watch' to the captured_data.source CHECK constraint.
--
-- The Zod schema (packages/shared/src/schemas/captured.ts) was extended
-- to include 'watch' so Apple Watch / Wear OS shortcuts can post to
-- /api/ingest, but the DB CHECK constraint hadn't been updated — so
-- payloads validated client-side, the insert reached Postgres, and the
-- DB rejected with a constraint violation that surfaced as a generic
-- 500 'insert_failed' in the API.

alter table captured_data
  drop constraint if exists captured_data_source_check;

alter table captured_data
  add constraint captured_data_source_check
  check (source in (
    'zapier', 'cowork', 'n8n', 'manual', 'webhook', 'smart_glasses', 'watch', 'other'
  ));

comment on constraint captured_data_source_check on captured_data is
  'Mirrors CaptureSourceSchema in packages/shared/src/schemas/captured.ts. Keep both in sync when adding sources.';
