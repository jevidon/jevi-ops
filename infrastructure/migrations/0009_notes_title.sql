-- Migration 0009: add notes.title (text, nullable)
--
-- Why: the original 0001 schema treated a note as just a body. Imported
-- Obsidian notes had real filenames ("Topo Chico Sparkling Water Lime
-- Juice Sea Salt Rim.md") that meant something, but the importer
-- discarded them. The detail page faked a title by slicing the first
-- 80 chars of body, which is fine for voice captures but lossy for
-- everything imported.
--
-- This adds an optional title field. Voice captures keep title null;
-- the UI falls back to a body preview in that case. Imported notes get
-- their original filename as title (importer change in a separate commit).
--
-- Idempotent — `if not exists` on the column + index.

alter table notes
  add column if not exists title text;

-- Searching/filtering by title is rare but possible later. GIN index would
-- be overkill for a column that's typically a few-word filename.
create index if not exists notes_title_idx on notes (title) where title is not null;

comment on column notes.title is
  'Optional title. Voice captures usually leave this null (UI falls back to body preview); imported notes set it from the filename.';

-- One-off backfill: a lot of imported Obsidian notes have bodies like
-- "FN - The Sovereignty Method\n\n<frontmatter-content>\nHow sovereignty…"
-- where the first line was the original H1 / filename. We can pick those
-- up cheaply by reading the first line if it's short-ish and the body
-- has more after it.
--
-- This intentionally skips notes whose first line is already the entire
-- body (no newline) — those are short voice captures and we don't want
-- to clobber body=title with title=body.
update notes
   set title = split_part(body, e'\n', 1)
 where title is null
   and position(e'\n' in body) > 0
   and length(split_part(body, e'\n', 1)) between 3 and 120;
