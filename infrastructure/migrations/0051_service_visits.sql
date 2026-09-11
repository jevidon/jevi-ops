-- Migration 0051: service visits.
--
-- A trip to the workshop (or an afternoon in the garage) does several items
-- at once, on ONE odometer, with ONE invoice. Recording that as N separate
-- completions gave N readings of the same number, N places for the cost,
-- and no record of who did the work. A visit is that event:
--
--   * maintenance_visits — the event: date, the odometer ONCE (a single
--     asset_meter_readings row every line links to), provider, invoice
--     number, currency, invoice total, notes, invoice photos. `planned`
--     visits are work orders (the "plan together" batch, saved); `done`
--     visits are the record.
--   * maintenance_visit_items — the lines of a planned visit (what to do,
--     per-line notes for the provider). Cleared on completion: the logs
--     are then the record.
--   * maintenance_logs.visit_id — each completion done at the visit. A
--     log's `cost` is the ALLOCATED line cost; the visit's `total` is what
--     the invoice said. They are kept distinct on purpose: spend reporting
--     is invoice-grounded (visit totals + loose completions' costs), the
--     per-item costs are for reasoning about one item over time.

create table if not exists maintenance_visits (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references assets(id) on delete cascade,
  status text not null default 'planned' check (status in ('planned','done')),
  planned_on date,
  visited_on date,
  -- The odometer at the visit — recorded once, as one reading.
  meter numeric check (meter >= 0),
  reading_id uuid references asset_meter_readings(id) on delete set null,
  provider text,
  invoice_number text,
  currency text,
  total numeric check (total >= 0),
  notes text,
  -- Invoice photos: StoredAttachment[] (the notes/journal shape).
  attachments jsonb not null default '[]'::jsonb,
  -- Idempotent events with provenance (0048 conventions).
  event_key text,
  actor text,
  run_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint maintenance_visits_done_has_date check (status <> 'done' or visited_on is not null)
);

create index if not exists idx_maintenance_visits_asset
  on maintenance_visits(asset_id, visited_on desc);
create index if not exists idx_maintenance_visits_asset_status
  on maintenance_visits(asset_id, status);
create unique index if not exists idx_maintenance_visits_event_key
  on maintenance_visits(event_key) where event_key is not null;

drop trigger if exists trg_maintenance_visits_updated_at on maintenance_visits;
create trigger trg_maintenance_visits_updated_at
  before update on maintenance_visits
  for each row execute function set_updated_at();

create table if not exists maintenance_visit_items (
  visit_id uuid not null references maintenance_visits(id) on delete cascade,
  item_id uuid not null references maintenance_items(id) on delete cascade,
  notes text,
  position integer not null default 0,
  primary key (visit_id, item_id)
);

alter table maintenance_logs
  add column if not exists visit_id uuid references maintenance_visits(id) on delete set null;
create index if not exists idx_maintenance_logs_visit
  on maintenance_logs(visit_id) where visit_id is not null;

comment on table maintenance_visits is
  'One service event: several items done on one odometer with one invoice. planned = a saved work order; done = the record.';
comment on column maintenance_visits.total is
  'The invoice total. Distinct from the allocated per-line costs on maintenance_logs.cost.';
comment on column maintenance_logs.visit_id is
  'The visit this completion happened at, when it was part of one. Its reading is the visit''s single reading.';
