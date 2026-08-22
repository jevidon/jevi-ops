-- Migration 0044: universal pins + Briefing panel config.
--
-- Two pieces of one feature (the Briefing panel system), shipped together:
--
-- 1. pinned_items — user-pinned entities surfaced on the Briefing homepage.
--    Polymorphic pointer (target_type + target_id, no FK — same pattern as
--    daily_focus, migration 0037): the id spans ten tables, so referential
--    integrity is app-side. Stale pins (target row deleted) are lazily
--    removed by GET /api/pins at read time; entity DELETE handlers stay
--    untouched. Durable and manually ordered — deliberately distinct from
--    the ephemeral tasks.top3_for_date day-pin, which self-expires.
--
-- 2. app_settings.briefing_panels — ordered panel visibility config for the
--    Briefing. A jsonb document (ordered array of {id, enabled}) rather than
--    this table's usual typed columns because an ordered list is intrinsically
--    a document; null → registry defaults. Unknown ids are dropped and newly
--    shipped panels appended at read time (web mergePanelConfig), so the
--    stored value never needs migrating when panels come and go.

create table if not exists pinned_items (
  id          uuid primary key default gen_random_uuid(),
  target_type text not null,
  target_id   uuid not null,
  position    integer not null,
  created_at  timestamptz not null default now(),
  constraint pinned_items_target_type_check check (target_type in (
    'task','project','domain','person','company',
    'content_item','book','note','quote','routine')),
  constraint pinned_items_target_unique unique (target_type, target_id)
);

create index if not exists idx_pinned_items_position on pinned_items (position);

comment on table pinned_items is
  'User-pinned entities surfaced on the Briefing. Polymorphic pointer (no FK, like daily_focus); stale pins are lazily deleted at read time by GET /api/pins.';
comment on column pinned_items.position is
  'Manual order, 0-based. Reorder rewrites all positions from a full ordered list; new pins append at max+1.';

alter table app_settings
  add column if not exists briefing_panels jsonb;

comment on column app_settings.briefing_panels is
  'Ordered array of {id, enabled} controlling Briefing panel visibility/order. Null → registry defaults; unknown ids dropped and new panels appended at read time.';
