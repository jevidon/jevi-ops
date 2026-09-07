-- Migration 0050: the markdown overview document, its revisions, and ideas.
--
-- A `description` is a blurb; a `doc_md` is the living overview — specs,
-- links, decisions, a parts list, the story so far — on an asset, a
-- project, and a domain. Two things make it safe to keep in a text box:
--
--   * doc_version + optimistic concurrency. A save carries the version it
--     was written against; the API refuses (409 doc_conflict, returning the
--     current body) when someone else saved in between. The agent and the
--     person can both write; neither can silently overwrite the other.
--   * doc_revisions. Every saved version keeps its body, so an edit is
--     never a loss. (entity_type, entity_id, version) is the identity.
--
-- Ideas: a project may now be status 'idea' — a candidate grouped under an
-- asset (or a domain) that is not yet work. Ideas stay off the Work board
-- (it lists active + paused) and off attention; promoting one is a status
-- change, so its notes, document, and attachments come along untouched.

alter table assets add column if not exists doc_md text;
alter table assets add column if not exists doc_version integer not null default 1;
alter table projects add column if not exists doc_md text;
alter table projects add column if not exists doc_version integer not null default 1;
alter table stewardship_domains add column if not exists doc_md text;
alter table stewardship_domains add column if not exists doc_version integer not null default 1;

comment on column assets.doc_md is 'Markdown overview (GFM). Saved with doc_version for optimistic concurrency; history in doc_revisions.';
comment on column projects.doc_md is 'Markdown overview (GFM). Saved with doc_version for optimistic concurrency; history in doc_revisions.';
comment on column stewardship_domains.doc_md is 'Markdown overview (GFM). Saved with doc_version for optimistic concurrency; history in doc_revisions.';

alter table projects drop constraint if exists projects_status_check;
alter table projects add constraint projects_status_check
  check (status in ('idea','active','paused','done','archived'));

create table if not exists doc_revisions (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('asset','project','domain')),
  entity_id uuid not null,
  version integer not null,
  body text,
  actor text,
  created_at timestamptz not null default now(),
  constraint doc_revisions_entity_version_unique unique (entity_type, entity_id, version)
);

create index if not exists idx_doc_revisions_entity
  on doc_revisions(entity_type, entity_id, version desc);

comment on table doc_revisions is
  'Every saved version of an entity''s doc_md (asset/project/domain), newest = the current doc_version. No FK — the body outlives a deleted row only until the next sweep.';
