import { eq } from 'drizzle-orm';
import { app_settings } from '../db/schema.js';
import { type AppSettings, invalidateAppSettings } from './app-settings.js';
import { credentialBinding, integrationNames, publicSettings, type StoredCredential } from './settings-config.js';
import { getDb } from './db.js';
import { openSecret, sealSecret, SettingsError } from './settings-crypto.js';

/** Explicit operator command. One transaction decrypts/re-encrypts all
 *  applicable entries before clearing any legacy plaintext. Failure retains
 *  every original value. Successful retries are safe. */
export async function maintainSettingsCredentials(operation: 'migrate' | 'rotate', acknowledgeInsecure = false) {
  const result = await getDb().transaction(async (tx) => {
    const [row] = await tx.select().from(app_settings).where(eq(app_settings.id, true)).for('update');
    if (!row) throw new SettingsError('settings_unavailable', 503);
    const settings = row as AppSettings;
    const credentials = { ...row.credential_settings };
    let migrated = 0;
    for (const name of integrationNames) {
      const old = credentials[name] as StoredCredential | undefined;
      const legacy = name === 'llm' ? row.llm_api_key : name === 'immich' ? row.immich_api_key : null;
      const binding = credentialBinding(settings, name);
      if (operation === 'migrate' && legacy) {
        credentials[name] = { source: 'managed', binding, allow_insecure: acknowledgeInsecure, envelope: sealSecret(legacy, binding) } satisfies StoredCredential;
        migrated++;
      } else if (operation === 'rotate' && old?.source === 'managed') {
        if (!old.envelope) throw new SettingsError('credential_locked', 503);
        const value = openSecret(old.envelope, old.binding);
        credentials[name] = { ...old, envelope: sealSecret(value, old.binding) } satisfies StoredCredential;
        migrated++;
      }
    }
    if (migrated === 0) return { changed: 0, settings: publicSettings(settings) };
    const [saved] = await tx.update(app_settings).set({ credential_settings: credentials, revision: row.revision + 1,
      ...(operation === 'migrate' ? { llm_api_key: null, immich_api_key: null } : {}),
    }).where(eq(app_settings.id, true)).returning();
    return { changed: migrated, settings: publicSettings(saved as AppSettings) };
  });
  invalidateAppSettings();
  return result;
}
