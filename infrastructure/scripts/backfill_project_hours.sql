-- One-off: recompute every project's hours_logged from its activity_log
-- entries. Use this after a code change that updates how hours flow into
-- projects.hours_logged (e.g. fixing the bug where the executor's RPC
-- fallback never ran). Safe to re-run any time.

update projects p
set hours_logged = coalesce((
  select sum(hours_logged)
  from activity_log
  where activity_log.project_id = p.id
    and activity_log.hours_logged is not null
), 0);

-- Sanity check: show the projects with their new totals.
select p.id, p.name, p.hours_logged,
       (select count(*) from activity_log where project_id = p.id) as activity_entries
from projects p
order by p.hours_logged desc;
