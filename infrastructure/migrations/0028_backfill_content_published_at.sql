-- Migration 0028: backfill content_items.published_at on already-shipped rows.
--
-- The content PATCH endpoint historically didn't auto-stamp published_at
-- when status flipped to a shipped state, so rows like "I marked this
-- video published" sit with status='published' AND published_at=NULL.
-- The domain pulse board's days_since_publish rule reads `WHERE
-- published_at IS NOT NULL`, so those rows never count and their
-- domains stay stuck at "rule set · no data yet."
--
-- Backfill rule: for content_items in a shipped state with null
-- published_at, copy updated_at as the best-known timestamp. updated_at
-- approximates "when this last got touched" — for items the user
-- marked published a while ago that's effectively their publish date.
-- Imperfect but close enough to get the cadence engine working off
-- existing data without anyone having to re-save anything by hand.

update content_items
   set published_at = updated_at
 where status in ('published', 'derivatives_pending', 'done')
   and published_at is null;
