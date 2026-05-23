-- Migration 0018: retainer projects + recurring checklist items + activity log kinds.
--
-- One migration covering three small additions because they're a single
-- coherent feature ("retainer support") even though the columns live on
-- three tables.
--
-- 1. projects.engagement_type — distinguish open-ended retainer work
--    from bounded one-shot projects. Hides milestones, swaps the hours
--    header to show monthly usage, surfaces in its own list section.
--
-- 2. project_checklist_items.recurrence_rule — let a checklist item
--    auto-reset on a period boundary (daily/weekly/monthly/etc) so
--    "weekly Acme status report" can live as a checklist instead of
--    spawning a new task row every week. "Currently done" is derived
--    from done_at + rule on read; no cron needed for the reset.
--
-- 3. activity_log.kind — distinguish work entries (you put in time)
--    from update entries (client got first sale, site ranked #1,
--    deadline moved). Lets retainer activity feeds carry both kinds
--    of signal without confusion.

alter table projects
  add column if not exists engagement_type text
    check (engagement_type in ('project', 'retainer'))
    default 'project' not null;

-- Reuses the existing recurrence pattern (same shape tasks use). Null
-- means one-shot, same behavior as today.
alter table project_checklist_items
  add column if not exists recurrence_rule text
    check (recurrence_rule in ('daily', 'weekdays', 'weekly', 'biweekly', 'monthly', 'yearly'));

alter table activity_log
  add column if not exists kind text
    check (kind in ('work', 'update'))
    default 'work' not null;

-- Index supports the monthly-hours rollup for retainer headers:
-- "sum hours_logged for project X where logged_at >= start_of_month".
create index if not exists activity_log_project_logged_idx
  on activity_log (project_id, logged_at desc);

comment on column projects.engagement_type is
  'project = bounded engagement (has milestones, target date). retainer = ongoing recurring engagement (no milestones, monthly hours rollup).';
comment on column project_checklist_items.recurrence_rule is
  'When set, "currently done" is computed from done_at vs the start of the current period. No cron — derived on read.';
comment on column activity_log.kind is
  'work = effort + hours. update = client win / status note / event (no hours expected).';
