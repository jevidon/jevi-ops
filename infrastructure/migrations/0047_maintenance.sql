-- Migration 0047: maintenance module — assets, meter readings, items, logs.
--
-- Recurring upkeep as a first-class entity instead of a recurring task.
-- Why not tasks.recurrence_rule: (1) recurring tasks roll forward in place,
-- so "filters last replaced on X" has nowhere to live; (2) the rule
-- vocabulary is date-only, and vehicle maintenance is meter-keyed
-- ("every 5,000 km", or "5,000 km OR 6 months, whichever first").
--
-- Shape decisions:
--   * Cadence = discriminated columns (interval_days / interval_months /
--     interval_meter), not jsonb — queryable and CHECK-constrainable. Dual
--     cadence sets a date interval AND interval_meter; whichever-first is a
--     read-time predicate (packages/shared/src/maintenance.ts).
--   * next_due_date / next_due_meter are MATERIALIZED on the item and
--     recomputed only on completion and cadence edits. A new meter reading
--     never recomputes them — next_due_meter is fixed at
--     meter_at_completion + interval_meter, and due-ness is simply
--     latest_reading >= next_due_meter. Keeps cron/attention queries trivial.
--   * Completion RE-ANCHORS the schedule (replace a filter 3 weeks late →
--     next due shifts 3 weeks). Deliberately the opposite of task
--     recurrence, which anchors to the original due date.
--   * assets.kind is display/grouping only — no code path branches on it.
--     All meter behavior gates on meter_unit (null = date-only asset).
--     Vehicles are just assets with an odometer.
--   * assets.metadata / maintenance_items.metadata jsonb are the substrate
--     for the future vehicle-agent build (VIN, rego, insurance, research
--     notes, open questions) — deliberately schemaless here.
--   * The dormant inventory_items table (purchase/valuation concerns) is
--     intentionally untouched; it belongs to the future finance module.
--
-- Also widens two existing CHECKs so the awareness build (attention rules +
-- auto-created tasks) ships later as code-only, and adds the module flag.

-- ─── 1. assets ─────────────────────────────────────────────────────────

create table if not exists assets (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null default 'other' check (kind in
    ('vehicle','appliance','home','device','equipment','other')),
  domain_id uuid references stewardship_domains(id) on delete set null,
  -- Free text ('km','mi','hours'…) so unusual meters need no migration.
  -- Non-null means "this asset has a meter": enables the readings log and
  -- meter-cadence items.
  meter_unit text,
  metadata jsonb not null default '{}'::jsonb,
  notes text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_assets_updated_at on assets;
create trigger trg_assets_updated_at
  before update on assets
  for each row execute function set_updated_at();

comment on table assets is
  'Things that need ongoing upkeep (vehicle, appliance, bike…). kind is display-only; meter behavior gates on meter_unit.';
comment on column assets.meter_unit is
  'Free-text meter unit (km/mi/hours). Null = date-only asset; set = readings log + meter-cadence items apply.';
comment on column assets.metadata is
  'Schemaless per-asset facts (VIN, rego, insurance, warranty…). Substrate for the future vehicle-agent build.';

-- ─── 2. asset_meter_readings ───────────────────────────────────────────

create table if not exists asset_meter_readings (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references assets(id) on delete cascade,
  reading numeric not null check (reading >= 0),
  recorded_on date not null,
  source text not null default 'manual' check (source in
    ('manual','completion','agent','import')),
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists idx_asset_meter_readings_asset
  on asset_meter_readings(asset_id, recorded_on desc);

comment on table asset_meter_readings is
  'Append-only meter log (odometer, hour meter). source=completion rows are captured when completing a maintenance item with a reading.';

-- ─── 3. maintenance_items ──────────────────────────────────────────────

create table if not exists maintenance_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  notes text,
  -- Optional: freestanding chores ("clean the gutters") attach only to a
  -- domain. Asset deletion keeps the item (schedule survives the object
  -- record being pruned).
  asset_id uuid references assets(id) on delete set null,
  domain_id uuid not null references stewardship_domains(id),
  -- Cadence: one date unit (days XOR months) and/or a meter interval.
  -- interval_meter requires the asset to have a meter_unit — cross-table,
  -- so enforced by the API, not a CHECK.
  interval_days integer check (interval_days > 0),
  interval_months integer check (interval_months > 0),
  interval_meter numeric check (interval_meter > 0),
  -- Awareness lead: surface this far ahead of due. lead_meter null →
  -- 10% of interval_meter at read time.
  lead_days integer not null default 14 check (lead_days >= 0),
  lead_meter numeric check (lead_meter >= 0),
  -- Materialized next-due (see header). Meter axis stays null until the
  -- first completion-with-reading or an explicit override.
  next_due_date date,
  next_due_meter numeric,
  last_completed_on date,
  last_completed_meter numeric,
  -- Set by the awareness sweep when it creates a real task for a due item;
  -- cleared when either side completes. on delete set null → a deleted
  -- task regenerates on the next sweep.
  generated_task_id uuid references tasks(id) on delete set null,
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint maintenance_items_has_interval check (
    interval_days is not null or interval_months is not null
    or interval_meter is not null
  ),
  constraint maintenance_items_one_date_unit check (
    interval_days is null or interval_months is null
  )
);

create index if not exists idx_maintenance_items_due
  on maintenance_items(active, next_due_date);
create index if not exists idx_maintenance_items_asset
  on maintenance_items(asset_id) where asset_id is not null;

drop trigger if exists trg_maintenance_items_updated_at on maintenance_items;
create trigger trg_maintenance_items_updated_at
  before update on maintenance_items
  for each row execute function set_updated_at();

comment on table maintenance_items is
  'Recurring upkeep with date and/or meter cadence (whichever first). next_due_* are materialized; completion re-anchors the schedule.';
comment on column maintenance_items.next_due_meter is
  'Fixed at meter_at_completion + interval_meter on completion. New readings never recompute it; due = latest reading >= this.';
comment on column maintenance_items.generated_task_id is
  'Task auto-created by the awareness sweep when due/due-soon. Completing either side completes both.';

-- ─── 4. maintenance_logs ───────────────────────────────────────────────

create table if not exists maintenance_logs (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references maintenance_items(id) on delete cascade,
  completed_on date not null,
  meter_at_completion numeric check (meter_at_completion >= 0),
  notes text,
  cost numeric check (cost >= 0),
  source text not null default 'manual' check (source in
    ('manual','task','agent','import')),
  created_at timestamptz not null default now(),
  -- Idempotent complete: double-tapping the same day is a no-op
  -- (routine_completions precedent).
  constraint maintenance_logs_item_day_unique unique (item_id, completed_on)
);

create index if not exists idx_maintenance_logs_item
  on maintenance_logs(item_id, completed_on desc);

comment on table maintenance_logs is
  'Completion history ("filters last replaced on…") — the record recurring tasks never kept.';

-- ─── 5. Widen existing CHECKs for the awareness build ──────────────────
-- Shipped now so the sweep + attention rules land later as code-only.

alter table attention_items drop constraint if exists attention_items_source_type_check;
alter table attention_items add constraint attention_items_source_type_check
  check (source_type in
    ('person','company','domain','project','conversation','task','content',
     'maintenance_item','asset'));

alter table tasks drop constraint if exists tasks_source_check;
alter table tasks add constraint tasks_source_check
  check (source in ('manual','voice','email','observation','import','maintenance'));

-- ─── 6. Module flag (0036 pattern) ─────────────────────────────────────

alter table app_settings
  add column if not exists maintenance_module_enabled boolean not null default true;

comment on column app_settings.maintenance_module_enabled is
  'Gates the /maintenance web module. Default on — the module is core to the home-ops use case.';
