-- Migration 0049: the asset as an area within a domain.
--
-- An asset (car, appliance, bike) is ASSIGNABLE to a domain — assets.domain_id
-- exists since 0047. Assignment is what promotes it: an assigned asset renders
-- as an "Assets" band in its domain page and on the Work board; an
-- unassigned one lives only under /maintenance/assets. No new link entity —
-- the asset IS the area, with its own page at /assets/:id.
--
-- Two columns make that page whole:
--   * projects.asset_id — improvement work grouped under the asset ("roof
--     rack for the Outback"). Nullable; ordinary projects are untouched.
--     on delete set null: deleting an asset never deletes its projects.
--   * assets.attachments — photos, in the StoredAttachment[] shape notes and
--     journal entries already use. attachments[0] is the hero. The column
--     ships here so the gallery UI lands code-only.

alter table projects
  add column if not exists asset_id uuid references assets(id) on delete set null;
create index if not exists idx_projects_asset
  on projects(asset_id) where asset_id is not null;

comment on column projects.asset_id is
  'Improvement work grouped under an asset (the asset is the area). Null for ordinary projects.';

alter table assets
  add column if not exists attachments jsonb not null default '[]'::jsonb;
create index if not exists idx_assets_attachments
  on assets using gin(attachments);

comment on column assets.attachments is
  'StoredAttachment[] (the notes/journal shape). attachments[0] is the hero photo.';
