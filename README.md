# jevi-ops

Self-hosted personal operations dashboard — voice-first capture, six-tab
PWA, one pane of glass. A sovereign fork of jerad-ops: the whole stack runs
on your own hardware behind Tailscale, with a personally hosted LLM doing
the thinking.

**The Brain layer of the Sovereign Second Brain**: single source of truth on
the NAS, frictionless capture from any surface (PWA, watch, widget, agents),
local AI processing, nothing surrendered to hosted platforms.

## Stack

```
jevi-ops/
├── apps/
│   ├── api/              Fastify + TypeScript (tsx runtime) + Drizzle ORM
│   └── web/              Next.js 15 PWA (App Router, standalone build)
├── packages/
│   └── shared/           Zod schemas + TS types shared api ↔ web
└── infrastructure/
    ├── schema-selfhost.sql   Portable Postgres DDL (43 tables)
    ├── seed.sql              Fresh-install seeds
    ├── DEPENDENCIES.md       External systems setup (Tailscale, LLM, STT, Immich)
    ├── MIGRATION.md          Supabase → NAS cutover runbook
    └── docker/               Compose stack + Dockerfiles + deploy README
```

What replaced what, relative to the hosted original:

| Hosted (jerad-ops) | Self-hosted (jevi-ops) |
|---|---|
| Supabase Postgres + PostgREST | Plain Postgres (pgvector image) + Drizzle ORM |
| Supabase Auth (GoTrue) | Password + self-issued JWT (jose); named `ops_` API tokens for agents/devices |
| Anthropic API (parser, chat) | Any OpenAI-compatible server (llama.cpp/MLX/Ollama/vLLM) — Anthropic stays as a config-switch fallback |
| OpenAI Whisper | Any OpenAI-compatible STT server (speaches / whisper.cpp) |
| Bunny CDN images | Local volume served by the API (`/uploads/*`) |
| XCloud hosting + HTTP cron | Docker Compose on TrueNAS SCALE + in-process croner scheduler |
| Public domains | Tailscale-only (`tailscale serve`, ts.net certs) |

Pushover (notifications) and Google Calendar sync are unchanged — outbound
integrations that work fine from a NAS.

## Quick start (development)

Prereqs: Node ≥ 20.10, pnpm ≥ 9, Docker.

```bash
pnpm install
cp .env.example .env                 # fill in AUTH_SECRET at minimum
ln -sf ../../.env apps/web/.env.local

# Dev database (Postgres 17 + pgvector on :54329)
docker compose -f infrastructure/docker/compose.dev.yml up -d
psql postgresql://jevi:jevi@localhost:54329/jeviops -f infrastructure/schema-selfhost.sql
psql postgresql://jevi:jevi@localhost:54329/jeviops -f infrastructure/seed.sql

# Your user
pnpm --filter @jevi-ops/api exec tsx scripts/create-user.ts --email you@example.com

# Two terminals
pnpm dev:api    # :3001
pnpm dev:web    # :3000
```

Open <http://localhost:3000> → sign in → `/today`. Point the LLM at your
server in **Settings → AI** (or via `LLM_BASE_URL`/`LLM_MODEL` in `.env`).

## Deploying to the NAS

See [`infrastructure/docker/README.md`](infrastructure/docker/README.md)
(install via TrueNAS "Custom App → Install via YAML", datasets, first-run) and
[`infrastructure/DEPENDENCIES.md`](infrastructure/DEPENDENCIES.md) (the
external systems: Tailscale serve, LLM server, STT server, Immich, Google
OAuth, Pushover).

Migrating data off a hosted Supabase deployment:
[`infrastructure/MIGRATION.md`](infrastructure/MIGRATION.md).

## Architecture notes

- **Data layer** — Drizzle over postgres.js; `apps/api/src/db/schema.ts` is
  generated-then-owned (schema changes go into `schema-selfhost.sql` *and*
  `schema.ts`). Custom driver parsers keep the wire format the web app was
  built against: numerics as JSON numbers, timestamps as ISO-`T` strings.
- **Auth** — one `AUTH_SECRET` signs sessions on the API and verifies them
  in the web middleware (edge-safe jose, no per-request network hop).
  Agents get their own revocable `ops_` tokens (Settings → API tokens);
  tokens can't mint tokens.
- **LLM/STT** — `apps/api/src/lib/llm.ts` + `stt.ts` expose neutral
  interfaces; config resolves the `app_settings` row (dashboard-editable,
  applies without restart) → env fallback. `LLM_PROVIDER=anthropic` is a
  pure config change.
- **Cron** — `CRON_ENABLED=true` starts the in-process croner scheduler
  (reminders / calendar-sync / observations / overdue / daily-summary in the
  app timezone). The `/api/cron/*` endpoints remain for manual triggers.
- **Capture contract** — `POST /api/ingest` (+ `/api/ingest/capture`) is the
  stable, secret-gated intake for external surfaces: watch shortcuts, HTTP
  Shortcuts, future edge-capture hardware, agents. Capture is liberal;
  display is conservative.
- **Semantic search readiness** — the Postgres image ships pgvector;
  embeddings are a `CREATE EXTENSION vector` + a column away, no re-platform.

## Conventions

- **All capture is liberal, all display is conservative** — `/api/ingest`
  accepts anything; only ~7 things earn home-screen real estate.
- **Every autonomous action is logged + reversible** — `action_log` +
  notifications with `undo_payload`.
- **Stages over completeness** — schema includes tables not yet used; data
  flows in before the UI exists.
- **Two config tiers** — secrets/bootstrap in env; integration endpoints
  (LLM, STT, Immich) in the dashboard with env as fallback.
