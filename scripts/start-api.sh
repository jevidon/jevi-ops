#!/usr/bin/env bash
# Start the Fastify API in production. We use tsx (an enhanced Node runtime
# that handles .ts imports natively) so we can consume @jerad-ops/shared's
# TypeScript source without a separate compile step. Calls ./node_modules/.bin/tsx
# directly to avoid depending on pnpm being on PATH at PM2 start time.
set -e
cd "$(dirname "$0")/../apps/api"
exec ./node_modules/.bin/tsx src/server.ts
