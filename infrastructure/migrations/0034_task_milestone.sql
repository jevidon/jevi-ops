-- Migration 0034: Task ↔ milestone link.
-- Ported from upstream jerad-ops 0043 (v2.0.0, Addendum 08 drill-in).
-- Lets a task belong to one of its project's milestones so project detail can
-- group tasks "by milestone" (Discovery & IA / Design system / … / General).
--
-- Additive + idempotent. Nullable — most tasks stay unassigned ("General").
-- ON DELETE SET NULL: deleting a milestone parks its tasks back under General
-- rather than deleting them (a milestone is a grouping, not an owner).
--
-- Integrity note: the app guarantees a task's milestone belongs to the task's
-- project (form scopes the picker; API nulls a cross-project milestone). There
-- is no DB-level cross-table CHECK for that — Postgres can't express it in a
-- column constraint — so it's enforced in application code.

alter table tasks
  add column if not exists milestone_id uuid
    references milestones(id) on delete set null;

-- Grouping queries filter tasks by milestone within a project detail; a plain
-- index on the FK keeps that lookup cheap as task volume grows.
create index if not exists tasks_milestone_id_idx on tasks(milestone_id);
