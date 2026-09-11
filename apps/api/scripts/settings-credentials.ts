import { env } from '../src/lib/env.js';
import { closeDb } from '../src/lib/db.js';
import { getAppSettings } from '../src/lib/app-settings.js';
import { publicSettings } from '../src/lib/settings-config.js';
import { maintainSettingsCredentials } from '../src/lib/settings-credential-maintenance.js';
import { SettingsError } from '../src/lib/settings-crypto.js';

async function main() {
  const operation = process.argv[2];
  if (!['status', 'migrate', 'rotate'].includes(operation ?? '') || process.argv.slice(3).some((arg) => arg !== '--acknowledge-insecure')) {
    throw new SettingsError('usage: settings-credentials.ts status|migrate|rotate [--acknowledge-insecure]');
  }
  const target = new URL(env.DATABASE_URL ?? '');
  console.log(`Database target: ${target.hostname}:${target.port || '5432'}${target.pathname}`);
  if (operation === 'status') console.log(JSON.stringify(publicSettings(await getAppSettings()).credentials, null, 2));
  else {
    const result = await maintainSettingsCredentials(operation as 'migrate' | 'rotate', process.argv.includes('--acknowledge-insecure'));
    console.log(JSON.stringify({ changed: result.changed, credentials: result.settings.credentials }, null, 2));
  }
}
main().catch((error: unknown) => {
  // Do not log a database/crypto error object, URL, or credential payload.
  console.error(error instanceof SettingsError ? error.code : 'Credential operation failed. Verify the database, migration and external keyring.');
  process.exitCode = 1;
}).finally(closeDb);
