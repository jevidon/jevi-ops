# Developing jevi-ops

[← Project overview](../README.md)

jevi-ops is a pnpm monorepo with a Next.js web app, a Fastify API, shared TypeScript schemas and a native SwiftUI companion. The web and iOS clients use the same self-hosted API and PostgreSQL database.

## Prerequisites

- Node.js 20.10 or newer and a compatible pnpm version. The repository's `packageManager` field pins pnpm; its chosen version may require a newer Node.js release than the application's minimum.
- Docker with Compose for the local PostgreSQL database.
- `psql` for the initial schema and seed import.
- For native development, follow the separate [iOS setup guide](../apps/ios/README.md).

## First run

Run these commands from the repository root. The schema and seed steps are for a **fresh database**; use the migration instructions below for an existing installation.

```bash
pnpm install
cp .env.example .env
ln -sf ../../.env apps/web/.env.local
```

Set `AUTH_SECRET` in `.env` to a generated secret (`openssl rand -hex 32`). The API and web app must use the same value. Keep the example's local `DATABASE_URL` for the database below. Leave `CRON_ENABLED=false` during development.

```bash
# PostgreSQL 17 with pgvector, listening on port 54329.
docker compose -f infrastructure/docker/compose.dev.yml up -d

# After PostgreSQL is ready, initialize a fresh database.
psql postgresql://jevi:jevi@localhost:54329/jeviops -f infrastructure/schema-selfhost.sql
psql postgresql://jevi:jevi@localhost:54329/jeviops -f infrastructure/seed.sql

# The bootstrap schema already includes the current migrations.
scripts/db-migrate.sh --baseline

# Create your login; the command prompts for a password.
pnpm --filter @jevi-ops/api exec tsx scripts/create-user.ts --email you@example.com

# Start both development servers in the background.
scripts/devctl.sh start
```

Open [localhost:3000](http://localhost:3000) and sign in. The API listens on port 3001; `/healthz` reports configuration health and `/readyz` checks database connectivity.

Configure language-model and transcription endpoints in **Settings → AI**, or use the `LLM_*` and `STT_*` values in [`.env.example`](../.env.example). See the [integration guide](../infrastructure/DEPENDENCIES.md) for service setup. Configure self-hosted endpoints explicitly when you want local processing; transcription and model fallbacks differ by capture path.

## Everyday commands

```bash
scripts/devctl.sh status
scripts/devctl.sh logs api 60
scripts/devctl.sh restart api
scripts/devctl.sh stop

pnpm typecheck
pnpm build
pnpm test
```

The controller runs the API without watch mode, so restart it after API changes. The web server hot-reloads. Logs and process IDs live in `.dev-run/`.

Web development uses `apps/web/.next-dev`; production builds use `apps/web/.next`. After a server restart or deployment, reload any open tab that reports an outdated action before retrying a change.

The API integration tests require PostgreSQL and create disposable `jeviops_test` and `jeviops_upgrade` databases on the configured server. Run them against a local development database. The web tests use jsdom. See [the agent guide](../CLAUDE.md) for the detailed test workflow.

## Database changes

For an existing database, inspect and apply pending migrations:

```bash
scripts/db-migrate.sh --status
scripts/db-migrate.sh
```

The migration script reads the configured database URL and prints its target before applying changes. `--baseline` only marks migrations as applied; it does not verify or repair a schema. Use it after a fresh bootstrap, not as a substitute for upgrading an existing database.

Keep schema changes in sync across all three locations:

1. A numbered SQL file in `infrastructure/migrations/`.
2. The fresh-install schema in `infrastructure/schema-selfhost.sql`.
3. The Drizzle definitions in `apps/api/src/db/schema.ts`.

## Repository layout

```text
apps/
  api/                    Fastify API, Drizzle, integration tests
  web/                    Next.js App Router web app and PWA
  ios/                    Native SwiftUI companion
packages/shared/          Zod schemas, TypeScript types and capture fixtures
workers/hermes-capture/   Hermes desktop text-capture plugin
scriptable/               Phone widget scripts
scripts/                  Development, migration and verification helpers
infrastructure/
  docker/                 Compose stacks and Dockerfiles
  migrations/             Incremental SQL migrations
  schema-selfhost.sql     Fresh-install PostgreSQL schema
  seed.sql                Initial application data
docs/                     Product plans and implementation notes
```

## Architecture

- **Storage:** Drizzle over postgres.js, with PostgreSQL as the shared record. Custom parsers return numerics as JSON numbers and timestamps as ISO strings. The database image includes pgvector; that alone does not enable semantic search.
- **Authentication:** one `AUTH_SECRET` signs API sessions and verifies them in web middleware. Devices and agents use revocable `ops_` tokens; capture-only tokens restrict a client to capture operations.
- **AI configuration:** the LLM and STT adapters read dashboard settings first, then environment fallbacks. OpenAI-compatible services support self-hosted inference; Anthropic is an optional provider. Durable capture additionally restricts inference to approved local origins.
- **Capture:** the durable capture API stores an original before interpretation and returns a storage receipt. The legacy `/api/ingest` and `/api/ingest/capture` endpoints remain available to secret-gated external surfaces. See the [shared capture fixtures](../packages/shared/fixtures/durable-capture/README.md) and [Hermes plugin](../workers/hermes-capture/README.md).
- **Scheduling:** `CRON_ENABLED=true` enables the in-process scheduler for reminders, calendar sync, observations, overdue checks and daily summaries. Manual `/api/cron/*` triggers remain available.
- **Files and services:** image attachments live in a local volume served through `/uploads/*`; durable capture media has a separate private directory. Tailscale provides private access. LLM, STT and Immich services run outside the Compose stack; Pushover and Google Calendar are optional outbound integrations.

The design favors easy capture and selective display. Environment variables hold secrets and bootstrap settings; the dashboard holds editable integration configuration. Proposed autonomous behavior should retain an action log and an explicit undo path where the effect can be reversed.

## Hosting and migration

See [Docker deployment](../infrastructure/docker/README.md) for TrueNAS SCALE or another Docker host, [external dependencies](../infrastructure/DEPENDENCIES.md) for integration setup, and the [Supabase migration runbook](../infrastructure/MIGRATION.md) for moving an existing installation.

Compared with the hosted original, jevi-ops replaces Supabase with PostgreSQL, Drizzle and first-party JWT authentication; CDN storage with local uploads; and hosted application processes with Docker Compose. The language-model and transcription providers are configurable.
