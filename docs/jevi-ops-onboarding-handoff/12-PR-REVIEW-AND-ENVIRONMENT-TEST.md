# PR review and environment test

The previous PR stack through #46 is merged into `main` at `1fc307c51469984495629498973aa9a42eed9e46`. That commit's files match the original `afc8aab` implementation base. This implementation is published as three cumulative branches so each review shows its own changes.

| Order | Branch | PR base | Scope | New migrations |
|---|---|---|---|---|
| 1 | `codex/onboarding-safe-settings` | `main` | Encrypted managed credentials, revisioned settings, capability checks and settings UI | 0053 |
| 2 | `codex/onboarding-manual-setup` | `codex/onboarding-safe-settings` | Core/vehicle onboarding, private evidence and historical imports, responsibility knowledge and local future activation | 0054–0057 |
| 3 | `codex/onboarding-vehicle-management` | `codex/onboarding-manual-setup` | Scoped research, owner proposals, Hermes package, monitoring and final integration | 0058–0059 |

**Test the full application from `codex/onboarding-vehicle-management`.** It includes all three PRs; there is no need to merge them into `main` just to test. Review and merge in table order. Retarget each dependent PR after its predecessor merges; if the merge strategy rewrites commit IDs, rebase that dependent branch before merging it.

## Prepare the application on the test host

In the test environment's repository checkout:

```sh
git fetch origin
git switch codex/onboarding-vehicle-management
git pull --ff-only origin codex/onboarding-vehicle-management
git rev-parse HEAD
```

Retain the printed commit with the test results. Use the host's existing deployment configuration. Back up the test database, private source files and relevant credentials before upgrading. API and web must be deployed together: settings responses are redacted and settings mutations now require an expected revision.

Apply pending migrations through **0059**. For an existing database, do not run the full bootstrap/seed or baseline pending migrations. The fresh-install system-only seed does not remove existing domains. Existing owners opt into setup through Settings or `/onboarding`.

If credentials were stored in Settings, provision the versioned encryption keyring and follow [credential migration](../SETTINGS-CREDENTIALS.md). After migration 0053, legacy plaintext keys are quarantined until explicitly migrated. Environment-managed provider credentials remain supported. Configure private storage outside public photo uploads and include it in backups.

### Source installation

Install locked dependencies with `pnpm install --frozen-lockfile`. Stop the old API/web through the host's service manager during database and credential migration. Configure the test database in the repository `.env` or pass it explicitly to the migration runner. Check the host/database printed by the status command before applying:

```sh
scripts/db-migrate.sh --status
scripts/db-migrate.sh
```

```sh
pnpm --filter @jevi-ops/api exec tsx scripts/settings-credentials.ts status
# Run migrate only when the status reports legacy managed credentials:
pnpm --filter @jevi-ops/api exec tsx scripts/settings-credentials.ts migrate
```

Set `PRIVATE_SOURCES_DIR` when testing file retention. Enable `CRON_ENABLED` on only the scheduling API instance if testing local future activation or monitoring.

Build and restart both apps with the host's normal service/deployment process. On a development host using the repository controller, stop it before a normal `pnpm build`, then restart it. Run `scripts/setup-preflight.sh` with the same database/environment and inspect Settings readiness and the displayed commit.

### Docker Compose installation

Production Compose keeps Postgres private and supplies the API's `DATABASE_URL` inside its container. Run migrations inside the existing Postgres service and credential/preflight commands inside the new API image; the host needs Docker Compose and this checkout, not host Postgres or pnpm access.

Use the existing test stack's Compose project and protected environment values from the [Docker runbook](../../infrastructure/docker/README.md). The commands below run from `infrastructure/docker`, with its configured `.env`. If your deployment uses a different env file or project name, use those same Compose options consistently for every command; do not start another stack pointing at the existing data directory. Add the settings keyring to that configuration when migrating managed credentials. The updated Compose file supplies a separate private-source volume, or `PRIVATE_SOURCES_DIR_HOST` can select the existing private dataset.

```sh
cd infrastructure/docker
docker compose build api web
docker compose stop api web

# Copy the existing tracked migration runner and this branch's SQL files
# into a unique temporary directory in the already running Postgres service.
migration_dir="$(docker compose exec -T postgres mktemp -d /tmp/jevi-migrations.XXXXXX)"
docker compose exec -T postgres mkdir -p "$migration_dir/scripts" "$migration_dir/infrastructure"
docker compose cp ../../scripts/db-migrate.sh "postgres:$migration_dir/scripts/db-migrate.sh"
docker compose cp ../migrations "postgres:$migration_dir/infrastructure/migrations"

# The container's configured database/user are used over its local socket.
# No database password is printed or placed in a host-side command argument.
docker compose exec -T postgres sh -c 'PGUSER="$POSTGRES_USER" DATABASE_URL="postgresql:///$POSTGRES_DB" bash "$1/scripts/db-migrate.sh" --status' -- "$migration_dir"
```

Review the printed database target and migration list. If tracking is absent or earlier applied migrations appear pending, reconcile the actual schema before applying; do not blindly baseline it. Once the target and pending list are correct:

```sh
docker compose exec -T postgres sh -c 'PGUSER="$POSTGRES_USER" DATABASE_URL="postgresql:///$POSTGRES_DB" bash "$1/scripts/db-migrate.sh"' -- "$migration_dir"

# Use the new API image and the configured container environment.
docker compose run --rm --no-deps api ./node_modules/.bin/tsx scripts/settings-credentials.ts status
# Run migrate only if the status reports legacy managed credentials:
docker compose run --rm --no-deps api ./node_modules/.bin/tsx scripts/settings-credentials.ts migrate

docker compose up -d api web
docker compose exec -T api ./node_modules/.bin/tsx scripts/setup-preflight.ts
```

The normal migration runner keeps each SQL migration and its tracking insert in one transaction. The temporary directory is disposable. Inspect Settings readiness and the displayed commit after the new API and web are healthy.

## Use the host where Hermes is available

The delivered adapter uses the runtime pinned in [workers/hermes/runtime.json](../../workers/hermes/runtime.json). It creates its own Jevi research installation and profile. An existing personal Hermes installation can remain alongside it; this package does not attach itself to an arbitrary running Hermes process or replace that process's instructions, skills or credentials.

Run the following worker commands from the **repository root** of the same PR checkout on that host. If you followed the Docker commands above in this shell, first return to the root with `cd ../..`. Choose a new private directory and follow the [worker runbook](../../workers/hermes/README.md):

```sh
workers/hermes/scripts/bootstrap.sh --directory /absolute/private/jevi-hermes-review
```

In Jevi, sign in as the owner and open **Settings → Research worker setup and health** (`/settings/research`). Register a worker, create its scoped credential, and put it in the new installation's `.env` as `JEVI_WORKER_TOKEN`. Configure a separate `HERMES_MODEL_KEY` in that file and the matching API URL, model endpoint and model in `worker.toml`.

The model must support OpenAI-compatible chat completions with tool calling. Native Anthropic configuration is not supported by this adapter. HTTPS is required outside loopback for both model and Jevi API access. The adapter does not automatically import configuration or credentials from an existing Hermes profile.

Verify the actual runtime without calling a model:

```sh
workers/hermes/scripts/health.sh --check-runtime --config /absolute/private/jevi-hermes-review/worker.toml
```

Expected output includes runtime `0.21.1`, only `jevi_fetch`, instructions loaded, and `model_called: false`. For the first real request, use a disposable vehicle, leave monitoring disabled, and follow the bounded [live acceptance case](11-LIVE-WORKER-ACCEPTANCE.md). Replace its local fixture IDs with IDs from this test environment. Queue the owner request before running:

```sh
workers/hermes/scripts/smoke.sh --config /absolute/private/jevi-hermes-review/worker.toml
```

This claims at most one request. Exit 0 confirms delivery of a substantive result; the owner still needs to inspect sources, preview the proposed change and approve it. The acceptance case covers a stale refusal followed by a fresh reviewed application and receipt. No real-model result or live approval was produced during local implementation; the owner previously waived that local test and now has this procedure for their Hermes host.

## Review and test outcomes

- Manual setup: defer/resume core and vehicle setup; save a vehicle with only known identity facts. Research being unavailable must not prevent normal operation.
- Existing installation: retained domains and records remain; setup does not reseed or reset them.
- Evidence/history: retain a source, review a historical candidate, then accept it. A historical import must not replace the current odometer or reschedule today's work.
- Responsibility knowledge: inspect sources, applicability and concrete tracking effects before approval. Unknown applicability remains explicit. Test a synthetic future transition with the API scheduler running.
- Research: verify restricted worker health, real sources and excerpts, owner preview/approval, the application receipt, and refusal after relevant state changes.
- Optional monitoring: after a successful sourced worker run, deliberately enable a policy for a disposable vehicle and inspect successful-check timestamps, failure state and pause behavior. Registration or an offline health check alone does not establish research success.

Record the application commit, runtime/adapter version, job/result/proposal IDs and application receipts with any issue. Exclude tokens and private source contents from PR comments. Revoke temporary worker credentials and disable temporary policies after testing. The [implementation report](10-IMPLEMENTATION-STATUS.md) distinguishes local checks from this environment test.
