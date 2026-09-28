// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
vi.mock('@/lib/auth', () => ({ getUser: async () => ({ id: 'owner' }), getAccessToken: async () => 'test-token' }));
vi.mock('@/lib/server-env', () => ({ apiUrl: () => 'http://api.internal:3001' }));
import { GET, PATCH } from './route';
const id = '11111111-2222-4333-8444-555555555555';
const context = { params: Promise.resolve({ path: ['tasks', id] }) };
afterEach(() => vi.unstubAllGlobals());
describe('workspace proxy', () => {
  it('accepts the public proxy origin and forwards only the operation headers', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ id }), { headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetcher);
    const request = new NextRequest(`http://localhost:3000/api/local-workspace/tasks/${id}`, { method: 'PATCH', headers: { host: 'localhost:3000', 'x-forwarded-host': 'almanac.example.test', 'x-forwarded-proto': 'https', origin: 'https://almanac.example.test', 'x-operation-id': 'operation', 'x-task-version': 'version', 'x-sync-identity': 'identity' }, body: '{"title":"Saved"}' });
    expect((await PATCH(request, context)).status).toBe(200);
    const forwarded = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(forwarded[0]).toBe(`http://api.internal:3001/api/tasks/${id}`);
    const headers = forwarded[1].headers as Headers;
    expect(headers.get('x-operation-id')).toBe('operation');
    expect(headers.get('authorization')).toBe('Bearer test-token');
    expect(headers.has('origin')).toBe(false);
    expect(forwarded[1].body).toBe('{"title":"Saved"}');
  });
  it('rejects a cross-origin write before contacting the API', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    const request = new NextRequest(`https://almanac.example.test/api/local-workspace/tasks/${id}`, { method: 'PATCH', headers: { host: 'almanac.example.test', origin: 'https://another.example.test' }, body: '{}' });
    expect((await PATCH(request, context)).status).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('does not expose an arbitrary API path', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    expect((await GET(new NextRequest('https://almanac.example.test/api/local-workspace/settings'), { params: Promise.resolve({ path: ['settings'] }) })).status).toBe(404);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
