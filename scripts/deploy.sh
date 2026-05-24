#!/usr/bin/env bash
# XCloud post-deploy hook. Called per-site:
#
#   bash scripts/deploy.sh web
#   bash scripts/deploy.sh api
#
# Replaces the previous inline XCloud deploy command, which ended with
#   `pm2 reload all || pm2 restart all || true`
# The trailing `|| true` silently swallowed pm2 errors — when pm2 wasn't
# on the deploy shell's PATH, both reload + restart failed and the
# deploy reported success without restarting anything. That's why every
# deploy required a manual PM2 restart via the XCloud UI.
#
# This script:
#   1. Sets up PATH with the common pm2 install locations
#   2. Locates pm2 explicitly and logs which binary it found
#   3. Runs install + the right per-site build
#   4. Reloads pm2 with --update-env so XCloud env-var changes take effect
#   5. Verifies the just-reloaded site responds to localhost HTTP
#      (catches the case where pm2 reloads but the process crashes
#      on startup — without this, the deploy reports success even
#      though the site is 502'ing)
#   6. Fails loud on any error so the XCloud deploy log surfaces it

set -euo pipefail

SITE="${1:-}"
if [ "$SITE" != "web" ] && [ "$SITE" != "api" ]; then
  echo "usage: $0 web|api" >&2
  exit 2
fi

# ─── 1. PATH ──────────────────────────────────────────────────────────────
# Add corepack-managed pnpm + common pm2 install locations. XCloud's
# deploy shell is non-interactive and doesn't source ~/.bashrc, so any
# binaries installed under the home dir need to be added explicitly.
mkdir -p "$HOME/.local/bin"
corepack enable --install-directory "$HOME/.local/bin"
export PATH="$HOME/.local/bin:$HOME/.local/share/pnpm:$HOME/.npm-global/bin:/usr/local/bin:$PATH"

# ─── 2. Locate pm2 ────────────────────────────────────────────────────────
# Try `command -v` first (which honors the PATH above), then probe a few
# absolute paths in case pm2 lives somewhere unexpected.
find_pm2() {
  if command -v pm2 >/dev/null 2>&1; then command -v pm2; return; fi
  for candidate in \
    "$HOME/.local/share/pnpm/pm2" \
    "$HOME/.npm-global/bin/pm2" \
    "/usr/local/bin/pm2" \
    "/usr/bin/pm2"; do
    if [ -x "$candidate" ]; then echo "$candidate"; return; fi
  done
  return 1
}
PM2="$(find_pm2)" || {
  echo "ERROR: pm2 binary not found. PATH=$PATH" >&2
  echo "Hint: SSH in and run 'which pm2' to locate it, then add that directory to the PATH export above." >&2
  exit 1
}
echo "Using pm2 at: $PM2"

# ─── 3. Install + build ───────────────────────────────────────────────────
pnpm install --frozen-lockfile

if [ "$SITE" = "web" ]; then
  # Next.js looks for env vars in apps/web/.env.local — symlink the
  # repo-root .env so we keep a single source of truth.
  ln -sf ../../.env apps/web/.env.local
  pnpm build:web
else
  pnpm build:api
fi

# ─── 4. Reload pm2 ────────────────────────────────────────────────────────
# DO NOT add --update-env here. That flag replaces the running process's
# env with whatever env this deploy shell has — and XCloud's deploy shell
# does NOT carry all the env vars that pm2 was originally started with
# (SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_SUPABASE_URL, etc. are injected
# at process-start time, not deploy time). Adding --update-env once
# stripped env from the running processes and 502'd the web until pm2
# was manually re-bootstrapped. Plain `pm2 reload` keeps the captured
# env intact — env-var changes require an explicit pm2 start with the
# new env, but normal code deploys leave env alone.
"$PM2" reload all

# ─── 5. Verify ────────────────────────────────────────────────────────────
# Give pm2 a couple seconds to bring the new worker up before probing.
sleep 3

if [ "$SITE" = "web" ]; then
  URL="http://127.0.0.1:3000/sign-in"
else
  URL="http://127.0.0.1:3001/healthz"
fi

echo "Verifying $URL …"
# Try a few times; the worker may need a moment beyond the sleep above.
attempt=0
while [ "$attempt" -lt 5 ]; do
  if curl -fsS --max-time 5 "$URL" >/dev/null; then
    echo "✓ $SITE responding on $URL"
    exit 0
  fi
  attempt=$((attempt + 1))
  echo "  attempt $attempt failed, retrying in 2s…"
  sleep 2
done

echo "ERROR: $SITE not responding on $URL after pm2 reload" >&2
echo "--- pm2 status ---"
"$PM2" status || true
echo "--- pm2 logs (last 40 lines) ---"
"$PM2" logs --lines 40 --nostream || true
exit 1
