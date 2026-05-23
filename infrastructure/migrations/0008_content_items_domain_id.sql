-- Migration 0008: content_items.channel (enum) → content_items.domain_id (FK).
--
-- Why: the original 0001 schema hardcoded six channel slugs in a CHECK
-- constraint. With migration 0007 each YouTube channel became its own
-- flexible domain row, and the user can now create new domains via UI.
-- Hardcoded enums no longer match reality.
--
-- Map (after 0007 renames):
--   'jeradwp'   → "Tech With Jerad"          (was JeradWP → renamed)
--   'hillmedia' → "Hill Media Group"
--   'fieldnotes'→ "Field Notes"
--   'sitenitro' → "Site Nitro"
--   'personal'  → "Life"                      (was Personal → renamed)
--   'other'     → null  (orphan; user can reassign later)
--
-- Safe to run after 0007. Idempotent — re-runs no-op via `if not exists` /
-- conditional updates.
--
-- Requires migration 0007 to have run first (depends on renamed domains).

-- ─── 1. Add the new column (nullable for backfill) ───────────────────────
alter table content_items
  add column if not exists domain_id uuid references stewardship_domains(id) on delete set null;

create index if not exists idx_content_items_domain_id on content_items(domain_id);

-- ─── 2. Backfill domain_id from existing channel enum values ─────────────
-- Skip rows that already have domain_id set (idempotent re-run).
update content_items ci
   set domain_id = d.id
  from stewardship_domains d
 where ci.domain_id is null
   and (
     (ci.channel = 'jeradwp'    and d.name = 'Tech With Jerad') or
     (ci.channel = 'hillmedia'  and d.name = 'Hill Media Group') or
     (ci.channel = 'fieldnotes' and d.name = 'Field Notes') or
     (ci.channel = 'sitenitro'  and d.name = 'Site Nitro') or
     (ci.channel = 'personal'   and d.name = 'Life')
   );

-- ─── 3. Drop the channel column ──────────────────────────────────────────
-- The CHECK constraint is dropped automatically with the column.
alter table content_items
  drop column if exists channel;
