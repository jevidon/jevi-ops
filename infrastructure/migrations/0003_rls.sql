-- Row-Level Security — single-user system.
--
-- Policy model:
--   * Enable RLS on every user-data table.
--   * One policy per table: "authenticated user can do anything".
--   * Service role bypasses RLS automatically and is used by cron jobs,
--     /api/ingest, and autonomous-action workers.
--
-- When a future multi-user variant ever happens, add a user_id column to
-- each table and tighten the policy to (auth.uid() = user_id). For now the
-- system is single-user and the policy below is correct.

do $$
declare
  t text;
  user_tables text[] := array[
    'stewardship_domains',
    'people',
    'person_facts',
    'person_interactions',
    'projects',
    'milestones',
    'activity_log',
    'tasks',
    'calendar_events',
    'checklist_templates',
    'checklist_instances',
    'content_items',
    'content_templates',
    'journal_books',
    'journal_entries',
    'notes',
    'books',
    'quotes',
    'inventory_categories',
    'inventory_items',
    'notifications',
    'observations',
    'action_log',
    'email_rules',
    'resurfacing_seen',
    'captured_data'
  ];
begin
  foreach t in array user_tables loop
    execute format('alter table %I enable row level security', t);
    -- Drop any prior policy with this name so the migration is idempotent.
    execute format('drop policy if exists %I_authenticated_all on %I', t, t);
    execute format(
      $p$create policy %I_authenticated_all on %I
         for all
         to authenticated
         using (true)
         with check (true)$p$,
      t, t
    );
  end loop;
end $$;

-- Sanity check: which tables now have RLS enabled? (Result visible in the
-- SQL editor; no-op at runtime.)
-- select tablename, rowsecurity
--   from pg_tables
--   where schemaname = 'public'
--   order by tablename;
