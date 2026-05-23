-- Migration 0013: per-content checkable items.
--
-- Each content_item gets a list of step-by-step items it needs to go
-- through (e.g. for a video: outline, film, edit, thumbnail, publish).
-- These live in their own table — not as JSONB on content_items —
-- because we want them to be checkable, addressable individually, and
-- ordered.
--
-- Default items per content type get inserted alongside the
-- content_items row by the API. Users can also add/remove/check items.

create table if not exists content_checklist_items (
  id              uuid primary key default gen_random_uuid(),
  content_item_id uuid not null references content_items(id) on delete cascade,
  position        integer not null default 0,
  title           text not null,
  done            boolean not null default false,
  done_at         timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists content_checklist_items_content_idx
  on content_checklist_items (content_item_id, position);

-- Auto-update updated_at on every row update. Mirrors the existing
-- trigger pattern used elsewhere (quote_annotations).
do $$
begin
  if not exists (
    select 1 from pg_trigger where tgname = 'content_checklist_items_set_updated_at'
  ) then
    create trigger content_checklist_items_set_updated_at
      before update on content_checklist_items
      for each row execute function set_updated_at();
  end if;
end $$;

-- RLS — single-user system, same authenticated-only policy as other
-- user-owned tables.
alter table content_checklist_items enable row level security;
drop policy if exists content_checklist_items_authenticated_all on content_checklist_items;
create policy content_checklist_items_authenticated_all on content_checklist_items
  for all
  to authenticated
  using (true)
  with check (true);

comment on table content_checklist_items is
  'Per-content step-by-step checklist (outline, film, edit, etc.). Inserted by the API with default items when a content_item is created, editable thereafter.';
