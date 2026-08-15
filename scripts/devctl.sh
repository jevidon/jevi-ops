#!/usr/bin/env bash
# devctl.sh — run the dev servers as detached background processes.
#
# Built for agent-driven terminals: no command here needs `&`, holds a
# foreground process, or dies with a tool timeout. Every subcommand returns
# within seconds; the servers keep running until `stop`.
#
#   scripts/devctl.sh start [api|web|all]      # default: all
#   scripts/devctl.sh stop [api|web|all]
#   scripts/devctl.sh restart [api|web|all]
#   scripts/devctl.sh status
#   scripts/devctl.sh logs <api|web> [lines]   # last N log lines (default 40)
#
# PID files and logs live in .dev-run/ at the repo root (gitignored).
# The API runs tsx without watch mode — `restart api` after code changes.
# Web runs `next dev` and hot-reloads on its own.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RUN="$ROOT/.dev-run"
mkdir -p "$RUN"

API_PORT="${API_PORT:-3001}"
WEB_PORT="${WEB_PORT:-3000}"

pid_of() { cat "$RUN/$1.pid" 2>/dev/null || true; }

is_running() {
  local pid; pid="$(pid_of "$1")"
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null
}

url_for() {
  case "$1" in
    api) echo "http://127.0.0.1:${API_PORT}/healthz" ;;
    web) echo "http://127.0.0.1:${WEB_PORT}/" ;;
  esac
}

start_one() {
  local name="$1" dir="$2"; shift 2
  local url; url="$(url_for "$name")"
  if is_running "$name"; then
    echo "$name: already running (pid $(pid_of "$name"))"
    return 0
  fi
  rm -f "$RUN/$name.pid"
  # nohup + background happens *inside* this script — the caller never
  # needs job-control syntax and can't kill the server by disconnecting.
  # `set -m` gives the server its own process group, so `stop`'s group-kill
  # can never take down the shell that ran `start`.
  ( set -m; cd "$dir" && nohup "$@" >"$RUN/$name.log" 2>&1 & echo $! >"$RUN/$name.pid" )
  local pid; pid="$(pid_of "$name")"
  # Wait up to 30s for the port to answer so callers get a real verdict,
  # not a "started" that dies two seconds later.
  local i
  for i in $(seq 1 30); do
    if curl -sf -o /dev/null --max-time 2 "$url"; then
      echo "$name: up (pid $pid) — $url"
      return 0
    fi
    if ! kill -0 "$pid" 2>/dev/null; then
      echo "$name: process died on startup. Last log lines:" >&2
      tail -n 25 "$RUN/$name.log" >&2
      rm -f "$RUN/$name.pid"
      return 1
    fi
    sleep 1
  done
  echo "$name: started (pid $pid) but $url not answering after 30s — try: scripts/devctl.sh logs $name" >&2
  return 1
}

stop_one() {
  local name="$1"
  local pid; pid="$(pid_of "$name")"
  if [ -z "$pid" ] || ! kill -0 "$pid" 2>/dev/null; then
    echo "$name: not running"
    rm -f "$RUN/$name.pid"
    return 0
  fi
  # Kill the whole process group (next dev spawns children). The server has
  # its own group (start uses `set -m`), but never group-kill our own group —
  # that would take down this script and its caller.
  local pgid my_pgid
  pgid="$(ps -o pgid= -p "$pid" | tr -d ' ')"
  my_pgid="$(ps -o pgid= -p $$ | tr -d ' ')"
  if [ -n "$pgid" ] && [ "$pgid" != "$my_pgid" ]; then
    kill -TERM -- "-$pgid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
  else
    kill -TERM "$pid" 2>/dev/null || true
  fi
  local i
  for i in $(seq 1 10); do
    kill -0 "$pid" 2>/dev/null || break
    sleep 1
  done
  if kill -0 "$pid" 2>/dev/null; then
    kill -KILL "$pid" 2>/dev/null || true
    echo "$name: force-killed (pid $pid)"
  else
    echo "$name: stopped"
  fi
  rm -f "$RUN/$name.pid"
}

status_one() {
  local name="$1"
  local url; url="$(url_for "$name")"
  if is_running "$name"; then
    if curl -sf -o /dev/null --max-time 2 "$url"; then
      echo "$name: running (pid $(pid_of "$name")) — $url answering"
    else
      echo "$name: running (pid $(pid_of "$name")) but $url NOT answering"
    fi
  else
    echo "$name: stopped"
  fi
}

do_start() {
  case "$1" in
    api) start_one api "$ROOT/apps/api" ./node_modules/.bin/tsx src/server.ts ;;
    web) start_one web "$ROOT/apps/web" ./node_modules/.bin/next dev -p "$WEB_PORT" ;;
    all) do_start api; do_start web ;;
  esac
}

do_stop() {
  case "$1" in
    api|web) stop_one "$1" ;;
    all) stop_one web; stop_one api ;;
  esac
}

cmd="${1:-}"
target="${2:-all}"
case "$target" in api|web|all) ;; *) echo "unknown target: $target (want api|web|all)" >&2; exit 2 ;; esac

case "$cmd" in
  start)   do_start "$target" ;;
  stop)    do_stop "$target" ;;
  restart) do_stop "$target"; do_start "$target" ;;
  status)  status_one api; status_one web ;;
  logs)
    case "$target" in
      api|web) tail -n "${3:-40}" "$RUN/$target.log" 2>/dev/null || echo "no log yet for $target" ;;
      *) echo "usage: devctl.sh logs <api|web> [lines]" >&2; exit 2 ;;
    esac
    ;;
  *)
    sed -n '2,17p' "$0" | sed 's/^# \{0,1\}//'
    exit 2
    ;;
esac
