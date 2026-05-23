-- Migration 0017: per-day dedup for routine "missed" Pushovers.
--
-- A separate column from last_reminder_sent_date because the two are
-- distinct events:
--   - last_reminder_sent_date: the "it's time" ping at specific_time
--   - last_missed_sent_date: the "you didn't do it" ping after the
--     window closed (specific_time + 60 min for exact-time routines,
--     or end of bucket for morning/afternoon/evening routines).

alter table routines
  add column if not exists last_missed_sent_date date;

comment on column routines.last_missed_sent_date is
  'Dedup for missed-routine Pushover. Set to today after a successful send. Cleared implicitly by date change.';
