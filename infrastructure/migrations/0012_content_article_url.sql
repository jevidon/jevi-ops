-- Migration 0012: add content_items.article_url
--
-- Why: a YouTube video often has a companion blog post or article. The
-- existing video_url is reserved for the primary deliverable. Adding a
-- second URL lets us track both without overloading meaning. Could later
-- generalize to a JSONB urls map, but two columns is simpler for now.

alter table content_items
  add column if not exists article_url text;

comment on column content_items.article_url is
  'Companion article URL (blog post, Substack, Medium, etc.) associated with the video/podcast/etc.';
