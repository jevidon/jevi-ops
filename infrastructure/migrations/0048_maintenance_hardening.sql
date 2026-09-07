-- Migration 0048: maintenance hardening — obligation policies, idempotent
-- events with provenance, durable task occurrences, asset lifecycle.
--
-- Follows an independent review of 0047's engine. The shape stays (generic
-- assets, meter as a capability, one completion entry point); what changes
-- is how state is *derived* so an autonomous agent can rely on it:
--
--   * Obligation POLICY on items. 'interval' is 0047's behaviour (re-anchor
--     from the completion). 'expiry' items (rego, WoF, insurance) take the
--     newly issued expiry as next due — "today + 12 months" is wrong for a
--     licence that was issued to a chosen date. 'prepaid_meter' (NZ RUC) takes
--     the purchased end distance as authoritative. 'on_condition' items have no
--     interval: an inspection records a finding and a next review.
--   * Completion logs become idempotent EVENTS: event_key (client- or
--     server-generated) replaces the (item, day) unique, which both made a
--     retry after a partial failure a silent no-op and forbade two legitimate
--     same-day services. Provenance (actor, run_id) is derived from the
--     authenticated credential, never trusted from the payload.
--   * Evidence links: a completion that carried a reading links to it, so undo
--     can void the reading it created without touching independent readings.
--     Seed history ("last done 2026-06-01 at 95,000") becomes an explicit
--     is_baseline log row instead of item-only columns, so undo can rebuild.
--   * Readings are corrected by VOIDING, never deleting — history keeps its
--     meaning. Idempotent too (event_key).
--   * items.domain_id becomes nullable: null = inherit the asset's domain at
--     read time (else Inbox). Assigning an asset to a domain later then moves
--     its items with it, instead of freezing the domain they were created in.
--   * tasks.source_ref: a durable occurrence identity for generated tasks
--     ("maint:<item>:<next_due_date>:<next_due_meter>"). The partial unique
--     index is what makes concurrent sweeps unable to create duplicates —
--     locking alone can't cover the HTTP + post-reading callers.
--   * assets.lifecycle: stored/sold/archived assets keep their history but
--     stop generating tasks, attention, and reading nags.
--   * app_settings.meter_stale_days: the one configurable reading policy.

-- ─── 1. maintenance_items ──────────────────────────────────────────────

alter table maintenance_items
  add column if not exists policy text not null default 'interval';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'maintenance_items_policy_check') then
    alter table maintenance_items add constraint maintenance_items_policy_check
      check (policy in ('interval','expiry','prepaid_meter','on_condition'));
  end if;
end $$;

-- Grouping for the per-asset schedule (Fluids, Brakes, Legal…). Free text.
alter table maintenance_items add column if not exists system text;

-- null = inherit the asset's domain (else Inbox) — resolved at read time by
-- one shared helper so visibility policy lives in one place.
alter table maintenance_items alter column domain_id drop not null;
update maintenance_items i
   set domain_id = null
  from assets a
 where i.asset_id = a.id
   and (i.domain_id = a.domain_id or i.domain_id = 'acf035ee-b247-4c96-a07e-5946bc2b2e91');

-- An interval is only mandatory for the 'interval' policy.
alter table maintenance_items drop constraint if exists maintenance_items_has_interval;
alter table maintenance_items add constraint maintenance_items_has_interval check (
  policy <> 'interval'
  or interval_days is not null or interval_months is not null or interval_meter is not null
);

comment on column maintenance_items.policy is
  'interval: re-anchor from completion. expiry: next due = issued_until from the completion. prepaid_meter: next due meter = purchased_to. on_condition: no interval; completion records a finding + next review.';
comment on column maintenance_items.system is
  'Grouping label for the per-asset schedule view (Fluids, Brakes, Legal…).';
comment on column maintenance_items.domain_id is
  'Null = inherit the asset''s domain at read time (else Inbox). Set only to override.';

-- ─── 2. maintenance_logs → idempotent events ───────────────────────────

alter table maintenance_logs drop constraint if exists maintenance_logs_item_day_unique;
alter table maintenance_logs add column if not exists event_key text;
create unique index if not exists idx_maintenance_logs_event_key
  on maintenance_logs(event_key) where event_key is not null;
alter table maintenance_logs add column if not exists actor text;
alter table maintenance_logs add column if not exists run_id text;
alter table maintenance_logs add column if not exists reading_id uuid
  references asset_meter_readings(id) on delete set null;
alter table maintenance_logs add column if not exists is_baseline boolean not null default false;
alter table maintenance_logs add column if not exists issued_until date;
alter table maintenance_logs add column if not exists purchased_to numeric;
alter table maintenance_logs add column if not exists finding text;
alter table maintenance_logs add column if not exists next_review_on date;
alter table maintenance_logs add column if not exists next_review_meter numeric;

-- Backfill: 0047 seed history lived only on the item. Materialise it as an
-- explicit baseline event so undo can rebuild from evidence.
insert into maintenance_logs (item_id, completed_on, meter_at_completion, source, is_baseline, notes)
select i.id, i.last_completed_on, i.last_completed_meter, 'import', true, 'Baseline (migrated from item seed)'
  from maintenance_items i
 where i.last_completed_on is not null
   and not exists (select 1 from maintenance_logs l where l.item_id = i.id);

comment on column maintenance_logs.event_key is
  'Idempotency key. Client-supplied or server-generated uuid; a repeat with the same key converges instead of double-logging.';
comment on column maintenance_logs.actor is
  'session:<email> or token:<name> — derived from the credential, never from the payload.';
comment on column maintenance_logs.reading_id is
  'The asset_meter_readings row this completion created (source=completion). Undo voids it.';
comment on column maintenance_logs.is_baseline is
  'Seed evidence ("last done … at …") entered at item creation. Editable, not deletable — undo rebuilds from it.';

-- ─── 3. asset_meter_readings: idempotency, provenance, corrections ─────

alter table asset_meter_readings add column if not exists event_key text;
create unique index if not exists idx_asset_meter_readings_event_key
  on asset_meter_readings(event_key) where event_key is not null;
alter table asset_meter_readings add column if not exists actor text;
alter table asset_meter_readings add column if not exists voided_at timestamptz;

comment on column asset_meter_readings.voided_at is
  'Corrections void rather than delete, so history keeps its meaning. Voided rows are ignored by every "latest reading" path.';

-- ─── 4. assets: lifecycle ──────────────────────────────────────────────

alter table assets add column if not exists lifecycle text not null default 'active';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'assets_lifecycle_check') then
    alter table assets add constraint assets_lifecycle_check
      check (lifecycle in ('active','stored','sold','archived'));
  end if;
end $$;
update assets set lifecycle = 'archived' where archived_at is not null and lifecycle = 'active';

comment on column assets.lifecycle is
  'Only active assets generate tasks, attention, and reading nags. stored/sold/archived keep their history.';

-- ─── 5. tasks: durable occurrence identity ─────────────────────────────

alter table tasks add column if not exists source_ref text;
create unique index if not exists idx_tasks_source_ref
  on tasks(source, source_ref) where source_ref is not null;

comment on column tasks.source_ref is
  'Source-specific identity for generated tasks (maintenance: maint:<item>:<due_date>:<due_meter>). Unique per source — concurrent generators cannot duplicate.';

-- ─── 6. app_settings: reading staleness policy ─────────────────────────

alter table app_settings
  add column if not exists meter_stale_days integer not null default 14;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'app_settings_meter_stale_days_check') then
    alter table app_settings add constraint app_settings_meter_stale_days_check
      check (meter_stale_days > 0);
  end if;
end $$;

comment on column app_settings.meter_stale_days is
  'Days without a meter reading before a metered asset with meter-cadence items gets the reading nag.';
