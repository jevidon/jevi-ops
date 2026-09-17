import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { signSession } from '../src/lib/jwt.js';
import { hashPassword, verifyPassword } from '../src/lib/passwords.js';
import { getDb } from '../src/lib/db.js';
import { api_tokens, auth_user } from '../src/db/schema.js';
import { hashApiToken } from '../src/routes/auth.js';

let app: FastifyInstance;
let originalHash: string;
let user: { id: string; email: string };
let session: string;
const original = 'old test password';
const replacement = 'new test password';

beforeAll(async () => {
  originalHash = await hashPassword(original);
  app = await buildServer();
  await app.ready();
});
beforeEach(async () => {
  user = { id: randomUUID(), email: `password-${randomUUID()}@test.local` };
  await getDb().insert(auth_user).values({ ...user, password_hash: originalHash });
  session = await signSession(user);
});
afterAll(async () => { await app.close(); });

function change(over: Record<string, unknown> = {}, token: string | null = session) {
  return app.inject({
    method: 'POST', url: '/api/auth/password',
    headers: token ? { authorization: `Bearer ${token}` } : {},
    payload: { current_password: original, new_password: replacement, confirm_password: replacement, ...over },
  });
}
function login(password: string) {
  return app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: user.email, password } });
}
async function storedHash() {
  return (await getDb().query.auth_user.findFirst({ where: eq(auth_user.id, user.id) }))!.password_hash;
}

describe('Settings password change', () => {
  it('requires a signed-in session', async () => {
    expect((await change({}, null)).statusCode).toBe(401);
    expect((await change({}, 'invalid-session')).statusCode).toBe(401);
    expect(await storedHash()).toBe(originalHash);
  });

  it.each(['legacy', 'capture_client'] as const)('refuses %s API tokens even with the correct password', async (permission_profile) => {
    const token = `ops_${randomUUID()}`;
    await getDb().insert(api_tokens).values({ name: 'Test phone', token_hash: hashApiToken(token), permission_profile, scopes: ['capture:write'] });
    expect((await change({}, token)).statusCode).toBe(403);
    expect(await storedHash()).toBe(originalHash);
  });

  it('rejects the wrong current password without changing the stored hash', async () => {
    const result = await change({ current_password: 'incorrect password' });
    expect(result.statusCode).toBe(400);
    expect(result.json()).toEqual({ error: 'invalid_current_password' });
    expect(await storedHash()).toBe(originalHash);
  });

  it('rejects a session whose account no longer exists', async () => {
    await getDb().delete(auth_user).where(eq(auth_user.id, user.id));
    expect((await change()).json()).toEqual({ error: 'invalid_session' });
  });

  it.each([
    { current_password: '' },
    { new_password: 'short', confirm_password: 'short' },
    { new_password: 'x'.repeat(1025), confirm_password: 'x'.repeat(1025) },
    { confirm_password: 'a different password' },
    { user_id: 'another-account' },
  ])('validates the request without changing credentials: %j', async (over) => {
    expect((await change(over)).statusCode).toBe(400);
    expect(await storedHash()).toBe(originalHash);
  });

  it('replaces the hash, accepts the new password, rejects the old one, and preserves active credentials', async () => {
    const deviceToken = `ops_${randomUUID()}`;
    await getDb().insert(api_tokens).values({ name: 'Existing device', token_hash: hashApiToken(deviceToken) });
    const result = await change();
    expect(result.statusCode, result.body).toBe(200);
    expect(result.json()).toEqual({ changed: true });
    const hash = await storedHash();
    expect(hash).not.toBe(originalHash);
    expect(hash).not.toContain(replacement);
    expect(await verifyPassword(replacement, hash)).toBe(true);
    expect((await login(original)).statusCode).toBe(401);
    expect((await login(replacement)).statusCode).toBe(200);
    for (const token of [session, deviceToken]) {
      expect((await app.inject({ url: '/api/auth/me', headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(200);
    }
  });

  it('preserves leading/trailing whitespace and special characters exactly', async () => {
    const password = '  Å/quote" password\n';
    expect((await change({ new_password: password, confirm_password: password })).statusCode).toBe(200);
    expect((await login(password.trim())).statusCode).toBe(401);
    expect((await login(password)).statusCode).toBe(200);
    expect((await change({ current_password: password })).statusCode).toBe(200);
  });

  it('changes only the account identified by the session', async () => {
    const otherId = randomUUID();
    await getDb().insert(auth_user).values({ id: otherId, email: `${otherId}@test.local`, password_hash: originalHash });
    expect((await change()).statusCode).toBe(200);
    expect(await getDb().query.auth_user.findFirst({ where: and(eq(auth_user.id, otherId), eq(auth_user.password_hash, originalHash)) })).toBeDefined();
  });

  it('limits attempts before password verification, including concurrent attempts', async () => {
    const results = await Promise.all(Array.from({ length: 6 }, () => change({ current_password: 'incorrect password' })));
    expect(results.filter((result) => result.statusCode === 400)).toHaveLength(5);
    const blocked = results.filter((result) => result.statusCode === 429);
    expect(blocked).toHaveLength(1);
    expect(Number(blocked[0]!.headers['retry-after'])).toBeGreaterThan(0);
    expect((await change()).statusCode).toBe(429);
    expect(await storedHash()).toBe(originalHash);
  });

  it('does not let concurrent changes overwrite a newer password using the old proof', async () => {
    const passwords = ['first new password', 'second new password'];
    const results = await Promise.all(passwords.map((password) => change({ new_password: password, confirm_password: password })));
    const winner = results.findIndex((result) => result.statusCode === 200);
    expect(winner).toBeGreaterThanOrEqual(0);
    expect(results.filter((result) => result.statusCode === 200)).toHaveLength(1);
    expect([400, 409]).toContain(results[1 - winner]!.statusCode);
    expect(await verifyPassword(passwords[winner]!, await storedHash())).toBe(true);
  });
});
