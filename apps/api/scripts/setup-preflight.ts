import { sql } from 'drizzle-orm';
import { closeDb, getDb } from '../src/lib/db.js';
import { getCoreReadiness } from '../src/lib/core-onboarding.js';

// Read-only installation preflight. Never print .env, raw database URLs or credentials.
try {
  const checks = await getCoreReadiness();
  for (const check of checks) console.log(`${check.status.toUpperCase()} ${check.title} (${check.required ? 'core' : 'optional'}): ${check.detail}`);
  try {
    const [result] = await getDb().execute<{ count: number }>(sql`select count(*)::integer as count from auth_user`);
    console.log(result?.count ? 'Owner account exists. Sign in at the web application address, then open /onboarding.'
      : 'Create the first owner: pnpm --filter @jevi-ops/api exec tsx scripts/create-user.ts --email you@example.com');
  } catch { console.log('Owner account status unavailable until the database schema is ready.'); }
  console.log('Local development sign-in: http://127.0.0.1:3000/sign-in. For a deployment, use its configured web origin followed by /sign-in.');
  console.log('Run scripts/db-migrate.sh --status to check migrations. A fresh schema bootstrap must be baselined only after verifying it loaded successfully.');
  process.exitCode = checks.some((check) => check.required && ['degraded', 'unavailable'].includes(check.status)) ? 1 : 0;
} finally { await closeDb(); }
