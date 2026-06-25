-- Migration 0030: quotes gain 'video' source_type + source_url column.
--
-- Real capture failed: a YouTube quote from a Jordan Peterson video.
-- The parser wanted to classify it as source_type='video' (which is what
-- it is), but the CHECK constraint didn't list 'video'. And there was
-- nowhere to keep the URL anyway — the existing source_reference column
-- holds the show/episode title, not the link.
--
-- Adding both: 'video' to the type set, plus a dedicated source_url
-- column so the title and link don't have to fight over the same
-- source_reference field. The /library/quotes detail page can then
-- render the title as a hyperlink when source_url is present.

-- ─── 1. 'video' joins the source_type CHECK ───────────────────────────
-- Drop + recreate; the constraint was already extended for 'sermon' in
-- migration 0029 so we keep that list and append 'video'.

alter table quotes drop constraint if exists quotes_source_type_check;
alter table quotes add constraint quotes_source_type_check check (
  source_type in ('book', 'article', 'podcast', 'sermon', 'video', 'conversation', 'other')
);

-- ─── 2. source_url column ─────────────────────────────────────────────

alter table quotes
  add column if not exists source_url text;

comment on column quotes.source_url is
  'Optional URL for the source (e.g. YouTube video link, podcast episode page, article URL). Used by the /library/quotes detail page to render source_reference as a hyperlink when present.';
