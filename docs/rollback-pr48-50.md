# Rolling back PRs #48–#50 (codex/onboarding-*) on a machine

Instructions for the agent operating a jevi-ops checkout. Every command
below returns within seconds; none needs `&` or a long timeout. Run them
from the repo root. Stop and report at any **STOP** line.

## Why

PRs #48, #49 and #50 (`codex/onboarding-safe-settings`,
`codex/onboarding-manual-setup`, `codex/onboarding-vehicle-management`)
were never merged and are being abandoned. Their code never reached
`main`, so no source rollback is needed. But any database that was
migrated while one of those branches — or `feat/durable-capture-gate-a`,
which was stacked on top of them — was checked out still carries their
migrations `0053_safe_settings.sql` … `0059_vehicle_monitoring.sql`:

- 24 tables (`installation_setup`, `onboarding_*`, `source_*`,
  `responsibility_rule*`, `vehicle_assessment*`, `knowledge_*`,
  `research_*`, `monitoring_*`), expected to be empty;
- extra columns `app_settings.revision`, `app_settings.credential_settings`,
  `app_settings.capability_tests`, `maintenance_logs.historical_only`,
  `api_tokens.worker_id` (with a foreign key into `research_workers`);
- a three-way `api_tokens_permission_profile_check` constraint that the
  real branch defines as two-way;
- tracking rows in `schema_migrations` for those seven files, plus
  `0060_durable_capture.sql`, which is the capture migration under the old
  numbering. The real branch ships it as `0053_durable_capture.sql`, so
  `db-migrate --status` reports it PENDING even though its tables exist.

`scripts/rollback-codex-onboarding.sh` detects all of this and removes it
in one transaction. It only ever drops objects that the codex migrations
created; the columns the real branch owns (`api_tokens.permission_profile`,
`api_tokens.scopes`, `app_settings.server_epoch`, `app_settings.data_space_id`,
the `capture_*` tables) are left alone.

## Preconditions

- The dev Postgres is up (`docker compose -f infrastructure/docker/compose.dev.yml up -d`
  if this machine uses the docker dev DB).
- `DATABASE_URL` in the repo-root `.env` points at the database the API
  uses. The script prints its target on the first line — read it.

## Step 1 — get the script

```bash
git status --short
```

**STOP** if that prints any modified tracked files (lines starting with
` M`, `M `, `D`, etc.). Report the output; do not stash or discard anything.
Untracked files (`??`) are fine.

```bash
git fetch origin
git checkout feat/durable-capture
git pull --ff-only
ls scripts/rollback-codex-onboarding.sh
```

**STOP** if the file is missing: the branch on origin does not have it yet.

## Step 2 — inspect (read-only)

```bash
scripts/rollback-codex-onboarding.sh
```

The last lines tell you which case you are in:

- `RESULT: nothing from PRs #48–#50 found in this database. Nothing to do.`
  → the database is already clean. Skip to Step 6.
- `RESULT: leftovers found; all codex tables are empty and no blockers. Safe to roll back.`
  → continue with Step 3.
- `RESULT: leftovers found, but BLOCKERS above mean data would be lost.`
  → **STOP.** Copy the full output into your report. Do **not** re-run
  with `--force`; that decision is the owner's.

Also **STOP** if the script says `cannot connect to the target database`.

## Step 3 — dry run

```bash
scripts/rollback-codex-onboarding.sh --dry-run
```

Runs the whole rollback inside a transaction and then rolls it back.
Expected tail:

```
remaining codex tables: 0
remaining codex columns: 0
remaining tracking rows: 0
── dry run finished; nothing was changed. Counts above must all be 0.
```

**STOP** if any count is not 0 or the command exits non-zero. Report the
output.

## Step 4 — apply

```bash
scripts/rollback-codex-onboarding.sh --apply
```

Same three counts, all 0, followed by `── committed.` and a NEXT STEPS block.

## Step 5 — re-apply the capture migration and verify

```bash
scripts/db-migrate.sh
scripts/db-migrate.sh --status
scripts/rollback-codex-onboarding.sh
```

Expected:

- `db-migrate` prints `applying  0053_durable_capture.sql` and
  `1 migration(s) applied.` (that file is idempotent; it recreates nothing
  that exists and installs the correct `api_tokens` constraint).
- `--status` shows every file as `applied`, none `PENDING`.
- The inspect run now ends with `Nothing to do.`

**STOP** and report if any of those differ.

## Step 6 — restart the API if it is running

```bash
scripts/devctl.sh status
scripts/devctl.sh restart api      # only if status showed the api running
curl -s http://127.0.0.1:3001/healthz
```

## Step 7 — non-database leftovers on this machine

Report what you find for each; only act where the line says to.

1. Local branches. Delete only the ones that exist:

   ```bash
   git branch --list 'codex/*' 'feat/durable-capture-gate-a'
   git branch -D codex/onboarding-safe-settings codex/onboarding-manual-setup codex/onboarding-vehicle-management feat/durable-capture-gate-a 2>/dev/null; true
   ```

   Do not delete the remote branches; the PRs are closed separately.

2. `.env` keys the codex branch introduced. Print, then remove those
   lines only (keep everything else as-is):

   ```bash
   grep -nE '^(SETTINGS_ENCRYPTION_KEYS|SETTINGS_ENCRYPTION_ACTIVE_KEY|PRIVATE_SOURCES_DIR|PRIVATE_SOURCES_DIR_HOST)=' .env
   ```

   If `PRIVATE_SOURCES_DIR` pointed at a directory, report the path and
   whether it contains files. Do not delete the directory.

3. The codex Hermes research worker, if it was ever bootstrapped
   (`workers/hermes/scripts/bootstrap.sh --directory <somewhere>`):

   ```bash
   pgrep -fl 'adapter/worker.py'
   ls workers/
   ```

   If a worker process is running, stop it with `kill <pid>` and report
   the installation directory from its command line. Do not delete that
   directory. `workers/` on the current branch should contain only
   `hermes-capture`.

## Do not

- Use `--force`.
- Drop or recreate the database, or run the fresh-bootstrap recipe.
- Run anything against `jeviops_test` or `jeviops_upgrade`; the test
  suite rebuilds those itself.
- Check out any `codex/*` branch or run its migrations.
- Delete directories outside the repo.

## Report back

Paste:

1. The `target:` line and the full output of the Step 2 inspect.
2. The three `remaining …: 0` lines from `--apply`.
3. The `db-migrate` output and the `--status` tail.
4. The final inspect's `RESULT:` line.
5. Step 7 findings (branches deleted, `.env` lines removed, worker state).
6. Any **STOP** you hit, with the output that triggered it.
