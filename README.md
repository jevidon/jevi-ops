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
set -e
mkdir -p "$HOME/.local/bin"
corepack enable --install-directory "$HOME/.local/bin"
export PATH="$HOME/.local/bin:$PATH"
pnpm install --frozen-lockfile
ln -sf ../../.env apps/web/.env.local
pnpm build:web
```

```bash
# API site
set -e
mkdir -p "$HOME/.local/bin"
corepack enable --install-directory "$HOME/.local/bin"
export PATH="$HOME/.local/bin:$PATH"
pnpm install --frozen-lockfile
pnpm build:api
```

**Note:** PM2 restart is intentionally NOT part of the deploy command.
XCloud auto-registers Node sites with `bash -c pnpm start:web` as the PM2
start command, and pnpm isn't on PATH in the spawn context PM2 uses when
restarting workers, so every automated reload errored out and silently
left the old process running. After much debugging this turned out to be
a foot-gun we can't disarm from inside the deploy hook (XCloud re-creates
the broken registration each time we delete it). The workable answer is:

**After every deploy, manually restart PM2 from XCloud's site UI** (the
"Restart application" button, or `pm2 restart <name>` from the in-browser
terminal). The web process is registered as `web` after manual re-setup
(see below); api is `nodejs-api.dashboard.jeradhill.com`.

Triggering a deploy:

```bash
curl -X POST 'https://app.xcloud.host/api/git/<TOKEN>/deploy'
```

Verify the result with `pnpm smoke:prod` after the deploy + manual PM2
restart.

### One-time PM2 fix for the web site

If you're setting this up fresh or repeating this fix after a host
migration: XCloud's auto-registered web process uses `bash -c pnpm start:web`
which is broken (see above). Re-register it once:

```bash
# Via the web site's in-browser terminal:
cd /var/www/dashboard.jeradhill.com
pm2 delete nodejs-dashboard.jeradhill.com   # the broken auto-registered one
pm2 start scripts/start-web.sh --name web   # uses ./node_modules/.bin/next directly, no pnpm dependency
pm2 save
```

The api side already auto-registers correctly (its start command doesn't
involve pnpm), so no parallel fix is needed there.

## Cron jobs

Four secret-gated HTTP endpoints under `/api/cron/*` are designed to be hit by an
external scheduler (XCloud's HTTP cron in prod). All four accept GET (so a plain
URL pinger works) or POST, and authenticate via either an `X-Cron-Secret` header
or `?secret=` query param. All require `CRON_SECRET` in the API env; reminder /
summary / overdue also require Pushover env vars (they soft-skip otherwise).

| Endpoint                      | Recommended cadence            | What it does                                                          |
| ----------------------------- | ------------------------------ | --------------------------------------------------------------------- |
| `/api/cron/reminders`         | Every minute                   | Task + routine reminders, plus routine "missed" sweep                 |
| `/api/cron/calendar-sync`     | Every 15 minutes               | Pulls Google Calendar events into local DB + pushes orphan events back |
| `/api/cron/observations`      | Hourly                         | Evaluates per-domain failure_patterns → writes to `observations` for "Slipping" |
| `/api/cron/overdue`           | Hourly, waking hours only      | One-shot Pushover for tasks past their due-time (dedup'd via `reminders_sent`) |
| `/api/cron/daily-summary`     | Once daily at 7am Mountain     | Single Pushover summarizing today's tasks/events/observations         |

XCloud cron URL examples (`api.dashboard.jeradhill.com` + the secret as a query
param, since XCloud's HTTP cron form doesn't currently let you set headers):

```
*/1 * * * *    https://api.dashboard.jeradhill.com/api/cron/reminders?secret=$CRON_SECRET
*/15 * * * *   https://api.dashboard.jeradhill.com/api/cron/calendar-sync?secret=$CRON_SECRET
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
