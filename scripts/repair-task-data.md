# Task data repair runbook

For an agent running in the local environment (Agent Mini) with database
access via `DATABASE_URL` in the repo root `.env`. Two one-time repairs,
both artifacts of the July/August wiki imports, plus a prevention step.
Run each **preview query first**, sanity-check the counts, then apply.

Take a backup before writing anything:

```bash
pg_dump "$DATABASE_URL" -t tasks -f /tmp/tasks-backup-$(date +%Y%m%d).sql
```

---

## Repair 1 — Attach orphaned parent tasks to their children's project

**Symptom:** subtasks render flat in project task lists. **Cause:** the
restructure scripts set `parent_task_id` on children but left the parent
tasks (e.g. "Core Architecture", "Subagent Builds") without a
`project_id`, so the project page can't find the parent among the
project's own tasks. The web UI now tolerates this, but the data should
still be correct.

### Preview

```sql
-- Parents with no project whose children all live in exactly one project.
SELECT p.id, p.title, count(*) AS children,
       count(DISTINCT c.project_id) AS distinct_projects,
       min(c.project_id::text) AS target_project_id
FROM tasks p
JOIN tasks c ON c.parent_task_id = p.id
WHERE p.project_id IS NULL
  AND c.project_id IS NOT NULL
GROUP BY p.id, p.title
ORDER BY p.title;
```

Expect the imported group parents here. Any row with
`distinct_projects > 1` is ambiguous — **skip it and report it** rather
than guessing.

### Apply

```sql
-- Attach each unambiguous parent to its children's project, and keep
-- domain_id consistent with that project's domain (tasks.domain_id is
-- NOT NULL; fall back to the parent's current domain if the project
-- has none).
UPDATE tasks p
SET project_id = x.project_id,
    domain_id  = COALESCE(pr.domain_id, p.domain_id),
    updated_at = now()
FROM (
  SELECT c.parent_task_id AS pid,
         min(c.project_id::text)::uuid AS project_id
  FROM tasks c
  WHERE c.parent_task_id IS NOT NULL
    AND c.project_id IS NOT NULL
  GROUP BY c.parent_task_id
  HAVING count(DISTINCT c.project_id) = 1
) x
JOIN projects pr ON pr.id = x.project_id
WHERE p.id = x.pid
  AND p.project_id IS NULL;
```

### Verify

```sql
-- Should return zero rows.
SELECT p.id, p.title
FROM tasks p
JOIN tasks c ON c.parent_task_id = p.id
WHERE p.project_id IS NULL AND c.project_id IS NOT NULL
GROUP BY p.id, p.title
HAVING count(DISTINCT c.project_id) = 1;
```

Then open a project with imported groups in the web UI — every subtask
should sit inside a collapsible parent row, none flat at the root.

---

## Repair 2 — Null out the import-stamped due dates

**Symptom:** imported tasks show a due date/time they were never given
(observed as "due today at 12:30 PM"). **Cause:** the import scripts
stamped `due_date`/`due_time` on creation. The web UI renders stored
values faithfully; the fix is data-side.

### Preview

```sql
-- Find the stamped cluster. Expect a large group sharing one due_time
-- (observed: 12:30:00) from the import runs; genuine hand-set times
-- will be scattered.
SELECT due_date, due_time, source, count(*),
       min(created_at) AS first_created, max(created_at) AS last_created
FROM tasks
WHERE due_time IS NOT NULL
GROUP BY due_date, due_time, source
ORDER BY count(*) DESC;
```

Confirm the cluster's `due_time` value and its `created_at` window
before writing. **Do not** blanket-null every `12:30:00` — check the
window so a legitimately scheduled 12:30 task survives.

### Apply (adjust the two placeholders from the preview)

```sql
UPDATE tasks
SET due_date = NULL,
    due_time = NULL,
    updated_at = now()
WHERE due_time = '12:30:00'                    -- cluster time from preview
  AND created_at BETWEEN '<window-start>' AND '<window-end>'  -- import window from preview
  AND status = 'open';
```

(Leaving done tasks untouched is fine — they don't render due labels.)

### Verify

```sql
SELECT count(*) FROM tasks WHERE due_time = '12:30:00' AND status = 'open';
```

Should be zero (or only tasks you knowingly scheduled at 12:30). In the
web UI, imported tasks should show **no** due label; the Today view
should stop claiming everything is due today.

---

## Prevention — Fix the import scripts

The scripts in `scripts/` (`import-wiki-tasks.py`, `populate-*.py`,
`restructure-*.py`) are untracked and unreadable over the SMB share, so
this has to happen locally:

1. Find where they set `due_date`/`due_time` on task creation and remove
   it (or make it opt-in per task). Imported tasks should default to no
   due date.
2. When creating parent/child structures, set `project_id` on the
   **parent** as well as the children.
3. Pass `source: "import"` in the create payload — the API defaults
   omitted `source` to `"manual"`, which made imported tasks
   indistinguishable from hand-entered ones during this investigation.

---

## Report back

After both repairs, capture for the record:

- Rows updated by Repair 1, plus any ambiguous parents skipped.
- Rows updated by Repair 2 and the window used.
- Diffs made to the import scripts.
