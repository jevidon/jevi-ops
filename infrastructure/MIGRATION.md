# Migrating from hosted jerad-ops (Supabase) → jevi-ops on the NAS

One-time cutover runbook. Total downtime is the length of steps 2–6 —
typically well under an hour. Everything is reversible until step 9: the
Supabase project stays intact (paused) for 30 days.

Prereqs: the NAS stack is deployed and smoke-tested with an *empty*
database (`infrastructure/docker/README.md`), the external systems are
wired (`DEPENDENCIES.md`), and you have the Supabase **session-mode**
connection string (Dashboard → Project Settings → Database → Connection
string → **port 5432**, *not* the 6543 transaction pooler — pg_dump can't
run through the pooler).

## 1. Freeze writes

- Disable the XCloud cron pingers (all five `/api/cron/*` URLs).
- Stop capturing: no watch/widget/voice input during the window.

## 2. Dump the data from Supabase

From any machine with `pg_dump` 16+ (the NAS works: use the postgres
container):

```bash
SUPABASE_URL='postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres'

docker compose exec -T postgres pg_dump "$SUPABASE_URL" \
  -Fc --data-only --schema=public --no-owner --no-privileges \
  -f /backups/ops-data.dump
```

Notes:
- `--data-only`: the NAS schema comes from `schema-selfhost.sql`, not the dump.
- `--schema=public`: excludes Supabase's `auth`/`storage`/`realtime` schemas.
- Every PK is a uuid — there are **no sequences to resync** afterwards.
- `google_oauth_tokens` rides along, so Calendar sync survives the move.

## 3. Prepare the NAS database

Fresh DDL, **no seeds** (the dump already contains the seeded rows —
loading `seed.sql` first would collide):

```bash
docker compose exec -T postgres psql -U jevi -d jeviops -v ON_ERROR_STOP=1 \
  < ../schema-selfhost.sql
```

If the stack ran before with seed data, drop and recreate the DB first:
`docker compose exec postgres psql -U jevi -d postgres -c 'drop database jeviops with (force); create database jeviops;'`

## 4. Restore

```bash
docker compose exec -T postgres pg_restore \
  --data-only --disable-triggers --no-owner \
  -U jevi -d jeviops /backups/ops-data.dump
```

`--disable-triggers` sidesteps FK ordering and keeps `set_updated_at()`
from rewriting historical timestamps. (Tables added by the fork —
`auth_user`, `api_tokens`, the `app_settings.llm_*` columns — simply aren't
in the dump; the restore ignores them. `app_settings`/`health_history`
singletons restore from the dump's rows.)

## 5. Verify row parity

```bash
SUPABASE_URL='…5432 session string…' \
LOCAL_URL='postgresql://jevi:<pw>@localhost:5432/jeviops' \
docker compose exec -T -e SUPABASE_URL -e LOCAL_URL postgres \
  bash -c 'psql "$SUPABASE_URL" -tAc "..."'   # or, simpler, from a workstation:

node scripts/verify-migration.mjs \
  --source "$SUPABASE_URL" \
  --target 'postgresql://jevi:<pw>@<nas>:5432/jeviops'
```

`scripts/verify-migration.mjs` (repo root) compares `count(*)` for every
public table on both sides and exits non-zero on any mismatch.

## 6. Create your login

```bash
docker compose exec api ./node_modules/.bin/tsx scripts/create-user.ts \
  --email jevidon@gmail.com --id <old-supabase-auth-uid>   # --id optional
```

`--id` reuses the old Supabase auth uid for log/bridge-claim continuity —
nothing references it relationally, so omitting it is also fine.

## 7. Repoint the capture surfaces

- **Scriptable widget** (`scriptable/quote-widget.js` on the phone):
  `API_BASE = 'https://<nas>.<tailnet>.ts.net:8443'`, `WIDGET_SECRET` = the
  stack's value.
- **Watch / HTTP Shortcuts**: update the `/api/ingest/capture` URL to the
  ts.net origin and `X-Ingest-Secret` to the stack's `INGEST_WEBHOOK_SECRET`.
- **Google OAuth**: the redirect URI addition from `DEPENDENCIES.md §5`
  (existing refresh tokens keep working; this is for future re-consents).

## 8. Smoke + end-to-end

```bash
API_URL=https://<nas>.<tailnet>.ts.net:8443 \
WEB_URL=https://<nas>.<tailnet>.ts.net \
CRON_SECRET=<stack value> node scripts/smoke-prod.mjs
```

Then the human test, phone on cellular (wifi off, Tailscale on):
sign in → today renders with your real data → hold-to-talk "add a task to
verify the migration" → task lands → Pushover reminder fires at its due
time → widget shows a quote whose tap-through opens the dashboard.

## 9. Decommission

- **Supabase**: pause the project (keeps data + backups ~30 days). Delete
  after a month of clean NAS operation.
- **XCloud**: remove both sites + the cron entries.
- **Bunny**: keep — pre-fork image attachments still point at the CDN. If
  you later cancel it, re-upload or accept broken old images (new uploads
  are local either way).
- **Old repo**: jerad-ops stays as the archived hosted version.
