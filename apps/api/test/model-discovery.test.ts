import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { buildServer } from '../src/server.js';
import { signSession } from '../src/lib/jwt.js';
import { getDb } from '../src/lib/db.js';
import { env } from '../src/lib/env.js';
import { app_settings } from '../src/db/schema.js';
import { invalidateAppSettings } from '../src/lib/app-settings.js';

let app: FastifyInstance;
let session: string;
const fetchMock = vi.fn<typeof fetch>();
const originalEnv = {
  LLM_PROVIDER: env.LLM_PROVIDER,
  LLM_BASE_URL: env.LLM_BASE_URL,
  LLM_API_KEY: env.LLM_API_KEY,
  LLM_MODEL: env.LLM_MODEL,
};
let originalSettings: Pick<typeof app_settings.$inferSelect, 'llm_provider' | 'llm_base_url' | 'llm_model' | 'llm_api_key'>;

beforeAll(async () => {
  const row = (await getDb().select().from(app_settings))[0]!;
  originalSettings = { llm_provider: row.llm_provider, llm_base_url: row.llm_base_url, llm_model: row.llm_model, llm_api_key: row.llm_api_key };
  app = await buildServer();
  await app.ready();
  session = await signSession({ id: '00000000-0000-0000-0000-000000000001', email: 'probe@test.local' });
});

beforeEach(async () => {
  Object.assign(env, { LLM_PROVIDER: 'openai_compatible', LLM_BASE_URL: 'https://env.example/v1/', LLM_API_KEY: 'env-key', LLM_MODEL: undefined });
  await getDb().update(app_settings).set({ llm_provider: null, llm_base_url: null, llm_model: null, llm_api_key: null }).where(eq(app_settings.id, true));
  invalidateAppSettings();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => vi.unstubAllGlobals());
afterAll(async () => {
  Object.assign(env, originalEnv);
  await getDb().update(app_settings).set(originalSettings).where(eq(app_settings.id, true));
  invalidateAppSettings();
  await app.close();
});

function discover(baseUrl?: string, authenticated = true) {
  return app.inject({
    method: 'GET',
    url: `/api/settings/discover-llm-models${baseUrl === undefined ? '' : `?base_url=${encodeURIComponent(baseUrl)}`}`,
    headers: authenticated ? { authorization: `Bearer ${session}` } : {},
  });
}

describe('GET /api/settings/discover-llm-models', () => {
  it('requires authentication before probing', async () => {
    expect((await discover('http://localhost:8080/v1', false)).statusCode).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('normalizes the query URL, forwards the stored key and sorts/deduplicates loaded models first', async () => {
    await getDb().update(app_settings).set({ llm_base_url: 'http://stored:8080/v1', llm_api_key: 'stored-key' });
    fetchMock.mockResolvedValue(Response.json({ data: [
      { id: 'z-loaded', loaded: true }, { id: 'b' }, { id: 'a' }, { id: 'a', loaded: false },
      { id: 'c-loaded', loaded: true }, { id: 'z-loaded', loaded: false },
      { id: 12 }, {}, null, 'ignored',
    ] }));
    const response = await discover('http://127.0.0.1:8080/v1///');
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      ok: true, base_url: 'http://127.0.0.1:8080/v1',
      models: ['c-loaded', 'z-loaded', 'a', 'b'], loaded: ['c-loaded', 'z-loaded'],
    });
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:8080/v1/models', {
      headers: { Authorization: 'Bearer stored-key' }, redirect: 'manual', signal: expect.any(AbortSignal),
    });
  });

  it('uses the stored base URL ahead of the environment without requiring a model', async () => {
    await getDb().update(app_settings).set({ llm_base_url: 'http://stored:8080/v1/' });
    fetchMock.mockResolvedValue(Response.json({ data: [{ id: 'single' }] }));
    expect((await discover()).json()).toEqual({ ok: true, base_url: 'http://stored:8080/v1', models: ['single'] });
  });

  it('falls back to environment URL/key and accepts an empty list', async () => {
    fetchMock.mockResolvedValue(Response.json({ data: [] }));
    expect((await discover()).json()).toEqual({ ok: true, base_url: 'https://env.example/v1', models: [] });
    expect(fetchMock).toHaveBeenCalledWith('https://env.example/v1/models', expect.objectContaining({ headers: { Authorization: 'Bearer env-key' } }));
  });

  it('does not send a bearer header when no key is configured', async () => {
    env.LLM_API_KEY = undefined;
    fetchMock.mockResolvedValue(Response.json({ data: [{ id: 'local', loaded: false }] }));
    expect((await discover()).json().loaded).toEqual([]);
    expect(fetchMock.mock.calls[0]![1]!.headers).toEqual({});
  });

  it('can discover before an unsaved switch away from Anthropic', async () => {
    await getDb().update(app_settings).set({ llm_provider: 'anthropic' });
    fetchMock.mockResolvedValue(Response.json({ data: [] }));
    expect((await discover()).json().ok).toBe(true);
    expect(fetchMock.mock.calls[0]![1]!.headers).toEqual({ Authorization: 'Bearer env-key' });
  });

  it.each(['ftp://localhost/v1', 'file:///etc/passwd', 'not a URL', '', 'http://user:password@localhost/v1', 'http://localhost/v1?other=1', 'http://localhost/v1#fragment'])('rejects an invalid base URL: %s', async (url) => {
    const response = await discover(url);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ ok: false, error: 'discover_bad_payload', detail: expect.any(String) });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects repeated query parameters', async () => {
    const response = await app.inject({ url: '/api/settings/discover-llm-models?base_url=http://a&base_url=http://b', headers: { authorization: `Bearer ${session}` } });
    expect(response.json().ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns a timeout envelope', async () => {
    fetchMock.mockRejectedValue(new DOMException('Timed out', 'TimeoutError'));
    const response = await discover();
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ ok: false, error: 'discover_timeout', detail: expect.stringContaining('5 seconds') });
  });

  it.each([500, 401, 302])('returns an HTTP %i envelope without reading the body or following redirects', async (status) => {
    fetchMock.mockResolvedValue(new Response('upstream details', { status, headers: { location: 'https://other.example/models' } }));
    const response = await discover();
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: false, error: `discover_http_${status}`, detail: `Model server returned HTTP ${status}.` });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each(['not JSON', 'null', '{}', '{"data":{}}'])('handles malformed payload: %s', async (payload) => {
    fetchMock.mockResolvedValue(new Response(payload));
    const response = await discover();
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ ok: false, error: 'discover_bad_payload', detail: expect.any(String) });
  });

  it('handles an unreachable server', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    const response = await discover();
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: false, error: 'discover_bad_payload', detail: 'fetch failed' });
  });

  it('caps streaming responses even without Content-Length and cancels the stream', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream({
      pull(controller) { controller.enqueue(new Uint8Array(600_000)); },
      cancel,
    });
    fetchMock.mockResolvedValue(new Response(body));
    const response = await discover();
    expect(response.json()).toMatchObject({ ok: false, error: 'discover_bad_payload', detail: expect.stringContaining('1 MiB') });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('saving a discovered model invalidates the cache and immediately configures health', async () => {
    expect((await app.inject('/healthz')).json().llm_configured).toBe(false);
    fetchMock.mockResolvedValue(Response.json({ data: [{ id: 'mlx-community/Qwen3.5-9B-MLX-4bit', loaded: true }] }));
    const result = (await discover()).json();
    const saved = await app.inject({
      method: 'PATCH', url: '/api/settings/app', headers: { authorization: `Bearer ${session}` },
      payload: { llm_base_url: result.base_url, llm_model: result.models[0] },
    });
    expect(saved.statusCode).toBe(200);
    expect((await app.inject('/healthz')).json().llm_configured).toBe(true);
  });
});
