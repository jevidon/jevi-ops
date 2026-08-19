-- Migration 0044: Shopping module — recurring shopping lists.
--
-- Replaces the wiki "Grocery Shopping" page: a list is a store/section
-- (Household, Costco, Kroger…) and an item is a thing bought there
-- repeatedly. Semantics are INVERTED from tasks/checklists — `needed`
-- checked means "buy this"; purchasing clears the flag and appends to a
-- purchase ledger. Items persist forever and cycle between stocked and
-- needed rather than completing.
--
-- Design decisions:
--   * shopping_purchases is a ledger (routine_completions pattern) but
--     with NO unique (item, date) — buying twice a day is legal. It is
--     the FK target for a future finance module (bank transactions,
--     receipts); nullable price_cents/note is all the forward-compat
--     carried now.
--   * recurrence_rule reuses the shared 8-value vocabulary, but the
--     reflag derivation is anchored to last_purchased_at (interval since
--     purchase), not calendar periods — computed at API read time, no
--     cron. See isDueAgain() in packages/shared/src/recurrence.ts.
--   * No domain_id: shopping is a household-wide utility, not
--     stewardship work.

-- ─── 1. shopping_lists ─────────────────────────────────────────────────

create table if not exists shopping_lists (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  position integer not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_shopping_lists_active_position
  on shopping_lists(position) where archived_at is null;

drop trigger if exists trg_shopping_lists_updated_at on shopping_lists;
create trigger trg_shopping_lists_updated_at
  before update on shopping_lists
  for each row execute function set_updated_at();

comment on table shopping_lists is
  'Shopping module: a list is a store or section (Household, Costco…). Archived lists keep their items and ledger.';

-- ─── 2. shopping_items ─────────────────────────────────────────────────

create table if not exists shopping_items (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references shopping_lists(id) on delete cascade,
  name text not null,
  note text,
  position integer not null default 0,
  needed boolean not null default false,
  needed_at timestamptz,
  recurrence_rule text check (recurrence_rule in
    ('daily','weekdays','weekly','biweekly','monthly',
     'quarterly','semiannually','yearly')),
  last_purchased_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_shopping_items_list_position
  on shopping_items(list_id, position) where archived_at is null;

drop trigger if exists trg_shopping_items_updated_at on shopping_items;
create trigger trg_shopping_items_updated_at
  before update on shopping_items
  for each row execute function set_updated_at();

comment on column shopping_items.needed is
  'INVERTED vs task done: true = needs buying. Cleared by purchase (ledger row) or dismiss (no ledger row).';
comment on column shopping_items.recurrence_rule is
  'Optional auto-reflag cadence. Item derives as needed once a full interval elapses since last_purchased_at — computed at read time, no cron.';
comment on column shopping_items.last_purchased_at is
  'Recurrence anchor. Stamped by purchase; also bumped by dismiss-without-buying on rule items so a skip counts as satisfied this cycle.';

-- ─── 3. shopping_purchases (ledger) ────────────────────────────────────

create table if not exists shopping_purchases (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references shopping_items(id) on delete cascade,
  purchased_at timestamptz not null default now(),
  price_cents integer check (price_cents is null or price_cents >= 0),
  note text,
  created_at timestamptz not null default now()
);

create index if not exists idx_shopping_purchases_item_date
  on shopping_purchases(item_id, purchased_at desc);

comment on table shopping_purchases is
  'Purchase ledger. No unique (item, date) — buying twice a day is legal. Future finance module (transactions/receipts) FKs here.';

-- ─── 4. Feature flag ───────────────────────────────────────────────────
-- Default TRUE (routines precedent, not health): the module is being
-- built because it is wanted; the toggle exists to turn it off.

alter table app_settings
  add column if not exists shopping_module_enabled boolean not null default true;

comment on column app_settings.shopping_module_enabled is
  'Feature flag: Shopping module visibility. Default true. Data retained when off.';
