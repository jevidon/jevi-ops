-- Migration 0043: per-company check-in cadence (CRM module port).
-- Ported verbatim from upstream jerad-ops v2.0.0 migration 0045.
--
-- Per-company check-in cadence for the company_silent attention rule.
-- Replaces the rule's flat cutoff with a per-company interval so each
-- client can carry its own "check in every N days". Null → the rule's
-- default of 30 days. The column lives on every company but is only
-- consulted for active_client companies.

alter table companies
  add column if not exists checkin_interval_days integer
    check (checkin_interval_days is null or checkin_interval_days > 0);

comment on column companies.checkin_interval_days is
  'Silent-client check-in cadence in days (company_silent attention rule). Null → rule default 30. Only consulted for active_client companies.';
