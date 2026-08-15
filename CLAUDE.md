# jevi-ops — agent guide

pnpm monorepo: `apps/api` (Fastify 5 + tsx + Drizzle over postgres.js), `apps/web`
(Next.js 15 App Router), `packages/shared` (Zod schemas). Single-user self-hosted
app; auth is first-party JWT (no Supabase anywhere).

## Dev servers — never run them in the foreground

`tsx src/server.ts` and `pnpm dev` block forever; a terminal-tool timeout will
kill them mid-session. Use the controller instead — it backgrounds internally
(nohup + PID files), so no command needs `&` and every call returns in seconds:

```bash
scripts/devctl.sh start          # api + web, waits until ports answer
scripts/devctl.sh status
scripts/devctl.sh logs api 60    # last 60 log lines
scripts/devctl.sh restart api    # REQUIRED after api code changes (tsx has no watch mode)
scripts/devctl.sh stop
```

API: `http://127.0.0.1:3001` (health: `/healthz`). Web: `http://127.0.0.1:3000`
(hot-reloads on its own). Logs and PID files live in `.dev-run/` (gitignored).
The API reads `.env` at the repo root on boot.

If `start` refuses because the port is held by a process devctl didn't start
(a stale server from a pre-devctl session), kill the PID it prints and re-run.
`status` flags the same condition.

## Database & migrations

`scripts/db-migrate.sh` targets, in order: `--url`, `$DATABASE_URL`,
`DATABASE_URL` from the repo-root `.env` (i.e. whatever the API itself uses),
then the docker dev default. It prints the target before acting — read that
line. It finds psql on PATH, in common install spots (Homebrew libpq,
Postgres.app), via `$PSQL_BIN`, or falls back to docker-exec inside the dev
container.

Dev DB (Docker, port 54329 to dodge system Postgres):

```bash
docker compose -f infrastructure/docker/compose.dev.yml up -d
```

Fresh bootstrap — `schema-selfhost.sql` always matches the branch's full
migration set, so after it, baseline instead of replaying:

```bash
psql postgresql://jevi:jevi@localhost:54329/jeviops -f infrastructure/schema-selfhost.sql
psql postgresql://jevi:jevi@localhost:54329/jeviops -f infrastructure/seed.sql
scripts/db-migrate.sh --baseline
```

Existing DB, after pulling a branch — just apply what's pending:

```bash
scripts/db-migrate.sh --status   # applied vs PENDING
scripts/db-migrate.sh            # apply pending (each in its own transaction, tracked)
```

If the DB predates the tracking table and you know it's current through some
number: `scripts/db-migrate.sh --baseline-through 0035`.

**Authoring schema changes — triple-sync rule**: every change lands in all
three of `infrastructure/migrations/NNNN_*.sql`, `infrastructure/schema-selfhost.sql`,
and `apps/api/src/db/schema.ts` (Drizzle). A PR touching one without the others
is wrong.

## Testing a PR locally — the whole recipe

```bash
git fetch origin && git checkout <branch> && pnpm install
scripts/db-migrate.sh
scripts/devctl.sh restart all
```

Create a login (idempotent — re-running rotates the password):

```bash
printf 'test-password-123456\ntest-password-123456\n' | \
  (cd apps/api && ./node_modules/.bin/tsx scripts/create-user.ts --email probe@test.local)
```

Auth for API probes — login returns `{token}` (NOT `access_token`):

```bash
TOKEN=$(curl -s http://127.0.0.1:3001/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"probe@test.local","password":"test-password-123456"}' | jq -r .token)
curl -s http://127.0.0.1:3001/api/work -H "authorization: Bearer $TOKEN" | jq .
```

Checks: `pnpm typecheck` and `pnpm build` from the repo root.

## Gotchas

- App timezone is a DB setting (default `America/Denver`), not the machine's.
  Date assertions ("today", "tomorrow") must use app-tz, or they fail on
  machines in other zones.
- One-shot test scripts using workspace deps must live *inside* `apps/api`
  (pnpm strict resolution breaks them elsewhere); use `.mts` for top-level await.
- After heavy git churn, a web dev-server `originalFactory.call` runtime error
  means a stale `.next` cache: `rm -rf apps/web/.next` and restart web.
- `scripts/start-api.sh` / `start-web.sh` are production (PM2) launchers —
  foreground by design. Don't use them for dev; use `devctl.sh`.
