-- Add a per-project color so tasks and calendar items can be visually
-- associated with their project. Hex string ('#7A9A77'); nullable means
-- "neutral / use the default ink color".

alter table projects add column if not exists color text;

comment on column projects.color is 'Hex color (e.g. ''#7A9A77''). Nullable. UI uses a curated 8-color palette.';
