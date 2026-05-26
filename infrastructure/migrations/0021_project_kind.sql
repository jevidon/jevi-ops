-- Migration 0021: project vs area.
--
-- Adds a `kind` column to projects so a row can represent either a finite
-- effort with a defined outcome ('project': "ship video #47") or an
-- ongoing context with no end ('area': "Home", "Garage", "Health").
--
-- Areas reuse the existing projects table — same color picker, task
-- assignments, activity log, time tracking — but get different UI
-- treatment downstream:
--
--   - Hidden from "% complete" rollups (areas don't complete).
--   - Exempt from the "stalled" observation rule (no recent activity
--     on Home doesn't mean Home is slipping; it's just been quiet).
--   - Milestone + target_date UI hidden in the form (don't apply).
--
-- All existing rows default to kind='project' so behavior is identical
-- to before this migration for everything already in the table.

alter table projects
  add column if not exists kind text not null default 'project';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'projects_kind_check'
  ) then
    alter table projects
      add constraint projects_kind_check
      check (kind in ('project', 'area'));
  end if;
end $$;

-- Two-axis index: kind first (fewer distinct values, better for filtered
-- list queries), then status. The existing single-column status index
-- still serves the "all active projects" query just fine — this one is
-- specifically for "areas" or "projects of kind X with status Y".
create index if not exists projects_kind_status_idx
  on projects (kind, status);

comment on column projects.kind is
  'project: finite effort with a defined outcome. area: ongoing context (Home, Garage, Health) that holds tasks indefinitely. Areas are exempt from progress + stalled-observation rules.';
