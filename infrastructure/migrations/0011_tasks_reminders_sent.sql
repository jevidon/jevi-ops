-- Migration 0011: track which task reminders have already been sent.
--
-- The /api/cron/reminders endpoint runs every minute and queries open
-- tasks with a due_time + reminder_offsets. To avoid sending the same
-- "15 min before" reminder repeatedly, we record the dispatch timestamp
-- per offset on the task row.
--
-- Storage shape:
--   reminders_sent = { "5": "2026-05-22T18:55:00Z", "15": "2026-05-22T18:45:00Z" }
-- where the key is the offset in minutes (matches an entry in
-- reminder_offsets) and the value is when we dispatched that reminder.

alter table tasks
  add column if not exists reminders_sent jsonb not null default '{}'::jsonb;

comment on column tasks.reminders_sent is
  'Map of offset-minutes -> ISO timestamp of when we dispatched that reminder. Prevents duplicate sends from the per-minute cron.';
