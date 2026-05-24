# jerad-ops

Jerad's Personal Operations Dashboard. Voice-first capture, six-tab PWA, one pane of glass.

Spec source of truth: `~/Documents/Jerad Dashboard/personal-ops-dashboard-spec.md`. Mockups: open `~/Documents/Jerad Dashboard/index.html` via a local static server (it loads `screens/*.jsx`).

## Layout

```
jerad-ops/
├── apps/
│   ├── api/              Fastify + TypeScript backend
│   └── web/              Next.js 15 PWA (App Router)
├── packages/
│   └── shared/           Zod schemas + TS types shared by api ↔ web
└── infrastructure/
    └── migrations/       Hand-authored Postgres SQL migrations
```

## Prerequisites

- **Node** ≥ 20.10
- **pnpm** ≥ 9 (installed via the standalone script at `~/Library/pnpm/`)
- A **hosted Supabase project** (create one before going past `pnpm install`)
- An **Anthropic API key** (only needed before voice parsing is wired)
- **Google OAuth credentials** (only needed before calendar sync is wired)

## First-time setup

```bash
cd ~/Documents/jerad-ops
pnpm install
cp .env.example .env

# Web app reads env from apps/web/.env.local. Symlink so the monorepo .env
# is the single source of truth:
ln -sf ../../.env apps/web/.env.local
```

Then fill in `.env`:

### Create a Supabase project

1. Go to <https://supabase.com/dashboard>, create a new project. Region: closest to Mountain Time (us-west-1 or us-east-2). Save the database password — it's the only one you'll get.
2. From **Project Settings → API**, copy the **Project URL**, **anon key**, and **service_role key**. Paste into `.env`:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `NEXT_PUBLIC_SUPABASE_URL` (same as SUPABASE_URL)
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` (same as SUPABASE_ANON_KEY)
3. From **Project Settings → Database → Connection Pooling**, copy the **Transaction-mode** URI (port 6543). Paste into `DATABASE_URL`.

### Apply the schema

In the Supabase dashboard, open **SQL Editor → New query**. Paste the **contents** of each file (not the path) and click **Run**. Do them in order:

1. `infrastructure/migrations/0001_initial.sql`
2. `infrastructure/migrations/0002_seed_domains.sql`

Quickest path on macOS — copy each file to the clipboard, then paste into the editor:

```bash
cat infrastructure/migrations/0001_initial.sql | pbcopy
# paste into Supabase SQL Editor, Run
cat infrastructure/migrations/0002_seed_domains.sql | pbcopy
# paste into Supabase SQL Editor, Run
```

(A `pnpm db:push` Drizzle flow will replace this manual step once the Drizzle schema file is authored.)

### Create the dashboard user

In Supabase **Authentication → Users**, create your single user (your email + 1Password-generated 40+ char password). Enable TOTP later from the user settings.

## Dev

Two terminals:

```bash
# Terminal 1 — API on :3001
pnpm dev:api

# Terminal 2 — Web on :3000
pnpm dev:web
```

Open <http://localhost:3000>. Root redirects to `/today`.

Smoke-test the API:

```bash
curl http://localhost:3001/healthz
curl http://localhost:3001/readyz   # 503 until Supabase env is set
```

## Deploy (XCloud)

Both sites (`dashboard.jeradhill.com` and `api.dashboard.jeradhill.com`) deploy
via XCloud's git webhook → custom deploy command. Each site's "Deploy Script"
in XCloud is exactly:

```bash
# Web site
set -euo pipefail
bash scripts/deploy.sh web
```

```bash
# API site
set -euo pipefail
bash scripts/deploy.sh api
```

`scripts/deploy.sh` runs install + the right per-site build, then
`pm2 reload all --update-env`, then verifies the site responds via a
localhost curl. Fails loud on any error — no `|| true` traps that
silently green-light broken deploys. Triggering a deploy:

```bash
curl -X POST 'https://app.xcloud.host/api/git/<TOKEN>/deploy'
```

Verify the result with `pnpm smoke:prod` after ~60s.

If `scripts/deploy.sh` errors with `pm2 binary not found`, SSH into the box
and run `which pm2` — then add that directory to the `export PATH=…` line
near the top of the script.

## Cron jobs

Four secret-gated HTTP endpoints under `/api/cron/*` are designed to be hit by an
external scheduler (XCloud's HTTP cron in prod). All four accept GET (so a plain
URL pinger works) or POST, and authenticate via either an `X-Cron-Secret` header
or `?secret=` query param. All require `CRON_SECRET` in the API env; reminder /
summary / overdue also require Pushover env vars (they soft-skip otherwise).

| Endpoint                      | Recommended cadence            | What it does                                                          |
| ----------------------------- | ------------------------------ | --------------------------------------------------------------------- |
| `/api/cron/reminders`         | Every minute                   | Task + routine reminders, plus routine "missed" sweep                 |
| `/api/cron/observations`      | Hourly                         | Evaluates per-domain failure_patterns → writes to `observations` for "Slipping" |
| `/api/cron/overdue`           | Hourly, waking hours only      | One-shot Pushover for tasks past their due-time (dedup'd via `reminders_sent`) |
| `/api/cron/daily-summary`     | Once daily at 7am Mountain     | Single Pushover summarizing today's tasks/events/observations         |

XCloud cron URL examples (`api.dashboard.jeradhill.com` + the secret as a query
param, since XCloud's HTTP cron form doesn't currently let you set headers):

```
*/1 * * * *    https://api.dashboard.jeradhill.com/api/cron/reminders?secret=$CRON_SECRET
0 * * * *      https://api.dashboard.jeradhill.com/api/cron/observations?secret=$CRON_SECRET
0 13-3 * * *   https://api.dashboard.jeradhill.com/api/cron/overdue?secret=$CRON_SECRET
0 13 * * *     https://api.dashboard.jeradhill.com/api/cron/daily-summary?secret=$CRON_SECRET
```

(13 UTC = 7am Mountain during MST; 6am during MDT — close enough for a morning
ping. The overdue band `13-3` wraps midnight UTC to cover 7am–9pm Mountain.)

## Phase 1 build checklist

Tracked against spec §12. ✅ shipped · 🟡 in progress · ⬜ pending.

- ✅ Monorepo, env loader, design tokens, 6-tab shell, floating mic FAB
- ✅ Full Postgres schema (tasks, projects, domains, content, people, journal, quotes, books, inventory, notifications, observations, action_log, captured_data)
- ✅ Seeded the six functional domains
- ✅ Generic `POST /api/ingest` endpoint
- ✅ Task + project CRUD stubs (admin-key; RLS pending)
- ✅ Voice capture stub route (parser pending)
- ⬜ Supabase Auth wiring (web + api JWT middleware)
- ⬜ Drizzle schema mirror + `pnpm db:push`
- ⬜ Web → API client (typed fetch wrapper using `@jerad-ops/shared` Zod schemas)
- ⬜ Voice parser using Anthropic API (spec §14 prompt)
- ⬜ Two-way Google Calendar sync (read + write, Calendly-aware)
- ⬜ Notifications feed
- ⬜ Checklist templates + instances UI
- ⬜ Top-3-for-today setter
- ⬜ Nightly backup cron → Drive + NAS

## Next steps

1. Create the hosted Supabase project + paste creds into `.env`.
2. Run the two SQL migrations in the Supabase SQL editor.
3. `pnpm install && pnpm dev:api && pnpm dev:web` in two shells, confirm `/healthz` returns `supabase_configured: true` and `/today` renders.
4. Pick the next item from Phase 1 — recommend **Supabase Auth wiring** so subsequent routes are RLS-correct from the start.

## Conventions

- **All capture is liberal, all display is conservative** — `/api/ingest` accepts anything; only ~7 things earn home-screen real estate (spec §2).
- **Every autonomous action is logged + reversible** — write to `action_log` and emit a notification (`undo_payload` populated).
- **Stages over completeness** — schema includes tables not yet used; data flows in before the UI exists.
- **Single user, but RLS on** — use the anon key + JWT path everywhere except cron/ingest, which use service role.
