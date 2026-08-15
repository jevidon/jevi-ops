-- Migration 0039: Content Manager v2. Ported from upstream jerad-ops 0041
-- (v2.0.0, Addendum 07). Upgrades content_items from a status tracker to a
-- production manager: per-type fields, rich body storage, shorts platform
-- tracking, production/publish dates, and a new `course` type. Planning +
-- deployment only — never analytics.

alter table content_items
  -- Type-specific scalars (episode/module number, guest name, newsletter
  -- platform, companion post url). Promote to a real column only if a field
  -- later needs cross-type filtering.
  add column if not exists meta jsonb not null default '{}'::jsonb,
  -- Production date; label varies by type ("Filmed on" / "Written on" / …).
  add column if not exists produced_on date,
  add column if not exists target_publish_date date,
  -- The item's OWN published URL (article / podcast / newsletter). Distinct
  -- from the legacy article_url, which is a generic companion link on videos.
  add column if not exists canonical_url text,
  -- Distribution platforms for short clips. App-validated vocab:
  -- yt_shorts | ig_reels | fb_reels | tiktok | threads | x.
  add column if not exists platforms text[],
  -- Full rich body (newsletter body, show notes, YT description) — stored as
  -- sanitized HTML for archival portability + copy-out.
  add column if not exists body_rich text;

-- Extend the type CHECK to add 'course'. The original (migration 0001) is an
-- inline column check, auto-named content_items_type_check. It can't be
-- altered in place — drop and re-add.
alter table content_items drop constraint if exists content_items_type_check;
alter table content_items add constraint content_items_type_check
  check (type in
    ('video','article','short_clip','podcast_episode','newsletter','course'));

comment on column content_items.canonical_url is
  'The item''s own published URL (article/podcast/newsletter). Distinct from article_url (a generic companion link).';
comment on column content_items.platforms is
  'Short-clip distribution platforms. App-validated: yt_shorts|ig_reels|fb_reels|tiktok|threads|x.';
comment on column content_items.body_rich is
  'Sanitized rich HTML body (newsletter body, show notes, YT description). Full-body archival + copy-out.';
