import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { app_settings, api_tokens } from '../src/db/schema.js';
import { getDb } from '../src/lib/db.js';
import { getAppSettings, invalidateAppSettings } from '../src/lib/app-settings.js';
import { env } from '../src/lib/env.js';
import { signSession } from '../src/lib/jwt.js';
import { hashApiToken } from '../src/routes/auth.js';
import { activeIntegration, resolveIntegration } from '../src/lib/settings-config.js';
import { maintainSettingsCredentials } from '../src/lib/settings-credential-maintenance.js';
import { openSecret, sealSecret } from '../src/lib/settings-crypto.js';
import { chatComplete } from '../src/lib/llm.js';

const secret = 'settings-test-private-key';
const agentToken = 'ops_settings_agent_0123456789';
const keyA = 'ab'.repeat(32);
const keyB = 'cd'.repeat(32);
let app: FastifyInstance;
let server: Server;
let base: string;
let session: string;
let baseline: typeof app_settings.$inferSelect;
let mode = 'text';
let seen: Array<{ path: string; auth: string | undefined; body: Record<string, unknown> }> = [];
const envBefore = { LLM_PROVIDER: env.LLM_PROVIDER, LLM_BASE_URL: env.LLM_BASE_URL, LLM_MODEL: env.LLM_MODEL, LLM_API_KEY: env.LLM_API_KEY, ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY, STT_BASE_URL: env.STT_BASE_URL, STT_API_KEY: env.STT_API_KEY, IMMICH_BASE_URL: env.IMMICH_BASE_URL, IMMICH_API_KEY: env.IMMICH_API_KEY };
const processBefore = { keys: process.env.SETTINGS_ENCRYPTION_KEYS, active: process.env.SETTINGS_ENCRYPTION_ACTIVE_KEY };

beforeAll(async () => {
  baseline = (await getDb().select().from(app_settings))[0]!;
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (data) => { raw += String(data); });
    req.on('end', () => {
      seen.push({ path: req.url ?? '', auth: req.headers.authorization, body: raw ? JSON.parse(raw) as Record<string, unknown> : {} });
      if (mode === 'redirect') { res.writeHead(302, { location: `${base}/leaked` }); res.end(); return; }
      if (mode === 'huge') { res.end('x'.repeat(3 * 1024 * 1024)); return; }
      if (mode === '401' || mode === '403') { res.writeHead(Number(mode), { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { message: secret } })); return; }
      res.setHeader('content-type', 'application/json');
      if (req.url?.endsWith('/models')) { res.end(JSON.stringify({ data: [{ id: 'candidate-model' }] })); return; }
      const message = mode === 'tools' ? { role: 'assistant', content: null, tool_calls: [{ id: 'test', type: 'function', function: { name: 'connectivity_check', arguments: '{"ok":true}' } }] } : { role: 'assistant', content: mode === 'structured' ? '{"ok":true}' : 'ok' };
      res.end(JSON.stringify({ id: 'test', object: 'chat.completion', created: 0, model: 'test', choices: [{ index: 0, message, finish_reason: 'stop' }] }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  app = await buildServer();
  await app.ready();
  session = await signSession({ id: '00000000-0000-0000-0000-000000000001', email: 'probe@test.local' });
});
beforeEach(async () => {
  process.env.SETTINGS_ENCRYPTION_KEYS = JSON.stringify({ v1: keyA });
  process.env.SETTINGS_ENCRYPTION_ACTIVE_KEY = 'v1';
  Object.assign(env, envBefore, { LLM_PROVIDER: 'openai_compatible', LLM_BASE_URL: undefined, LLM_MODEL: undefined, LLM_API_KEY: undefined, ANTHROPIC_API_KEY: undefined, STT_BASE_URL: undefined, STT_API_KEY: undefined, IMMICH_BASE_URL: undefined, IMMICH_API_KEY: undefined });
  await getDb().update(app_settings).set({ ...baseline, revision: 1, llm_provider: null, llm_base_url: null, llm_model: null, llm_api_key: null, stt_base_url: null, stt_model: null, immich_base_url: null, immich_api_key: null, credential_settings: {}, capability_tests: {} }).where(eq(app_settings.id, true));
  await getDb().insert(api_tokens).values({ name: 'settings-agent', token_hash: hashApiToken(agentToken) });
  invalidateAppSettings();
  mode = 'text'; seen = [];
});
afterAll(async () => {
  await getDb().update(app_settings).set(baseline).where(eq(app_settings.id, true));
  Object.assign(env, envBefore);
  if (processBefore.keys === undefined) delete process.env.SETTINGS_ENCRYPTION_KEYS; else process.env.SETTINGS_ENCRYPTION_KEYS = processBefore.keys;
  if (processBefore.active === undefined) delete process.env.SETTINGS_ENCRYPTION_ACTIVE_KEY; else process.env.SETTINGS_ENCRYPTION_ACTIVE_KEY = processBefore.active;
  invalidateAppSettings();
  await app.close();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
function req(method: 'GET' | 'PATCH' | 'POST', path: string, payload?: unknown, token = session) {
  return app.inject({ method, url: `/api/settings/${path}`, headers: { authorization: `Bearer ${token}` }, ...(payload ? { payload } : {}) });
}
const candidate = () => ({ expected_revision: 1, llm_provider: 'openai_compatible', llm_base_url: `${base}/v1`, llm_model: 'candidate-model', llm_credential: { action: 'replace', value: secret } });

it('encrypts managed keys, redacts GET/PATCH/errors and refuses legacy write fields', async () => {
  const save = await req('PATCH', 'app', candidate());
  expect(save.statusCode).toBe(200);
  expect(save.body).not.toContain(secret);
  expect(save.json()).toMatchObject({ revision: 2, credentials: { llm: { source: 'managed', configured: true } } });
  const row = (await getDb().select().from(app_settings))[0]!;
  expect(row.llm_api_key).toBeNull();
  expect(JSON.stringify(row.credential_settings)).not.toContain(secret);
  expect((await req('GET', 'app')).body).not.toContain('ciphertext');
  expect((await req('GET', 'app')).body).not.toContain('llm_api_key');
  const invalid = await req('PATCH', 'app', { expected_revision: 2, llm_api_key: secret });
  expect(invalid.statusCode).toBe(400); expect(invalid.body).not.toContain(secret);
  mode = '401';
  const failure = await req('POST', 'test-llm');
  expect(failure.statusCode).toBe(502); expect(failure.body).toContain('authentication_failed'); expect(failure.body).not.toContain(secret);
  await expect(chatComplete({ system: 'test', messages: [] })).rejects.toThrow('authentication_failed');
});
it('requires owner sessions for read, mutation and endpoint tests', async () => {
  for (const [method, path] of [['GET', 'app'], ['GET', 'integrations-status'], ['PATCH', 'app'], ['POST', 'test-llm'], ['POST', 'test-stt'], ['POST', 'test-immich']] as const) {
    expect((await req(method, path, method === 'PATCH' ? candidate() : undefined, agentToken)).statusCode).toBe(403);
  }
  expect(seen).toHaveLength(0);
});
it('protects concurrent saves with the expected revision', async () => {
  const replies = await Promise.all([req('PATCH', 'app', { expected_revision: 1, currency: 'NZD' }), req('PATCH', 'app', { expected_revision: 1, currency: 'AUD' })]);
  expect(replies.map((r) => r.statusCode).sort()).toEqual([200, 409]);
  expect((await req('PATCH', 'app', { timezone: 'UTC' })).statusCode).toBe(400);
});
it('tests candidates without changing active configuration and binds independent capability results', async () => {
  const tested = await req('POST', 'test-llm', { candidate: candidate() });
  expect(tested.statusCode).toBe(200);
  expect(seen[0]?.auth).toBe(`Bearer ${secret}`);
  expect(seen[0]?.body.model).toBe('candidate-model');
  const untouched = await getAppSettings();
  expect(untouched.revision).toBe(1); expect(untouched.llm_base_url).toBeNull();
  expect(untouched.credential_settings).toEqual({});
  const saved = await req('PATCH', 'app', candidate());
  expect(saved.json().capabilities.llm.tests).toHaveLength(1);
  const tools = await req('POST', 'test-llm', { capability: 'tools' });
  expect(tools.statusCode).toBe(502); expect(tools.json().error).toBe('tool_call_unsupported');
  mode = 'tools'; expect((await req('POST', 'test-llm', { capability: 'tools' })).statusCode).toBe(200);
  mode = 'structured'; expect((await req('POST', 'test-llm', { capability: 'structured' })).statusCode).toBe(200);
  const changed = await req('PATCH', 'app', { expected_revision: 2, llm_model: 'different-model' });
  expect(changed.json().capabilities.llm.tests).toHaveLength(0);
});
it('does not reuse old keys after endpoint/provider changes and distinguishes clear from environment', async () => {
  expect((await req('PATCH', 'app', candidate())).statusCode).toBe(200);
  const changed = await req('PATCH', 'app', { expected_revision: 2, llm_base_url: `${base}/other` });
  expect(changed.statusCode).toBe(400); expect(changed.json().error).toBe('credential_selection_required');
  const provider = await req('PATCH', 'app', { expected_revision: 2, llm_provider: 'anthropic' });
  expect(provider.statusCode).toBe(400);
  env.LLM_BASE_URL = `${base}/v1`; env.LLM_API_KEY = 'environment-key';
  expect((await req('PATCH', 'app', { expected_revision: 2, llm_base_url: `${base}/other`, llm_credential: { action: 'use_environment' } })).statusCode).toBe(400);
  expect((await req('PATCH', 'app', { expected_revision: 2, llm_base_url: `${base}/other`, llm_credential: { action: 'clear' } })).statusCode).toBe(200);
  expect((await activeIntegration('llm')).apiKey).toBeNull();
  expect((await req('PATCH', 'app', { expected_revision: 3, llm_base_url: `${base}/v1`, llm_credential: { action: 'use_environment' } })).statusCode).toBe(200);
  expect((await activeIntegration('llm')).apiKey).toBe('environment-key');
});
it('fails closed when keys are missing, wrong or swapped, and recovers after restore', async () => {
  await req('PATCH', 'app', candidate());
  env.LLM_BASE_URL = `${base}/v1`; env.LLM_API_KEY = 'must-not-fallback';
  for (const keyring of ['{}', JSON.stringify({ v1: keyB })]) {
    process.env.SETTINGS_ENCRYPTION_KEYS = keyring;
    const settings = await req('GET', 'app');
    expect(settings.json().credentials.llm.state).toBe('locked'); expect(settings.body).not.toContain(secret);
    expect((await req('POST', 'test-llm')).statusCode).toBe(502);
    await expect(activeIntegration('llm')).rejects.toThrow('credential_locked');
  }
  expect(seen).toHaveLength(0);
  process.env.SETTINGS_ENCRYPTION_KEYS = JSON.stringify({ v1: keyA });
  expect((await req('POST', 'test-llm')).statusCode).toBe(200);
  const envelope = sealSecret(secret, 'llm:one');
  expect(() => openSecret(envelope, 'immich:two')).toThrow('credential_locked');
});
it('quarantines legacy plaintext, migrates atomically, rotates and restores backup key versions', async () => {
  await getDb().update(app_settings).set({ llm_base_url: `${base}/v1`, llm_model: 'test', llm_api_key: secret, immich_base_url: base, immich_api_key: 'immich-test-key' }).where(eq(app_settings.id, true));
  expect((await req('GET', 'app')).json().credentials.llm.state).toBe('migration_required');
  delete process.env.SETTINGS_ENCRYPTION_ACTIVE_KEY;
  await expect(maintainSettingsCredentials('migrate')).rejects.toThrow('credential_key_missing');
  expect((await getAppSettings()).llm_api_key).toBe(secret);
  process.env.SETTINGS_ENCRYPTION_ACTIVE_KEY = 'v1';
  expect((await maintainSettingsCredentials('migrate')).changed).toBe(2);
  const backup = await getAppSettings();
  expect(backup.llm_api_key).toBeNull(); expect(backup.immich_api_key).toBeNull();
  expect((await maintainSettingsCredentials('migrate')).changed).toBe(0);
  process.env.SETTINGS_ENCRYPTION_KEYS = JSON.stringify({ v1: keyA, v2: keyB }); process.env.SETTINGS_ENCRYPTION_ACTIVE_KEY = 'v2';
  expect((await maintainSettingsCredentials('rotate')).changed).toBe(2);
  process.env.SETTINGS_ENCRYPTION_KEYS = JSON.stringify({ v2: keyB });
  expect((await activeIntegration('llm')).apiKey).toBe(secret);
  expect(resolveIntegration(backup, 'llm').credential.state).toBe('locked');
  process.env.SETTINGS_ENCRYPTION_KEYS = JSON.stringify({ v1: keyA, v2: keyB });
  expect(resolveIntegration(backup, 'llm').apiKey).toBe(secret);
});
it('rejects credential-bearing URLs and requires explicit non-local HTTP acknowledgement', async () => {
  for (const url of [`http://user:${secret}@127.0.0.1/v1`, `${base}/v1?api_key=${secret}`, 'ftp://127.0.0.1/model']) {
    const res = await req('PATCH', 'app', { ...candidate(), llm_base_url: url });
    expect(res.statusCode).toBe(400); expect(res.body).not.toContain(secret);
  }
  const remote = { ...candidate(), llm_base_url: 'http://100.64.0.1:8080/v1' };
  expect((await req('PATCH', 'app', remote)).statusCode).toBe(400);
  expect((await req('PATCH', 'app', { ...remote, llm_allow_insecure_credentials: true })).statusCode).toBe(200);
  expect(seen).toHaveLength(0);
});
it('refuses credential redirects and oversized provider responses', async () => {
  mode = 'redirect';
  const redirect = await req('POST', 'test-llm', { candidate: candidate() });
  expect(redirect.statusCode).toBe(502); expect(seen).toHaveLength(1); expect(seen[0]?.path).toBe('/v1/chat/completions');
  mode = 'huge';
  const huge = await req('POST', 'test-llm', { candidate: candidate() });
  expect(huge.statusCode).toBe(502); expect(huge.body).not.toContain(secret);
});
it.each(['401', '403'])('STT %s proves neither authentication nor transcription readiness', async (responseMode) => {
  mode = responseMode;
  const result = await req('POST', 'test-stt', { candidate: { expected_revision: 1, stt_base_url: `${base}/v1`, stt_credential: { action: 'replace', value: secret } } });
  expect(result.statusCode).toBe(502); expect(result.json()).toMatchObject({ ok: false, capability: 'stt_reachability', error: 'authentication_failed' });
  expect(result.body).not.toContain(secret);
});
it('labels successful STT models checks as reachability only', async () => {
  const result = await req('POST', 'test-stt', { candidate: { expected_revision: 1, stt_base_url: `${base}/v1`, stt_credential: { action: 'replace', value: secret } } });
  expect(result.statusCode).toBe(200); expect(result.json().detail).toContain('transcription is untested');
});
