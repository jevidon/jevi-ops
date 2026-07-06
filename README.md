# jevi-ops

Jerad's Personal Operations Dashboard. Voice-first capture, six-tab PWA, one pane of glass.

Spec source of truth: `~/Documents/Jerad Dashboard/personal-ops-dashboard-spec.md`. Mockups: open `~/Documents/Jerad Dashboard/index.html` via a local static server (it loads `screens/*.jsx`).

## Layout

```
jevi-ops/
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
cd ~/Documents/jevi-ops
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

## Build status

Tracked against spec §12 plus subsequent addenda. ✅ shipped · 🟡 partial · ⬜ pending · ↷ superseded.

**Foundation**
- ✅ Monorepo, env loader, design tokens, 6-tab shell, floating mic FAB
- ✅ Full Postgres schema (30 migrations, 20+ tables — new deploys can run the consolidated `infrastructure/schema.sql` instead of stepping through each migration)
- ✅ Seeded stewardship domains (six original + three YouTube channels added later; see migrations 0002, 0007)
- ✅ Supabase Auth wiring — cookie sessions via `@supabase/ssr` on the web, Bearer JWT middleware on the API, service-role bypass reserved for cron/ingest paths
- ✅ Web → API client — typed fetch wrapper at `apps/web/src/lib/api.ts`, one namespace per surface (`tasksApi`, `libraryApi`, `briefingApi`, etc.)
- ↷ ~~Drizzle schema mirror~~ — went with raw SQL migrations instead. `apps/api/drizzle.config.ts` exists but is unused; safe to delete on a cleanup pass

**Capture pipeline**
- ✅ Generic `POST /api/ingest` webhook + `POST /api/ingest/capture` for external voice sources (Apple Watch, Android HTTP Shortcuts)
- ✅ Voice parser (Anthropic Claude) — 15 action types: task/project/note/quote/annotation/journal/calendar_event/person_fact/inventory/content_item/set_resurface_weight
- ✅ Executor — routes parsed actions into their DB tables, handles fuzzy matching against project/person/quote/note/journal/book names
- ✅ Server-side voice capture (`POST /api/capture/voice-audio`) — MediaRecorder → OpenAI Whisper → parser

**Today / Briefing (June 2026 redesign)**
- ✅ Editorial masthead → "In brief" cadence lines → resurfaced pull-quote → latest quote → today's events → interactive task list → routines check-off → capture chips
- ✅ Domain cadence engine — `days_since_journal`, `days_since_publish`, `no_activity_days` rules computed against journal_entries / content_items / activity_log + a manual "Mark shipped" for off-dashboard channels (Substack, etc.)
- ✅ Top-3-for-today setter — star on every task row toggles the pin
- ✅ Inbox triage — tasks captured without explicit domain routing land in the `Inbox` system domain; one-tap triage from Today
- ✅ Resurfacing — daily rotating pick weighted by `resurface_weight` per row, manual "Next →" to cycle within a day

**Library**
- ✅ Notes, quotes, quote annotations, journal entries — full CRUD (manual forms + voice)
- ✅ Books — manual entry + Readwise/Kindle import script + Open Library cover backfill script
- ✅ Unified feed at `/library` (clamped rows) + per-kind sub-pages with tag chips, source filters, resurface-weight controls
- ✅ Per-item weight cycle on quote/note/journal detail pages
- ✅ Voice intent `set_resurface_weight` — "boost the Cal Newport quote about focus"

**Content pipeline** (`/content`)
- ✅ Content items with 7-stage pipeline (idea → outline → filming → editing → published → derivatives_pending → done)
- ✅ Domain assignment + type (video/article/podcast/etc.) + derivative chains via `parent_id`
- ✅ Active vs Done split; auto-stamped `published_at` when status crosses a shipped state
- 🟡 Per-item checklist items exist (`content_checklist_items`), but reusable **templates** aren't wired — projects and content just get bespoke checklists. Tables `checklist_templates`/`checklist_instances` exist unused; either build the templating flow or drop the tables

**Google + calendar**
- ✅ Two-way Google Calendar sync — pulls ±7 days, upserts local events, deletes cancellations, pushes locally-created orphans back
- ✅ Cron-driven every 15 minutes via `/api/cron/calendar-sync`
- ✅ Manual "Sync now" affordance on `/settings`

**Notifications + observations**
- ✅ Notifications feed at `/notifications` with unread badge and drill-through URLs per action type
- ✅ Observations cron (`/api/cron/observations`, hourly) — evaluates `failure_patterns` per domain, writes rows to `observations`
- ✅ Reminder cron (`/api/cron/reminders`, every minute) — task + routine reminders + routine "missed" sweep

**Domains + projects**
- ✅ Retire `kind='area'` projects, tasks attach directly to domains (Addendum 03)
- ✅ Domain cadence rule editor + Mark-shipped button + is_system protection for the Inbox row
- ✅ Project status chips — one-tap Active/Paused/Done/Archived
- ✅ Milestones with weighted progress, activity log, checklists
- ✅ Retainers (monthly-cap tracking distinct from finite projects)

**Routines**
- ✅ Daily habit tracker with buckets, specific-time reminders, goal_days, streak stats + heatmap
- ✅ Inline check-off on the Briefing's right rail
- ✅ Missed-routine cron sweep + Pushover ping

**Health**
- ✅ Personal health record area — visits, vitals, labs, wellbeing check-ins, medications, workouts, medical history
- ✅ Source tracking on metrics (manual/garmin/apple_health/etc.)
- 🟡 Trend line charts + document upload via Supabase Storage — deferred to Health Session 2

**People (CRM)**
- ✅ People + facts + interactions tables
- 🟡 Full CRM UI (person detail pages, timeline, upcoming birthdays surface) — foundation is there, deeper flows deferred

**External surfaces**
- ✅ Apple Watch → `/api/ingest/capture` webhook
- ✅ Android via HTTP Shortcuts app
- ✅ iOS Scriptable home-screen widget — pulls a weighted-random quote from `/api/widget/quote` every ~3 hours
- ✅ PWA install (Add to Home Screen) — respects the iOS home indicator via `viewport-fit=cover` + safe-area insets

**Not built / deferred**
- ⬜ Nightly backup cron → Drive + NAS. Supabase's automated daily backups + PITR cover the platform-level risk. Would matter for account-level independence.
- ⬜ Reusable checklist templates (see Content row above)
- ⬜ Health Session 2/3 — trend charts, document upload, Garmin CSV import, running/cycling trainer area
- ⬜ Reflection prompts + weekly review flow (spec §12)

## Getting started from scratch

1. Create a Supabase project. Paste `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and `DATABASE_URL` into `.env` at the repo root (see `.env.example`).
2. Open the Supabase SQL editor and run `infrastructure/schema.sql` — one file, safe to re-run, sets up the whole schema + RLS + seed domains. (Historical migrations `0001` through `0030` in the same folder are how the existing prod deploy got here; you don't need them for a fresh install.)
3. Fill in the remaining `.env` values: Anthropic + OpenAI keys for capture + parser, Google OAuth for calendar sync, Bunny for image hosting, Pushover for notifications, plus four generated secrets:
   ```
   openssl rand -hex 32  # INGEST_WEBHOOK_SECRET
   openssl rand -hex 32  # CRON_SECRET
   openssl rand -hex 32  # OAUTH_BRIDGE_SECRET
   openssl rand -hex 32  # WIDGET_SECRET
   ```
4. `pnpm install && pnpm dev:api && pnpm dev:web` — two shells. `/healthz` should return `supabase_configured: true`; `/today` should render (once you've signed in).

## Conventions

- **All capture is liberal, all display is conservative** — `/api/ingest` accepts anything; only ~7 things earn home-screen real estate (spec §2).
- **Every autonomous action is logged + reversible** — write to `action_log` and emit a notification (`undo_payload` populated).
- **Stages over completeness** — schema includes tables not yet used; data flows in before the UI exists.
- **Single user, but RLS on** — use the anon key + JWT path everywhere except cron/ingest, which use service role.
