-- Task statuses retain their canonical category for all existing consumers.
alter table projects add column if not exists task_workflow jsonb;
alter table projects add column if not exists workflow_revision integer not null default 0;
alter table stewardship_domains add column if not exists task_workflow jsonb;
alter table stewardship_domains add column if not exists workflow_revision integer not null default 0;
alter table tasks add column if not exists workflow_status_id text;
create table if not exists task_workflow_presets (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  definition jsonb not null,
  created_at timestamptz not null default now()
);

-- Legacy clients and direct writers (voice, maintenance) still write status.
-- New, moved and reopened tasks select the first status in their category.
-- Explicit custom selections must agree with the canonical category.
create or replace function normalize_task_workflow_status() returns trigger language plpgsql as $$
declare
  workflow jsonb;
  selected jsonb;
  reset_selection boolean := false;
begin
  if new.project_id is not null then
    select task_workflow into workflow from projects where id = new.project_id;
  else
    select task_workflow into workflow from stewardship_domains where id = new.domain_id;
  end if;
  if TG_OP = 'UPDATE' then
    reset_selection := new.project_id is distinct from old.project_id
      or new.domain_id is distinct from old.domain_id
      or (new.status is distinct from old.status and new.workflow_status_id is not distinct from old.workflow_status_id);
  end if;
  if workflow is null then
    new.workflow_status_id := null;
  else
    if reset_selection then new.workflow_status_id := null; end if;
    if new.workflow_status_id is null then
      select value into selected from jsonb_array_elements(workflow->'statuses') where value->>'category' = new.status limit 1;
      new.workflow_status_id := selected->>'id';
    else
      select value into selected from jsonb_array_elements(workflow->'statuses') where value->>'id' = new.workflow_status_id;
      if selected is null or selected->>'category' <> new.status then
        raise exception 'Workflow changed. Refresh and choose a status again.' using errcode = '23514', constraint = 'tasks_workflow_status_valid';
      end if;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists tasks_workflow_status on tasks;
create trigger tasks_workflow_status before insert or update on tasks
for each row execute function normalize_task_workflow_status();
