-- Migration 0052: the household currency, and what happened to each planned line.
--
-- Spend was adding invoice totals in whatever currency each visit carried.
-- Money in this app is one household's: a declared household currency
-- (app_settings.currency) is what totals are stated in; an invoice in
-- another currency is reported beside the total, never converted or
-- silently added. Visits default to the household currency.
--
-- A planned visit's lines used to be deleted on completion, losing the
-- instructions for the provider and the reason a line was deferred. They
-- stay now, each with an outcome ('done' or 'skipped') and a skip reason;
-- the logs remain the record of the work itself.

alter table app_settings
  add column if not exists currency text not null default 'USD';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'app_settings_currency_check') then
    alter table app_settings add constraint app_settings_currency_check
      check (currency ~ '^[A-Z]{3}$');
  end if;
end $$;

comment on column app_settings.currency is
  'ISO 4217 household currency. Spend totals are stated in it; foreign-currency invoices are listed apart, never converted.';

alter table maintenance_visit_items add column if not exists outcome text;
alter table maintenance_visit_items add column if not exists skip_reason text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'maintenance_visit_items_outcome_check') then
    alter table maintenance_visit_items add constraint maintenance_visit_items_outcome_check
      check (outcome is null or outcome in ('done','skipped'));
  end if;
end $$;

comment on column maintenance_visit_items.outcome is
  'Null while the visit is planned; done or skipped once it is recorded. Skipped lines keep their instructions and skip_reason.';
