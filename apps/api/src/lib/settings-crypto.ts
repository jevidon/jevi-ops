import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export class SettingsError extends Error {
  constructor(public readonly code: string, public readonly status = 400) { super(code); }
}
export interface SecretEnvelope { version: 1; key_id: string; iv: string; tag: string; ciphertext: string }

// The keyring deliberately lives outside PostgreSQL. Reading it on each use
// makes loss/replacement fail closed, including after a warm settings cache.
function keyring(): Record<string, Buffer> {
  try {
    const raw = JSON.parse(process.env.SETTINGS_ENCRYPTION_KEYS ?? '{}') as Record<string, unknown>;
    const keys: Record<string, Buffer> = {};
    for (const [id, value] of Object.entries(raw)) {
      if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id) || typeof value !== 'string' || !/^[0-9a-f]{64}$/i.test(value)) throw new Error();
      keys[id] = Buffer.from(value, 'hex');
    }
    return keys;
  } catch { throw new SettingsError('credential_keyring_invalid', 503); }
}
export function sealSecret(value: string, binding: string): SecretEnvelope {
  const keyId = process.env.SETTINGS_ENCRYPTION_ACTIVE_KEY ?? '';
  const key = keyring()[keyId];
  if (!key) throw new SettingsError('credential_key_missing', 503);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(`jevi-settings:v1:${binding}`));
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return { version: 1, key_id: keyId, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') };
}
export function openSecret(envelope: SecretEnvelope, binding: string): string {
  try {
    if (envelope.version !== 1) throw new Error();
    const key = keyring()[envelope.key_id];
    if (!key) throw new Error();
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
    decipher.setAAD(Buffer.from(`jevi-settings:v1:${binding}`));
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64')), decipher.final()]).toString('utf8');
  } catch { throw new SettingsError('credential_locked', 503); }
}
