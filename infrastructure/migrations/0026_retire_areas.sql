-- Migration 0026: retire Areas, consolidate into Domains.
--
-- Per Addendum 03. Replaces the dual-track model (domains for top-level
-- responsibility + `kind='area'` projects as ongoing-context tasks holders)
-- with a single direct task→domain link.
--
-- What this does:
--   1. Adds is_system column to stewardship_domains so we can mark Inbox
--      as protected from the UI's CRUD endpoints.
--   2. Inserts the Inbox system domain at a fixed UUID. Inbox is the
--      catch-all destination for tasks captured without explicit routing
--      — frictionless capture, clean data model.
--   3. Adds tasks.domain_id as a direct FK to stewardship_domains.
--   4. Backfills domain_id for every existing task. Tasks already under a
--      project inherit the project's domain. Tasks under the Home area
--      (whose project had a null domain_id) route to Inbox. The Hill Media
--      Group area-project's tasks land directly in the matching domain.
--   5. Nulls out project_id on tasks under the two kind='area' projects so
--      they become direct-domain tasks.
--   6. Sweeps any orphaned tasks (no domain after backfill) into Inbox.
--   7. Deletes the two kind='area' project rows.
--   8. Enforces NOT NULL on tasks.domain_id.
--
-- Why hardcode the Inbox UUID:
--   The addendum suggests gen_random_uuid() + post-migration capture, but
--   then code that uses INBOX_DOMAIN_ID can't ship in the same commit.
--   A pinned UUID lets the migration and the shared constant land together.
--   The value is a real v4 UUID, generated once and frozen here.
--
-- The kind='area' check constraint on projects stays in place. After this
-- migration no rows have kind='area' but the column itself remains as a
-- future hook. The observations engine's `.neq('kind', 'area')` becomes a
-- defensive no-op rather than active logic; left in place on purpose.

begin;

-- ─── 1. is_system column on stewardship_domains ────────────────────────
-- Default false so every existing domain row stays unmarked; only the
-- explicit Inbox insert below carries is_system=true.

alter table stewardship_domains
  add column if not exists is_system boolean not null default false;

comment on column stewardship_domains.is_system is
  'System domains (currently just Inbox) are protected from UI delete/rename/deactivate and excluded from slippage detection.';

-- ─── 2. Create the Inbox system domain ────────────────────────────────
-- Fixed UUID so application code can reference it as a constant without
-- a runtime lookup. ON CONFLICT DO NOTHING makes the migration idempotent
-- on re-run during dev (no harm if the row already exists).

insert into stewardship_domains (
  id, name, description, fruit_definition, failure_patterns,
  expected_cadence, active, is_system
) values (
  'acf035ee-b247-4c96-a07e-5946bc2b2e91',
  'Inbox',
  'Catch-all for tasks captured without explicit domain assignment. Triage to a real domain when you have a moment.',
  'Empty inbox — every captured task lives in a real context.',
  '[]'::jsonb,
  'triage as needed',
  true,
  true
)
on conflict (id) do nothing;

-- ─── 3. tasks.domain_id column (nullable initially for backfill) ──────

alter table tasks
  add column if not exists domain_id uuid references stewardship_domains(id);

-- ─── 4. Backfill: tasks under a project inherit the project's domain ─

update tasks
   set domain_id = projects.domain_id
  from projects
 where tasks.project_id = projects.id
   and tasks.domain_id is null
   and projects.domain_id is not null;

-- ─── 5. Backfill: Home area-project tasks → Inbox ─────────────────────
-- The Home area's project.domain_id is NULL, so step 4 didn't fill these.
-- Send them to Inbox where the user can triage later (Life is one likely
-- destination but the user explicitly wanted these flagged for triage).

update tasks
   set domain_id = 'acf035ee-b247-4c96-a07e-5946bc2b2e91'
 where project_id = '83f6db6f-b820-4373-84d6-7e4dd5baae4e'  -- Home area
   and domain_id is null;

-- ─── 6. Cut tasks loose from the two kind='area' projects ─────────────
-- Their domain_id is now set; project_id should clear so they're treated
-- as direct-domain tasks going forward. The area-projects themselves are
-- deleted in step 8.

update tasks
   set project_id = null
 where project_id in (
   '83f6db6f-b820-4373-84d6-7e4dd5baae4e',  -- Home
   '684d287a-77c5-440a-b1fc-07d2df280aa3'   -- Hill Media Group area
 );

-- ─── 7. Sweep any remaining domain-less tasks into Inbox ──────────────
-- Defensive: catches tasks that had no project AND no domain prior to
-- this migration (shouldn't exist in current data, but if any imports or
-- early manual rows skipped both, they land here rather than tripping
-- the NOT NULL constraint at the end).

update tasks
   set domain_id = 'acf035ee-b247-4c96-a07e-5946bc2b2e91'
 where domain_id is null;

-- ─── 8. Drop the two kind='area' project rows ─────────────────────────
-- Cascades: tasks.project_id is `on delete set null` so any stragglers
-- get cleared. milestones, activity_log, project_checklist_items cascade
-- delete — area-projects typically have none of those, but the
-- pre-flight check in the addendum's Section 5 surfaces any that exist
-- so the user has decided beforehand.

delete from projects
 where id in (
   '83f6db6f-b820-4373-84d6-7e4dd5baae4e',
   '684d287a-77c5-440a-b1fc-07d2df280aa3'
 );

-- ─── 9. Enforce NOT NULL on tasks.domain_id ───────────────────────────
-- Every existing row now has a domain. New rows are required to either
-- supply domain_id explicitly or pass through the API layer's Inbox
-- default — either way the column is always populated.

alter table tasks
  alter column domain_id set not null;

create index if not exists tasks_domain_idx on tasks (domain_id);

comment on column tasks.domain_id is
  'Direct task→domain link (Addendum 03). When project_id is also set, this must equal projects.domain_id — enforced at the app layer.';

commit;

-- ─── Post-migration verification (run manually after COMMIT) ──────────
--
-- select count(*) from tasks where domain_id is null;
--   -- expected: 0
--
-- select count(*) from projects where kind = 'area';
--   -- expected: 0
--
-- select count(*) from tasks
--  where domain_id = 'acf035ee-b247-4c96-a07e-5946bc2b2e91';
--   -- expected: count of Home area tasks + any other orphans swept
--
-- select count(*) from tasks
--  where domain_id = '4b9a829f-708b-4100-a62f-d7ea00e1c264';
--   -- expected: Hill Media Group domain task count (including the
--   -- migrated HMG area-project tasks)
