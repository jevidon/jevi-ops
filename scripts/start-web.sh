#!/usr/bin/env bash
# Start the Next.js production server. We call ./node_modules/.bin/next
# directly (pnpm-installed shim) instead of going through pnpm, because
# XCloud's PM2 launches this from a fresh shell that doesn't have pnpm on
# PATH. Calling the binary directly removes that dependency.
set -e
cd "$(dirname "$0")/../apps/web"
exec ./node_modules/.bin/next start -p 3000
