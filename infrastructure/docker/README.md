# jevi-ops — deploy on TrueNAS SCALE (or any Docker host)

One compose stack: Postgres (pgvector), the API, the web app, and a nightly
pg_dump sidecar. Ingress is the host's Tailscale (`tailscale serve`);
LLM / STT / Immich run outside the stack — see
[`../DEPENDENCIES.md`](../DEPENDENCIES.md).

## Install on TrueNAS SCALE

1. **Datasets** — create (or pick) paths for state, e.g. under
   `/mnt/tank/apps/jevi-ops/`:
   - `pgdata` (Postgres data)
   - `uploads` (image attachments)
   - `backups` (nightly dumps)

   Snapshot tasks on this subtree give you point-in-time recovery on top of
   the logical dumps.

2. **Env** — copy `.env.compose.example` to `.env` beside the compose file
   and fill it in: Postgres password, the four `openssl rand -hex 32`
   secrets, `AUTH_SECRET`, the two ts.net origins, and the dataset paths.

3. **App** — TrueNAS UI → *Apps → Discover Apps → ⋮ → Install via YAML* →
   paste `docker-compose.yml` (set the env values in the form, or keep the
   `.env` next to a checked-out repo and run `docker compose up -d` from a
   shell instead). Either way the compose builds the two images from this
   repo checkout.

4. **Tailscale serve** — wire ingress on the host
   ([DEPENDENCIES.md §1](../DEPENDENCIES.md#1-tailscale-ingress)):

   ```bash
   tailscale serve --bg --https=443  http://127.0.0.1:3000
   tailscale serve --bg --https=8443 http://127.0.0.1:3001
   ```

## First run

```bash
# 1. Schema + seeds (fresh install; migrations from Supabase: see ../MIGRATION.md)
docker compose exec -T postgres psql -U jevi -d jeviops < ../schema-selfhost.sql
docker compose exec -T postgres psql -U jevi -d jeviops < ../seed.sql

# 2. Create your user (interactive password prompt)
docker compose exec api ./node_modules/.bin/tsx scripts/create-user.ts --email you@example.com

# 3. Smoke it
API_URL=https://<nas>.<tailnet>.ts.net:8443 \
WEB_URL=https://<nas>.<tailnet>.ts.net \
CRON_SECRET=<your CRON_SECRET> node ../../scripts/smoke-prod.mjs
```

Then open `https://<nas>.<tailnet>.ts.net`, sign in, and finish setup in
**Settings → AI** (LLM base URL + model, STT base URL — each has a Test
button).

## Day-2

- **Update**: `git pull && docker compose build && docker compose up -d`.
- **Logs**: `docker compose logs -f api` (the scheduler logs its five jobs
  at boot when `CRON_ENABLED=true`).
- **Backups**: nightly dumps land in the backups dataset
  (7 daily / 4 weekly / 6 monthly retention). Restore =
  `pg_restore -d jeviops <dump>` into a fresh Postgres + re-run
  `create-user.ts` if needed.
- **Health**: `curl https://<api-origin>/healthz` →
  `database/auth/llm/stt` config flags; `/readyz` round-trips the DB.

## Local development (macOS)

```bash
docker compose -f compose.dev.yml up -d        # Postgres on :54329
psql postgresql://jevi:jevi@localhost:54329/jeviops -f ../schema-selfhost.sql
psql postgresql://jevi:jevi@localhost:54329/jeviops -f ../seed.sql
# repo root:
cp .env.example .env   # fill in AUTH_SECRET etc.
pnpm dev:api & pnpm dev:web
```

The full prod stack also runs locally for testing:
`docker compose --env-file <env> -f docker-compose.yml up -d` with loopback
URLs — that's exactly what the pre-cutover Mac verification does.
