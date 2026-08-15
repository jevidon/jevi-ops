-- Migration 0036: module feature flags on app_settings.
-- Ported from upstream jerad-ops v2.0.0, collapsing its three flag
-- migrations (0032 health, 0038 routines, 0044 §1 rule) into one — this
-- fork adopts the Editorial v2 web tree, whose layout gates nav items and
-- routes on these flags.
--
-- app_settings is a typed singleton (boolean PK pinned true), so a feature
-- flag is a typed boolean column, per the table's own convention.
--
--   health_module_enabled   default FALSE — Health hidden until enabled in
--                           Settings → Modules. Health tables/data untouched.
--   routines_module_enabled default TRUE  — Routines stays on; toggle lets
--                           it be turned off (data retained).
--   rule_module_enabled     default FALSE — the Daily Rule module is not
--                           ported to this fork (upstream retired it too);
--                           the flag exists because the adopted web tree
--                           checks it. Stays false.

alter table app_settings
  add column if not exists health_module_enabled boolean not null default false;
alter table app_settings
  add column if not exists routines_module_enabled boolean not null default true;
alter table app_settings
  add column if not exists rule_module_enabled boolean not null default false;

comment on column app_settings.health_module_enabled is
  'Feature flag: when false the Health nav item is hidden and /health web routes notFound(). Data retained regardless.';
comment on column app_settings.routines_module_enabled is
  'Feature flag: Routines module visibility. Default true. Data retained when off.';
comment on column app_settings.rule_module_enabled is
  'Feature flag for the upstream Daily Rule module, which this fork does not ship. The adopted web tree checks it; stays false.';
