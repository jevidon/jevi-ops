-- Migration 0022: app-wide settings (single-row pattern).
--
-- Single user → single row of settings. We use a boolean primary key
-- pinned to TRUE with a CHECK constraint so a second row can't be
-- inserted by accident. Read everywhere via SELECT * FROM app_settings
-- WHERE id = TRUE.
--
-- For now this just holds the user-configurable timezone (was
-- hardcoded as 'America/Denver' in ~40 places). Future settings —
-- preferred date format, default reminder lead-time, etc. — would
-- be columns added here.

create table if not exists app_settings (
  id          boolean primary key default true,
  timezone    text not null default 'America/Denver',
  updated_at  timestamptz not null default now(),
  constraint app_settings_singleton check (id)
);

-- Seed the singleton if it doesn't exist yet. Safe to re-run.
insert into app_settings (id, timezone)
values (true, 'America/Denver')
on conflict (id) do nothing;

-- Reuse the set_updated_at trigger if present.
do $$
begin
  if not exists (
    select 1 from pg_trigger where tgname = 'app_settings_set_updated_at'
  ) then
    create trigger app_settings_set_updated_at
      before update on app_settings
      for each row execute function set_updated_at();
  end if;
end $$;

-- RLS — authenticated users can read/write. Single-user app so this
-- mirrors every other user-owned table.
alter table app_settings enable row level security;
drop policy if exists app_settings_authenticated_all on app_settings;
create policy app_settings_authenticated_all on app_settings
  for all to authenticated using (true) with check (true);

comment on table app_settings is
  'Single-row app-wide configuration. Use SELECT * FROM app_settings WHERE id = TRUE.';
comment on column app_settings.timezone is
  'IANA timezone string (e.g. America/Denver). Used for day-boundary math and display formatting across the app.';
