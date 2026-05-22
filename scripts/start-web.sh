#!/usr/bin/env bash
# XCloud's Start Command runs this. We re-establish PATH because the start
# process is a fresh shell that doesn't inherit env from the deploy script.
# Same pattern as scripts/start-api.sh.
set -e
export PATH="$HOME/.local/bin:$PATH"
exec pnpm start:web
