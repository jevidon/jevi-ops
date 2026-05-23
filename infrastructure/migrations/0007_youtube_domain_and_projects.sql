-- Migration 0007: reorganize domains for YouTube channels and life/personal split.
--
-- Architecture change: each YouTube channel is its own stewardship domain
-- (not a project under a parent "YouTube" domain). Reason: each channel has
-- its own audience, cadence, and "doing well" definition — that's the domain
-- shape from the spec, not the project shape.
--
-- Also rename "Personal" → "Life" to free up "personal" for the YT channel
-- name without ambiguity.
--
-- After this migration:
--   Hill Media Group, Site Nitro, Field Notes, Photography     (unchanged)
--   Tech With Jerad        (was JeradWP — renamed in place to keep FK refs)
--   Life                   (was Personal — renamed)
--   Jerad Hill Photo       (new)
--   Jerad WP               (new — this is the channel, not the old domain)
--   Jerad Hill (Personal)  (new — personal YT channel)
--
-- Safe to re-run: uses `where name in (...)` matchers + `where not exists`
-- guards so a second run no-ops.

-- ─── 1. Rename JeradWP → Tech With Jerad ────────────────────────────────
-- Keep the same row (and therefore the same UUID) so any tasks / notes /
-- projects already attached to that domain keep their links.
update stewardship_domains
   set name = 'Tech With Jerad',
       description = 'YouTube channel — tech tutorials, reviews, and creator workflow content.',
       updated_at = now()
 where name in ('JeradWP', 'Jerad WP');

-- ─── 2. Rename Personal → Life ──────────────────────────────────────────
update stewardship_domains
   set name = 'Life',
       description = 'Journal cadence, follow-through on relationships, personal projects outside content/work.',
       updated_at = now()
 where name = 'Personal';

-- ─── 3. Add the three new YouTube channel domains ──────────────────────
-- Same failure-pattern shape as the original JeradWP seed (publishing
-- cadence + stuck-in-editing alarm). Tune individually via SQL or the
-- (future) domain detail UI.

insert into stewardship_domains (name, description, fruit_definition, failure_patterns, expected_cadence)
select v.name, v.description, v.fruit, v.failure_patterns::jsonb, v.cadence
  from (values
    (
      'Jerad Hill Photo',
      'YouTube channel — photography tutorials, gear reviews, behind-the-scenes shoots.',
      'Aligned content shipping at planned cadence.',
      '[{"rule":"days_since_publish","value":14},{"rule":"days_in_status","status":"editing","value":21}]',
      'one publish every 10-14 days'
    ),
    (
      'Jerad WP',
      'YouTube channel — WordPress tutorials, plugin walkthroughs, site-building content.',
      'Aligned content shipping at planned cadence.',
      '[{"rule":"days_since_publish","value":10},{"rule":"days_in_status","status":"editing","value":14}]',
      'one publish every 7-10 days'
    ),
    (
      'Jerad Hill (Personal)',
      'YouTube channel — personal vlogs, life updates, longer-form reflective content.',
      'Aligned content shipping at planned cadence.',
      '[{"rule":"days_since_publish","value":21},{"rule":"days_in_status","status":"editing","value":30}]',
      'one publish every 14-21 days'
    )
  ) as v(name, description, fruit, failure_patterns, cadence)
 where not exists (
   select 1 from stewardship_domains d where d.name = v.name
 );
