#!/usr/bin/env bash
# rollback-codex-onboarding.sh — remove what PRs #48, #49, #50 (the
# codex/onboarding-* branches) left behind in a database.
#
# Those PRs were never merged, but a database that was migrated while one
# of those branches (or feat/durable-capture-gate-a, which was stacked on
# them) was checked out carries their migrations 0053_safe_settings …
# 0059_vehicle_monitoring: 24 tables, four extra columns, a foreign key on
# api_tokens, and tracking rows in schema_migrations. The capture migration
# was numbered 0060 on that stack and is 0053_durable_capture on the real
# branch, so db-migrate also reports it PENDING although its tables exist.
#
#   scripts/rollback-codex-onboarding.sh             # inspect only (default) — read-only report
#   scripts/rollback-codex-onboarding.sh --dry-run   # run the rollback inside a transaction, then ROLLBACK
#   scripts/rollback-codex-onboarding.sh --apply     # run it for real (one transaction, all or nothing)
#   scripts/rollback-codex-onboarding.sh --url postgres://…   # target another database
#
# Safety: --apply and --dry-run refuse when any codex table holds data,
# when an api_tokens row uses the codex research_worker profile, or when
# app_settings.credential_settings is non-empty (that would mean the codex
# credential encryption ran and secrets live only there). --force overrides
# all three; do not use it without reading the inspect output first.
#
# After --apply, run `scripts/db-migrate.sh`: it re-applies
# 0053_durable_capture.sql (idempotent) which restores the current
# api_tokens permission_profile constraint. Then restart the API.
#
# Target and psql resolution are identical to scripts/db-migrate.sh.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

env_url=""
if [ -f "$ROOT/.env" ]; then
  env_url="$(sed -n 's/^DATABASE_URL=//p' "$ROOT/.env" | tail -1 | tr -d '"'"'"'')"
fi
URL="${DATABASE_URL:-${env_url:-postgresql://jevi:jevi@localhost:54329/jeviops}}"
MODE="inspect"
FORCE=0

while [ $# -gt 0 ]; do
  case "$1" in
    --url) URL="$2"; shift 2 ;;
    --inspect) MODE="inspect"; shift ;;
    --dry-run) MODE="dry-run"; shift ;;
    --apply) MODE="apply"; shift ;;
    --force) FORCE=1; shift ;;
    *) echo "unknown argument: $1" >&2; sed -n '2,27p' "$0" | sed 's/^# \{0,1\}//' >&2; exit 2 ;;
  esac
done

echo "target: $(echo "$URL" | sed -E 's|//[^@]*@|//|')"
echo "mode:   $MODE"

PSQL_BIN="${PSQL_BIN:-}"
if [ -z "$PSQL_BIN" ]; then
  if command -v psql >/dev/null 2>&1; then
    PSQL_BIN=psql
  else
    for candidate in \
      /opt/homebrew/opt/libpq/bin/psql \
      /opt/homebrew/bin/psql \
      /usr/local/opt/libpq/bin/psql \
      /usr/local/bin/psql \
      /Applications/Postgres.app/Contents/Versions/latest/bin/psql; do
      if [ -x "$candidate" ]; then PSQL_BIN="$candidate"; break; fi
    done
  fi
fi

if [ -n "$PSQL_BIN" ]; then
  run_psql() { PGOPTIONS='-c client_min_messages=warning' "$PSQL_BIN" "$URL" "$@"; }
elif [[ "$URL" == *"localhost:54329/"* ]] \
    && docker ps --format '{{.Names}}' 2>/dev/null | grep -qx jevi-ops-dev-pg; then
  DEV_DB="${URL##*/}"; DEV_DB="${DEV_DB%%\?*}"
  run_psql() {
    docker exec -i -e PGOPTIONS='-c client_min_messages=warning' \
      jevi-ops-dev-pg psql -U jevi -d "$DEV_DB" "$@"
  }
else
  echo "psql not found on PATH and no jevi-ops-dev-pg container to exec into." >&2
  echo "Install postgresql client tools, or start the dev DB:" >&2
  echo "  docker compose -f infrastructure/docker/compose.dev.yml up -d" >&2
  exit 1
fi

q() { run_psql -v ON_ERROR_STOP=1 -qtA -c "$1"; }

# Fail loudly if the database is unreachable — an empty answer must never
# be mistaken for "nothing to do".
if [ "$(q 'select 1' 2>/dev/null || true)" != 1 ]; then
  echo "cannot connect to the target database (check DATABASE_URL / --url, and that Postgres is up)." >&2
  q 'select 1' || true
  exit 1
fi

# ── What the codex migrations created ────────────────────────────────────
CODEX_TABLES=(
  installation_setup
  onboarding_sessions onboarding_operation_receipts
  source_documents source_candidates source_links
  responsibility_rules responsibility_rule_versions responsibility_rule_sources
  vehicle_assessments vehicle_assessment_history
  knowledge_transitions knowledge_transition_history knowledge_change_previews
  research_workers research_jobs research_results research_result_sources research_proposals research_audit
  monitoring_policies monitoring_signals monitoring_review_runs monitoring_notifications
)
CODEX_MIGRATIONS=(
  0053_safe_settings.sql
  0054_onboarding.sql
  0055_private_sources.sql
  0056_vehicle_knowledge.sql
  0057_historical_source_evidence.sql
  0058_research_workers.sql
  0059_vehicle_monitoring.sql
)
# Capture's migration under the old numbering, and under the real one.
# Both rows are removed so db-migrate re-runs 0053_durable_capture.sql,
# which is idempotent and restores the correct api_tokens constraint.
CAPTURE_OLD=0060_durable_capture.sql
CAPTURE_NEW=0053_durable_capture.sql

# ── Inspect ──────────────────────────────────────────────────────────────
found=0
blocked=0

col_exists() { # table column
  [ "$(q "select count(*) from information_schema.columns where table_schema='public' and table_name='$1' and column_name='$2'")" = 1 ]
}

echo
echo "── codex tables"
for t in "${CODEX_TABLES[@]}"; do
  if [ "$(q "select to_regclass('public.$t') is not null")" = t ]; then
    n="$(q "select count(*) from $t")"
    found=1
    flag=""
    if [ "$t" != installation_setup ] && [ "$n" != 0 ]; then flag="   <-- HAS DATA"; blocked=1; fi
    printf "  present  %-32s rows=%s%s\n" "$t" "$n" "$flag"
  fi
done
[ "$found" = 0 ] && echo "  none present"

echo
echo "── codex columns"
for spec in app_settings:revision app_settings:credential_settings app_settings:capability_tests \
            maintenance_logs:historical_only api_tokens:worker_id; do
  t="${spec%%:*}"; c="${spec##*:}"
  if col_exists "$t" "$c"; then
    found=1
    echo "  present  $t.$c"
  fi
done

if col_exists app_settings credential_settings; then
  cred="$(q "select coalesce(max(credential_settings::text), '{}') from app_settings")"
  if [ "$cred" != "{}" ]; then
    echo "  <-- BLOCKER: app_settings.credential_settings is not empty (codex credential encryption ran)."
    echo "      Move those credentials back to the plain settings columns before dropping this column."
    blocked=1
  else
    echo "  ok       app_settings.credential_settings is empty — encryption never ran"
  fi
fi

if col_exists api_tokens permission_profile; then
  rw="$(q "select count(*) from api_tokens where permission_profile = 'research_worker'")"
  if [ "$rw" != 0 ]; then
    echo "  <-- BLOCKER: $rw api_tokens row(s) use permission_profile='research_worker'"
    blocked=1
  fi
fi
if col_exists api_tokens worker_id; then
  wid="$(q "select count(*) from api_tokens where worker_id is not null")"
  if [ "$wid" != 0 ]; then
    echo "  <-- BLOCKER: $wid api_tokens row(s) have worker_id set"
    blocked=1
  fi
fi

echo
echo "── api_tokens permission_profile constraint"
def="$(q "select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'api_tokens'::regclass and conname = 'api_tokens_permission_profile_check'" || true)"
if [ -z "$def" ]; then
  echo "  absent"
elif [[ "$def" == *research_worker* ]]; then
  echo "  codex version (mentions research_worker) — will be replaced by 0053_durable_capture.sql"
  found=1
else
  echo "  current: $def"
fi

echo
echo "── schema_migrations rows"
if [ "$(q "select to_regclass('public.schema_migrations') is not null")" = t ]; then
  codex_list=""
  for m in "${CODEX_MIGRATIONS[@]}" "$CAPTURE_OLD"; do codex_list+="'$m',"; done
  [ "$(q "select count(*) from schema_migrations where filename in (${codex_list%,})")" != 0 ] && found=1
  rows="$(q "select filename from schema_migrations where filename >= '0053' order by filename")"
  [ -z "$rows" ] && echo "  (none at or after 0053)"
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    mark="  "
    for m in "${CODEX_MIGRATIONS[@]}" "$CAPTURE_OLD"; do [ "$f" = "$m" ] && mark="rm"; done
    [ "$f" = "$CAPTURE_NEW" ] && [ "$found" = 1 ] && mark="rm"
    echo "  $mark  $f"
  done <<<"$rows"
  [ "$found" = 1 ] && echo "  (rm = row will be deleted; 0053_durable_capture.sql is re-applied by db-migrate afterwards)"
else
  echo "  no schema_migrations table"
fi

echo
if [ "$found" = 0 ]; then
  echo "RESULT: nothing from PRs #48–#50 found in this database. Nothing to do."
  [ "$MODE" = inspect ] || echo "        ($MODE skipped)"
  exit 0
fi
if [ "$blocked" = 1 ]; then
  echo "RESULT: leftovers found, but BLOCKERS above mean data would be lost."
  if [ "$FORCE" = 0 ]; then
    echo "        Refusing to $MODE. Re-run with --force only after deciding that data is disposable."
    [ "$MODE" = inspect ] && exit 0
    exit 3
  fi
  echo "        --force given: continuing anyway."
else
  echo "RESULT: leftovers found; all codex tables are empty and no blockers. Safe to roll back."
fi
[ "$MODE" = inspect ] && { echo "        Next: scripts/rollback-codex-onboarding.sh --dry-run, then --apply."; exit 0; }

# ── Build the rollback SQL ───────────────────────────────────────────────
sql=""
sql+="alter table if exists api_tokens drop constraint if exists api_tokens_permission_profile_check;"$'\n'
sql+="alter table if exists api_tokens drop column if exists worker_id;"$'\n'
for t in "${CODEX_TABLES[@]}"; do
  sql+="drop table if exists $t cascade;"$'\n'
done
sql+="alter table if exists app_settings drop constraint if exists app_settings_revision_check;"$'\n'
sql+="alter table if exists app_settings drop constraint if exists app_settings_credential_settings_check;"$'\n'
sql+="alter table if exists app_settings drop constraint if exists app_settings_capability_tests_check;"$'\n'
sql+="alter table if exists app_settings drop column if exists revision;"$'\n'
sql+="alter table if exists app_settings drop column if exists credential_settings;"$'\n'
sql+="alter table if exists app_settings drop column if exists capability_tests;"$'\n'
sql+="alter table if exists maintenance_logs drop constraint if exists maintenance_logs_history_not_baseline;"$'\n'
sql+="alter table if exists maintenance_logs drop column if exists historical_only;"$'\n'
list=""
for m in "${CODEX_MIGRATIONS[@]}" "$CAPTURE_OLD" "$CAPTURE_NEW"; do list+="'$m',"; done
sql+="delete from schema_migrations where filename in (${list%,});"$'\n'

# Post-check inside the same transaction: anything left is a bug in this script.
sql+="select 'remaining codex tables: ' || count(*) from pg_tables where schemaname='public' and tablename in ("
for t in "${CODEX_TABLES[@]}"; do sql+="'$t',"; done
sql="${sql%,});"$'\n'
sql+="select 'remaining codex columns: ' || count(*) from information_schema.columns where table_schema='public' and ((table_name='app_settings' and column_name in ('revision','credential_settings','capability_tests')) or (table_name='maintenance_logs' and column_name='historical_only') or (table_name='api_tokens' and column_name='worker_id'));"$'\n'
sql+="select 'remaining tracking rows: ' || count(*) from schema_migrations where filename in (${list%,});"$'\n'

echo
if [ "$MODE" = dry-run ]; then
  echo "── DRY RUN: executing inside a transaction, then ROLLBACK"
  printf 'begin;\n%srollback;\n' "$sql" | run_psql -v ON_ERROR_STOP=1 -qtA
  echo "── dry run finished; nothing was changed. Counts above must all be 0."
  echo "   Next: scripts/rollback-codex-onboarding.sh --apply"
else
  echo "── APPLY: executing inside one transaction"
  printf 'begin;\n%scommit;\n' "$sql" | run_psql -v ON_ERROR_STOP=1 -qtA
  echo "── committed. Counts above must all be 0."
  echo
  echo "NEXT STEPS (required):"
  echo "  1. scripts/db-migrate.sh            # re-applies 0053_durable_capture.sql (idempotent)"
  echo "  2. scripts/db-migrate.sh --status   # every file must read 'applied'"
  echo "  3. scripts/devctl.sh restart api    # if the dev servers are running"
  echo "  4. scripts/rollback-codex-onboarding.sh   # inspect again: expect 'Nothing to do'"
fi
