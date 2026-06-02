-- Migration 0025: resurface_weight on quotes, journal_entries, notes.
--
-- The Today page's Resurfacing panel picks one item per day from the
-- library to put back in front of you. Pure-uniform random would
-- surface every quote with equal probability, which isn't always what
-- you want — some quotes you want to see often, others you saved
-- because they were intriguing but they don't need to come back weekly.
--
-- Each row gets a `resurface_weight` numeric:
--   1.0 (default) — normal probability
--   2.0, 3.0, …   — boosted: this many times as likely to surface
--   0.5, 0.25, …  — de-emphasized
--   0             — excluded from the rotation entirely (kept in DB)
--
-- The picker uses weighted random selection seeded by today's date,
-- so the same item shows all day and rotates tomorrow. No state to
-- maintain, no last_surfaced_at column to update on every render.
--
-- v1 ships with NO UI for adjusting these weights — everything starts
-- at 1.0 and behaves uniformly. The follow-up UX (per-item "boost"
-- buttons, library filter chip, voice intent) can land later without
-- another migration.

alter table quotes
  add column if not exists resurface_weight numeric not null default 1.0
  check (resurface_weight >= 0);

alter table journal_entries
  add column if not exists resurface_weight numeric not null default 1.0
  check (resurface_weight >= 0);

alter table notes
  add column if not exists resurface_weight numeric not null default 1.0
  check (resurface_weight >= 0);

comment on column quotes.resurface_weight is
  'Probability multiplier for the daily Resurfacing pick. 1.0 = normal, 0 = excluded, higher = more likely.';
comment on column journal_entries.resurface_weight is
  'Probability multiplier for the daily Resurfacing pick. 1.0 = normal, 0 = excluded, higher = more likely.';
comment on column notes.resurface_weight is
  'Probability multiplier for the daily Resurfacing pick. 1.0 = normal, 0 = excluded, higher = more likely.';
