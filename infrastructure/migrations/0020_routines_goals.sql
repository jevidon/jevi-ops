-- Migration 0020: routine goals + completion archive.
--
-- Adds two columns to routines:
--
--   goal_days     int (nullable). NULL = ongoing routine (no end). Positive
--                 int = "target streak in days." Once current_streak >= goal,
--                 the routine auto-archives (active=false, archived_at=now).
--
--   archived_at   timestamptz (nullable). NULL = active or paused (the
--                 existing `active` flag still distinguishes those). Set
--                 when the routine is archived, either automatically on
--                 goal completion or manually. Combined with `active`:
--
--                   active=true,  archived_at=NULL  → live, shown on Today
--                   active=false, archived_at=NULL  → manually paused
--                   active=false, archived_at=SET   → completed (or archived)
--
-- Backfill: every existing row stays active=true, archived_at=NULL with no
-- goal — matches today's behavior exactly.

alter table routines add column if not exists goal_days integer;
alter table routines add column if not exists archived_at timestamptz;

-- Sanity: goal_days, when set, must be positive. A zero-day or negative
-- goal makes no sense and would auto-archive on first completion.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'routines_goal_days_positive'
  ) then
    alter table routines
      add constraint routines_goal_days_positive
      check (goal_days is null or goal_days > 0);
  end if;
end $$;

-- Index to make the "archived routines, newest first" list cheap.
create index if not exists routines_archived_at_idx
  on routines (archived_at desc) where archived_at is not null;

comment on column routines.goal_days is
  'Target streak in days. NULL = ongoing. When current streak hits goal_days the routine auto-archives.';
comment on column routines.archived_at is
  'Timestamp the routine was archived (manually or via goal completion). NULL = active or paused — see active flag.';
