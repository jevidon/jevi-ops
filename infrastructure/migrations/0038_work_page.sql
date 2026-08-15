-- Migration 0038: Work Page keystone. Ported from upstream jerad-ops 0042
-- (v2.0.0, Addendum 08), minus its name-matched domain seeding (upstream
-- parked three of its own YouTube channels here; parking is a per-domain
-- toggle in the UI, not a migration concern in this fork).
--
-- One computed manager's map over projects + domains + active content.
-- Four tables touched. Additive + idempotent.

-- 1) Tasks: the `waiting` state (blocked on someone else). waiting_since
--    drives the aging day-count; waiting_on is the free-text "who/what".
--    The status CHECK from 0001 is an inline column constraint (auto-named
--    tasks_status_check) — drop + re-add to extend it.
alter table tasks
  add column if not exists waiting_on text,
  add column if not exists waiting_since date;
alter table tasks drop constraint if exists tasks_status_check;
alter table tasks add constraint tasks_status_check
  check (status in ('open', 'waiting', 'done'));

-- 2) Projects: retainer cycle anchor (day-of-month). Cycle position = days
--    since the most recent anchor date; anchor clamps to month end for short
--    months. Only meaningful for engagement_type = 'retainer'. Null → the
--    card shows counts + recency without a cycle bar until the anchor is set.
alter table projects
  add column if not exists retainer_anchor_day int
    check (retainer_anchor_day between 1 and 31);

-- 3) Domains: `parked` (deliberately-paused channel) — distinct from
--    active = false, which hides a domain entirely. Parked domains render
--    muted + collapsed at the bottom of Work.
alter table stewardship_domains
  add column if not exists parked boolean not null default false;

-- 4) Content: holder (who the ball is with) + idea lifecycle.
--    holder_since anchors the "with editor N days" aging (replaces raw
--    editing-status age). archived_at / idea_reviewed_at feed the Ideas
--    count and idea-review rotation.
alter table content_items
  add column if not exists holder text not null default 'me'
    check (holder in ('me', 'editor')),
  add column if not exists holder_since timestamptz,
  add column if not exists archived_at timestamptz,
  add column if not exists idea_reviewed_at timestamptz;

comment on column tasks.waiting_since is
  'Date a task entered the waiting state; today − this = the aging day-count.';
comment on column projects.retainer_anchor_day is
  'Day-of-month the retainer cycle resets (1–31, clamps to month end). Null until set.';
comment on column stewardship_domains.parked is
  'Deliberately-paused channel — shown muted/collapsed on Work, distinct from active=false.';
comment on column content_items.holder is
  'Who the ball is with: me | editor. holder_since anchors the with-editor aging.';
