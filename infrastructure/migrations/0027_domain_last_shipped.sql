-- Migration 0027: stewardship_domains.last_shipped_at.
--
-- Lets the user "mark a publish" for domains whose work happens
-- outside the dashboard (Substack essays, external newsletters, social
-- video, etc.) without needing to log every piece of content as a
-- content_items row.
--
-- The cadence helper for days_since_publish takes the max of:
--   - latest content_items.published_at for that domain (if any)
--   - domain.last_shipped_at (if set)
-- so users who DO track content_items get the same automatic behavior
-- as before, and users who don't can just hit a button on the domain
-- detail page to record "I just shipped something."

alter table stewardship_domains
  add column if not exists last_shipped_at timestamptz;

comment on column stewardship_domains.last_shipped_at is
  'Manually-stamped "I shipped something for this domain" timestamp. The cadence helper uses MAX(this, latest content_items.published_at) for days_since_publish rules — covers both the auto-tracked content pipeline and external publishing surfaces (Substack, social, etc.).';
