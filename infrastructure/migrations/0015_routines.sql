-- Migration 0015: daily routines + completion log (streak tracker).
--
-- Routines are habits — distinct from tasks. They don't have due dates,
-- priorities, projects, or reminders. They reset every day automatically
-- because "done today?" is just "does a completion row exist for today?"
-- No cron, no scheduled job, no state to corrupt.
--
-- Streaks (current/longest/30-day rate) are computed in the API from
-- routine_completions on read — we don't cache them on the routine row
-- because the cache invalidation would be subtle (e.g. backfilling a
-- completion silently breaks a cached streak).

create table if not exists routines (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  description  text,
  position     integer not null default 0,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists routines_active_position_idx
  on routines (active, position) where active = true;

-- Auto-update updated_at on every row update. Same trigger pattern as
-- the other user-owned tables.
do $$
begin
  if not exists (
    select 1 from pg_trigger where tgname = 'routines_set_updated_at'
  ) then
    create trigger routines_set_updated_at
      before update on routines
      for each row execute function set_updated_at();
  end if;
end $$;

-- One row per routine per day. UNIQUE on (routine_id, completed_date)
-- makes "check it off" idempotent: a duplicate insert is a no-op rather
-- than an error, which simplifies the toggle endpoint.
create table if not exists routine_completions (
  id               uuid primary key default gen_random_uuid(),
  routine_id       uuid not null references routines(id) on delete cascade,
  completed_date   date not null,
  created_at       timestamptz not null default now(),
  unique (routine_id, completed_date)
);

create index if not exists routine_completions_routine_date_idx
  on routine_completions (routine_id, completed_date desc);

-- A separate by-date index helps the daily-summary query that asks
-- "how many of today's routines did I complete?"
create index if not exists routine_completions_date_idx
  on routine_completions (completed_date);

-- RLS — single-user system, same authenticated-only policy as other
-- user-owned tables.
alter table routines enable row level security;
drop policy if exists routines_authenticated_all on routines;
create policy routines_authenticated_all on routines
  for all to authenticated using (true) with check (true);

alter table routine_completions enable row level security;
drop policy if exists routine_completions_authenticated_all on routine_completions;
create policy routine_completions_authenticated_all on routine_completions
  for all to authenticated using (true) with check (true);

comment on table routines is
  'Daily habits (read Bible, take meds, etc). Distinct from tasks — no due date or priority. Streaks are computed from routine_completions.';
comment on table routine_completions is
  'Append-only log of which routines were completed which days. UNIQUE (routine_id, completed_date) makes toggle idempotent.';
