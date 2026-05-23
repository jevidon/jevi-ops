-- Migration 0010: link tasks to content_items.
--
-- Why: a task like "Film the iPad Pro review" or "Make a thumbnail" lives
-- conceptually under a content_item (the actual video), not a project.
-- Projects are initiatives; content items are individual deliverables.
-- Letting tasks be linked to either gives the right shape.
--
-- A task can still be standalone or linked to a project — content_item is
-- an additional optional link. In practice a task linked to a content_item
-- often has no project (the channel domain is enough context).
--
-- Idempotent — `if not exists` on the column + index.

alter table tasks
  add column if not exists content_item_id uuid references content_items(id) on delete set null;

create index if not exists tasks_content_item_id_idx on tasks (content_item_id)
  where content_item_id is not null;

comment on column tasks.content_item_id is
  'Optional FK to content_items. A video like "iPad Pro Review" can have child tasks (film, edit, thumbnail) linked here.';
