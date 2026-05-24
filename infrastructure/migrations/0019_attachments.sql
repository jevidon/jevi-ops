-- Migration 0019: image attachments on notes + journal_entries.
--
-- One jsonb column per parent table holding an array of attachment
-- records. Files live on Bunny Storage; the URL points at the Bunny
-- Pull Zone CDN (public-but-unguessable thanks to UUID filenames).
--
-- Shape of each attachment record:
--   {
--     "url":           "https://<host>.b-cdn.net/journal/abc-123.jpg",
--     "storage_path":  "journal/abc-123.jpg",   -- for deletion
--     "content_type":  "image/jpeg",
--     "size_bytes":    245678,
--     "alt":           null | string,
--     "uploaded_at":   "2025-..."
--   }
--
-- We use jsonb (not a separate table) because attachments are always
-- loaded with their parent, mutations are array-level, and we don't
-- need to query across attachments. If that changes, the migration to
-- a real table is straightforward — but we'd add a meaningful query
-- path then, not pre-emptively.

alter table notes
  add column if not exists attachments jsonb not null default '[]'::jsonb;

alter table journal_entries
  add column if not exists attachments jsonb not null default '[]'::jsonb;

-- GIN indexes so we *could* query "notes that have any attachment" or
-- "attachments with this storage_path" without a full table scan. Tiny
-- write cost; nice to have.
create index if not exists notes_attachments_gin
  on notes using gin (attachments);
create index if not exists journal_entries_attachments_gin
  on journal_entries using gin (attachments);

comment on column notes.attachments is
  'Array of {url, storage_path, content_type, size_bytes, alt?, uploaded_at} objects pointing at Bunny CDN files.';
comment on column journal_entries.attachments is
  'Same shape as notes.attachments. Files live on Bunny Storage under journal/.';
