// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
const session = vi.hoisted(() => ({ token: 'owner-session-secret' as string | null }));
vi.mock('@/lib/auth', () => ({ getAccessToken: async () => session.token }));
vi.mock('@/lib/server-env', () => ({ apiUrl: () => 'http://api.test' }));
import { GET as sourceDownload } from './sources/[id]/content/route';
import { GET as exportDownload } from './assets/[id]/export/route';
const params = { params: Promise.resolve({ id: '11111111-1111-4111-8111-111111111111' }) };
afterEach(() => { vi.unstubAllGlobals(); session.token = 'owner-session-secret'; });
it.each([sourceDownload, exportDownload])('requires a session before making a private upstream request', async (handler) => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch); session.token = null;
  const response = await handler(new Request('https://app.test/download'), params);
  expect(response.status).toBe(401); expect(fetch).not.toHaveBeenCalled();
});
it.each([sourceDownload, exportDownload])('forwards credentials only to the API and forces private sandboxed download', async (handler) => {
  const fetch = vi.fn(async (_url: string, _init?: RequestInit) => new Response('private-original', { headers: { 'content-type': 'text/html', 'content-disposition': 'inline', 'cache-control': 'public,max-age=3600' } }));
  vi.stubGlobal('fetch', fetch);
  const response = await handler(new Request('https://app.test/download'), params);
  expect(fetch.mock.calls[0]?.[0]).toMatch(/^http:\/\/api\.test\/api\//);
  expect((fetch.mock.calls[0] as unknown as [string, RequestInit])[1]).toMatchObject({ headers: { Authorization: 'Bearer owner-session-secret' }, cache: 'no-store', redirect: 'error' });
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(response.headers.get('content-security-policy')).toContain('sandbox');
  expect(response.headers.get('content-disposition')).toMatch(/^attachment;/);
  expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  expect(await response.text()).toBe('private-original');
});
it('suppresses upstream error bodies that may contain credentials or internal paths', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('owner-session-secret /private/storage/key', { status: 403 })));
  const response = await sourceDownload(new Request('https://app.test/download'), params);
  expect(response.status).toBe(403); expect(await response.text()).toBe('{"error":"source_unavailable"}');
});
