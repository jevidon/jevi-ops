import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { CAPTURE_CLIENT_SCOPES } from '@jevi-ops/shared';
import { buildServer } from '../src/server.js';
import { signSession } from '../src/lib/jwt.js';
import { hashApiToken } from '../src/routes/auth.js';
import { getDb } from '../src/lib/db.js';
import { api_tokens } from '../src/db/schema.js';

// Credential boundary for capture_client tokens (migration 0053): default
// denied on every route that does not declare a captureScope, admitted only
// on routes that do, and only with the matching scope granted. Legacy tokens
// and sessions are unaffected.

let app: FastifyInstance;
let session: string;
const CAPTURE_TOKEN = 'ops_test_capture_client_0123456789';
const READ_ONLY_TOKEN = 'ops_test_capture_readonly_0123456789';
const LEGACY_TOKEN = 'ops_test_legacy_token_0123456789';

beforeAll(async () => {
  app = await buildServer();
  // Probe routes registered before ready(): the real capture routes land in
  // PR2; this proves the plugin's positive path independently of them.
  app.get('/test/capture-scope/write', { config: { captureScope: 'capture:write' }, preHandler: app.requireAuth }, async (req) => ({ ok: true, profile: req.permissionProfile, credential: req.credentialId, scopes: req.captureScopes ?? null }));
  app.get('/test/capture-scope/read', { config: { captureScope: 'capture:read' }, preHandler: app.requireAuth }, async () => ({ ok: true }));
  app.get('/test/no-scope', { preHandler: app.requireAuth }, async () => ({ ok: true }));
  await app.ready();
  session = await signSession({ id: '00000000-0000-0000-0000-000000000001', email: 'probe@test.local' });
});
afterAll(async () => { await app.close(); });

beforeEach(async () => {
  await getDb().insert(api_tokens).values([
    { name: 'capture-full', token_hash: hashApiToken(CAPTURE_TOKEN), permission_profile: 'capture_client', scopes: [...CAPTURE_CLIENT_SCOPES] },
    { name: 'capture-read', token_hash: hashApiToken(READ_ONLY_TOKEN), permission_profile: 'capture_client', scopes: ['capture:read'] },
    { name: 'legacy', token_hash: hashApiToken(LEGACY_TOKEN) },
  ]);
});

function req(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, token: string, body?: unknown) {
  return app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, ...(body === undefined ? {} : { payload: body }) });
}

describe('capture_client credential boundary', () => {
  it('is denied on existing routes that never declared a capture scope', async () => {
    for (const [method, path, body] of [
      ['GET', '/api/tasks', undefined], ['POST', '/api/tasks', { title: 'escalation' }],
      ['GET', '/api/settings/app', undefined], ['GET', '/api/projects', undefined],
['POST', '/api/auth/tokens', { name: 'escalation' }],
      ['GET', '/api/auth/tokens', undefined], ['GET', '/test/no-scope', undefined],
    ] as const) {
      const res = await req(method, path, CAPTURE_TOKEN, body);
      expect(res.statusCode, `${method} ${path}: ${res.body}`).toBe(403);
      expect(res.json().error).toBe('capture_scope_denied');
    }
  });

  it('is admitted on a route declaring a granted scope and carries its identity', async () => {
    const res = await req('GET', '/test/capture-scope/write', CAPTURE_TOKEN);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.profile).toBe('capture_client');
    expect(body.scopes).toEqual([...CAPTURE_CLIENT_SCOPES]);
    expect(typeof body.credential).toBe('string');
  });

  it('is denied on a scoped route when that scope was not granted', async () => {
    expect((await req('GET', '/test/capture-scope/read', READ_ONLY_TOKEN)).statusCode).toBe(200);
    const res = await req('GET', '/test/capture-scope/write', READ_ONLY_TOKEN);
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('capture_scope_denied');
  });

  it('leaves legacy tokens and sessions untouched, including on scoped routes', async () => {
    expect((await req('GET', '/test/no-scope', LEGACY_TOKEN)).statusCode).toBe(200);
    expect((await req('GET', '/test/capture-scope/write', LEGACY_TOKEN)).statusCode).toBe(200);
    expect((await req('GET', '/test/capture-scope/write', session)).statusCode).toBe(200);
    expect((await req('GET', '/api/tasks', LEGACY_TOKEN)).statusCode).toBe(200);
  });
});

describe('minting capture_client tokens', () => {
  it('defaults to both capture scopes and refuses unknown scopes', async () => {
    const created = await req('POST', '/api/auth/tokens', session, { name: 'phone', kind: 'device', permission_profile: 'capture_client' });
    expect(created.statusCode, created.body).toBe(201);
    expect(created.json()).toMatchObject({ permission_profile: 'capture_client', scopes: [...CAPTURE_CLIENT_SCOPES] });
    expect(created.json().token).toMatch(/^ops_/);

    const narrow = await req('POST', '/api/auth/tokens', session, { name: 'reader', permission_profile: 'capture_client', scopes: ['capture:read'] });
    expect(narrow.statusCode).toBe(201);
    expect(narrow.json().scopes).toEqual(['capture:read']);

    const researchScope = await req('POST', '/api/auth/tokens', session, { name: 'bad', permission_profile: 'capture_client', scopes: ['research:claim'] });
    expect(researchScope.statusCode).toBe(400);
    const legacyWithScopes = await req('POST', '/api/auth/tokens', session, { name: 'bad', scopes: ['capture:read'] });
    expect(legacyWithScopes.statusCode).toBe(400);
  });

  it('cannot be minted by a capture_client token', async () => {
    const res = await req('POST', '/api/auth/tokens', CAPTURE_TOKEN, { name: 'escalation', permission_profile: 'capture_client' });
    expect(res.statusCode).toBe(403);
  });
});
