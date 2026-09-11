import { afterAll, beforeEach } from 'vitest';
import { env } from '../src/lib/env.js';
import { closeDb, getDb } from '../src/lib/db.js';
import { invalidateAppSettings } from '../src/lib/app-settings.js';
import { testUrl } from './db-url.js';

// Per-worker: repoint the API at the test database BEFORE any getDb() call.
// env.ts loads the root .env with override:true, so the process env can't
// carry this — but `env` is a plain object and the db client reads it
// lazily, so mutating it here is enough.
env.DATABASE_URL = testUrl();
env.CRON_SECRET = env.CRON_SECRET ?? 'test-cron-secret-0123456789';
// Route tests build the real Fastify app; keep its request log out of the
// test output.
env.LOG_LEVEL = 'fatal';

// Every test starts from an empty maintenance slate. The seed's domains and
// app_settings row stay; tasks/attention are truncated because the sweep
// and rules write there.
beforeEach(async () => {
  const db = getDb();
  await db.execute(`
    truncate table maintenance_logs, maintenance_items, asset_meter_readings, assets,
                   attention_items, tasks, api_tokens
    restart identity cascade
  `);
  invalidateAppSettings();
});

afterAll(async () => {
  await closeDb();
});
