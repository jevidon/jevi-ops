-- Migration 0014: per-project checkable items.
--
-- Mirrors content_checklist_items but linked to projects. The intent is
-- ad-hoc sub-steps within a project — granular TODOs that aren't worth a
-- full task row (no due date, no reminders, no project_id link), but
-- also aren't milestones (no weight, no rollup into project %).
--
-- Use it for things like: "ping client about scope", "draft contract",
-- "set up repo" — workflow chores you want to check off without
-- polluting the tasks queue or the milestone count.

create table if not exists project_checklist_items (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references projects(id) on delete cascade,
  position     integer not null default 0,
  title        text not null,
  done         boolean not null default false,
  done_at      timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists project_checklist_items_project_idx
  on project_checklist_items (project_id, position);

-- Auto-update updated_at on every row update. Same trigger pattern as
-- content_checklist_items, quote_annotations, etc.
do $$
begin
  if not exists (
    select 1 from pg_trigger where tgname = 'project_checklist_items_set_updated_at'
  ) then
    create trigger project_checklist_items_set_updated_at
      before update on project_checklist_items
      for each row execute function set_updated_at();
  end if;
end $$;

-- RLS — single-user system, same authenticated-only policy as other
-- user-owned tables.
alter table project_checklist_items enable row level security;
drop policy if exists project_checklist_items_authenticated_all on project_checklist_items;
create policy project_checklist_items_authenticated_all on project_checklist_items
  for all
  to authenticated
  using (true)
  with check (true);

comment on table project_checklist_items is
  'Per-project ad-hoc checklist (granular TODOs that are not worth a full task or a milestone). Editable inline from /projects/[id].';
