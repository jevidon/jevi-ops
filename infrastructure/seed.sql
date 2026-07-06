-- ─────────────────────────────────────────────────────────────────────────
-- jevi-ops — seed data (fresh installs / dev only)
-- ─────────────────────────────────────────────────────────────────────────
--
-- Run AFTER schema-selfhost.sql on a brand-new database:
--   psql "$DATABASE_URL" -f seed.sql
--
-- Do NOT run when migrating an existing deployment — the restored data
-- dump already contains these rows (see MIGRATION.md).
--
-- ─────────────────────────────────────────────────────────────────────────

-- Nine user-facing stewardship domains — final state after 0002 + 0007.
-- The failure_patterns JSON must match what the observations cron parses.
insert into stewardship_domains (name, description, fruit_definition, failure_patterns, expected_cadence) values
  ('Hill Media Group',
    'Client work — billable engagements, deliverables, communication.',
    'On-time client delivery, hours-within-quote, no missed comms.',
    '[
      {"rule":"deadline_within_days","value":7,"untouched_days":3},
      {"rule":"hours_exceed_quote","value":1.0}
    ]'::jsonb,
    'daily-touch on active client projects'),

  ('Site Nitro',
    'WordPress plugin development — Reviews, Locations, and other plugins.',
    'Active plugin development cadence, releases shipping.',
    '[
      {"rule":"no_activity_days","value":14,"scope":"active_plugin"}
    ]'::jsonb,
    'weekly activity on each active plugin'),

  ('Tech With Jerad',
    'YouTube channel — tech tutorials, reviews, and creator workflow content.',
    'Aligned content shipping at planned cadence.',
    '[
      {"rule":"days_since_publish","value":10},
      {"rule":"days_in_status","status":"editing","value":14}
    ]'::jsonb,
    'one publish every 7-10 days'),

  ('Field Notes',
    'Writing channel — weekly essays and field-note posts.',
    'Weekly post cadence.',
    '[
      {"rule":"days_since_publish","value":10}
    ]'::jsonb,
    'one post per week'),

  ('Photography',
    'Client and personal photography — shoots, deliveries, gear.',
    'Pre-shoot checklist complete on time; gallery delivered within commitment window.',
    '[
      {"rule":"shoot_within_days_checklist_incomplete","shoot_days":30,"checklist_pct":80}
    ]'::jsonb,
    'event-driven'),

  ('Life',
    'Journal cadence, follow-through on relationships, personal projects outside content/work.',
    'Consistent journal cadence; follow-through on what matters.',
    '[
      {"rule":"days_since_journal","value":7},
      {"rule":"person_fact_date_relevant_unsurfaced","days":30}
    ]'::jsonb,
    'weekly journal minimum'),

  ('Jerad Hill Photo',
    'YouTube channel — photography tutorials, gear reviews, behind-the-scenes shoots.',
    'Aligned content shipping at planned cadence.',
    '[{"rule":"days_since_publish","value":14},{"rule":"days_in_status","status":"editing","value":21}]'::jsonb,
    'one publish every 10-14 days'),

  ('Jerad WP',
    'YouTube channel — WordPress tutorials, plugin walkthroughs, site-building content.',
    'Aligned content shipping at planned cadence.',
    '[{"rule":"days_since_publish","value":10},{"rule":"days_in_status","status":"editing","value":14}]'::jsonb,
    'one publish every 7-10 days'),

  ('Jerad Hill (Personal)',
    'YouTube channel — personal vlogs, life updates, longer-form reflective content.',
    'Aligned content shipping at planned cadence.',
    '[{"rule":"days_since_publish","value":21},{"rule":"days_in_status","status":"editing","value":30}]'::jsonb,
    'one publish every 14-21 days')
on conflict (name) do nothing;

-- Inbox: system domain used when a task has no natural home
-- (added in migration 0026). UUID is hardcoded — packages/shared/src/
-- constants/domains.ts and several API paths reference it directly.
-- Do not change this UUID.
insert into stewardship_domains (id, name, description, fruit_definition, failure_patterns, expected_cadence, is_system)
values (
  'acf035ee-b247-4c96-a07e-5946bc2b2e91',
  'Inbox',
  'Unsorted tasks awaiting a real home',
  null,
  '[]'::jsonb,
  null,
  true
) on conflict (name) do nothing;

-- App settings singleton (from migration 0022).
insert into app_settings (id, timezone) values (true, 'America/Denver')
on conflict (id) do nothing;

-- Health history singleton (from migration 0024).
insert into health_history (id) values (true) on conflict (id) do nothing;
