-- Migration 0040: per-domain staleness config for the Attention Engine.
-- Ported from upstream jerad-ops 0040 (v2.0.0, Addendum 06 §7) — the number
-- coincidentally matches. The domain_stale rule was hardcoded to a flat
-- 21-day cutoff for every active domain.
--
-- Two changes work together:
--   1. These columns make attention staleness user-editable per domain
--      (on/off + threshold), from the domain detail page.
--   2. The rule itself (lib/attention.ts) already SKIPS any domain that
--      has an Observations cadence rule in failure_patterns — Observations
--      owns those, so Attention doesn't duplicate them.

alter table stewardship_domains
  add column if not exists stale_enabled boolean not null default true,
  -- null → fall back to the rule's default (21). Editable per domain.
  add column if not exists stale_days integer;

comment on column stewardship_domains.stale_enabled is
  'Attention domain_stale on/off for this domain. Also auto-skipped when the domain has an Observations cadence rule.';
comment on column stewardship_domains.stale_days is
  'Attention domain_stale threshold in days. Null → default 21.';
