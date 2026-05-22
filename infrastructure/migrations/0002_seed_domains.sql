-- Seed the six initial domains per spec section 5.
-- Failure patterns are encoded as JSON rules the observations cron evaluates.
-- Cadence strings are human-readable; the cron parses them by convention.

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

('JeradWP',
  'Content channel — videos, tutorials, course material for the JeradWP audience.',
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

('Personal',
  'Journal cadence, follow-through on relationships and personal projects.',
  'Consistent journal cadence; follow-through on what matters.',
  '[
    {"rule":"days_since_journal","value":7},
    {"rule":"person_fact_date_relevant_unsurfaced","days":30}
  ]'::jsonb,
  'weekly journal minimum');
