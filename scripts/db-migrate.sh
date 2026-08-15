#!/usr/bin/env bash
# db-migrate.sh — apply pending SQL migrations, idempotently.
#
# Tracks applied migrations in a `schema_migrations` table (created on
# first use), so re-running is always safe and "which migrations does this
# branch need?" is never a manual diff again.
#
#   scripts/db-migrate.sh                          # apply all pending
#   scripts/db-migrate.sh --status                 # list applied vs pending
#   scripts/db-migrate.sh --url postgres://…       # target another database
#   scripts/db-migrate.sh --baseline               # mark ALL current files applied, run nothing
#   scripts/db-migrate.sh --baseline-through 0035  # mark files ≤ prefix applied, run nothing
#
# Target resolution: --url beats $DATABASE_URL beats the dev-compose
# default (postgresql://jevi:jevi@localhost:54329/jeviops). The target is
# printed before anything runs.
#
# Baselines exist for databases that predate this script. A DB freshly
# built from infrastructure/schema-selfhost.sql already contains every
# migration on its branch (the triple-sync rule) → `--baseline`. A DB
# known to be current through some number → `--baseline-through NNNN`.
#
# Each migration runs in a single transaction together with its tracking
# insert: it either fully applies and is recorded, or neither happens.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MIGRATIONS_DIR="$ROOT/infrastructure/migrations"

URL="${DATABASE_URL:-postgresql://jevi:jevi@localhost:54329/jeviops}"
MODE="apply"
BASELINE_THROUGH=""

while [ $# -gt 0 ]; do
  case "$1" in
    --url) URL="$2"; shift 2 ;;
    --status) MODE="status"; shift ;;
    --baseline) MODE="baseline"; shift ;;
    --baseline-through) MODE="baseline"; BASELINE_THROUGH="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; sed -n '2,24p' "$0" | sed 's/^# \{0,1\}//' >&2; exit 2 ;;
  esac
done

# Never echo credentials; show host/db only.
echo "target: $(echo "$URL" | sed -E 's|//[^@]*@|//|')"

DEV_URL_DEFAULT="postgresql://jevi:jevi@localhost:54329/jeviops"

# psql resolution: a host binary if present; otherwise, for the default dev
# database only, exec psql inside the dev-compose container (unix socket —
# the host port mapping isn't visible from inside).
if command -v psql >/dev/null 2>&1; then
  run_psql() { PGOPTIONS='-c client_min_messages=warning' psql "$URL" "$@"; }
elif [ "$URL" = "$DEV_URL_DEFAULT" ] \
    && docker ps --format '{{.Names}}' 2>/dev/null | grep -qx jevi-ops-dev-pg; then
  run_psql() {
    docker exec -i -e PGOPTIONS='-c client_min_messages=warning' \
      jevi-ops-dev-pg psql -U jevi -d jeviops "$@"
  }
else
  echo "psql not found on PATH and no jevi-ops-dev-pg container to exec into." >&2
  echo "Install postgresql client tools, or start the dev DB:" >&2
  echo "  docker compose -f infrastructure/docker/compose.dev.yml up -d" >&2
  exit 1
fi

PSQL=(run_psql -v ON_ERROR_STOP=1 -qtA)

"${PSQL[@]}" -c "create table if not exists schema_migrations (
  filename text primary key,
  applied_at timestamptz not null default now()
);" >/dev/null

applied="$("${PSQL[@]}" -c 'select filename from schema_migrations order by filename;')"

is_applied() { grep -qxF "$1" <<<"$applied"; }

files=()
while IFS= read -r f; do files+=("$f"); done < <(ls "$MIGRATIONS_DIR"/*.sql | sort)

case "$MODE" in
  status)
    for f in "${files[@]}"; do
      base="$(basename "$f")"
      if is_applied "$base"; then echo "applied  $base"; else echo "PENDING  $base"; fi
    done
    ;;

  baseline)
    n=0
    for f in "${files[@]}"; do
      base="$(basename "$f")"
      if [ -n "$BASELINE_THROUGH" ] && [[ "${base%%_*}" > "$BASELINE_THROUGH" ]]; then
        continue
      fi
      is_applied "$base" && continue
      "${PSQL[@]}" -c "insert into schema_migrations (filename) values ('$base') on conflict do nothing;" >/dev/null
      echo "baselined  $base"
      n=$((n + 1))
    done
    echo "$n file(s) marked applied without running."
    ;;

  apply)
    n=0
    for f in "${files[@]}"; do
      base="$(basename "$f")"
      is_applied "$base" && continue
      echo "applying  $base"
      { cat "$f"; printf "\ninsert into schema_migrations (filename) values ('%s');\n" "$base"; } \
        | run_psql -v ON_ERROR_STOP=1 -1 -q
      n=$((n + 1))
    done
    if [ "$n" -eq 0 ]; then echo "up to date — nothing pending."; else echo "$n migration(s) applied."; fi
    ;;
esac
