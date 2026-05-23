-- Migration 0016: time-of-day buckets + optional specific-time reminders
-- for routines.
--
-- Adds four columns to routines:
--   time_of_day       — soft bucket (morning/afternoon/evening/anytime).
--                       Drives the grouped display on /today and /routines.
--                       Default 'anytime' so existing rows fall into the
--                       catch-all section.
--   specific_time     — optional exact time-of-day (HH:MM:SS, no TZ —
--                       interpreted in America/Denver). If set, surfaces
--                       inline next to the routine name.
--   reminder_enabled  — when true AND specific_time is set, the per-minute
--                       reminders cron fires a Pushover at that time.
--   last_reminder_sent_date — dedup: don't fire twice in one day. Cleared
--                       implicitly by date change (no cron needed).
--
-- The reminder cron also checks "not already completed today" before
-- firing — no point reminding you to take meds if you already did.

alter table routines
  add column if not exists time_of_day text
    check (time_of_day in ('morning', 'afternoon', 'evening', 'anytime'))
    default 'anytime' not null,
  add column if not exists specific_time time,
  add column if not exists reminder_enabled boolean default false not null,
  add column if not exists last_reminder_sent_date date;

-- Index supports the per-minute cron query: "active routines with
-- reminder_enabled and a specific_time set, where we haven't fired today."
-- Partial index keeps it tiny.
create index if not exists routines_reminder_pending_idx
  on routines (specific_time)
  where active = true and reminder_enabled = true and specific_time is not null;

comment on column routines.time_of_day is
  'Soft bucket for grouped display. Use specific_time for an exact hour.';
comment on column routines.specific_time is
  'Optional exact time-of-day (HH:MM, America/Denver). Drives the reminder cron when reminder_enabled is true.';
comment on column routines.reminder_enabled is
  'When true AND specific_time set, the reminders cron fires a Pushover at that time daily.';
comment on column routines.last_reminder_sent_date is
  'Dedup for the reminders cron — set to today after a successful send. Cleared implicitly by date change.';
