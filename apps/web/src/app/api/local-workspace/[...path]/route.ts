import { NextRequest, NextResponse } from 'next/server';
import { getAccessToken, getUser } from '@/lib/auth';
import { apiUrl } from '@/lib/server-env';

async function forward(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const user = await getUser();
  const token = await getAccessToken();
  if (!user || !token) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  // Next may construct nextUrl with its internal listening host. Compare the
  // browser origin to the public host forwarded by the deployment proxy.
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? request.nextUrl.host;
  const protocol = request.headers.get('x-forwarded-proto') ?? request.nextUrl.protocol.slice(0, -1);
  if (request.method !== 'GET' && request.headers.get('origin') !== `${protocol}://${host}`) return NextResponse.json({ error: 'invalid_origin' }, { status: 403 });
  const { path } = await context.params;
  let target: string;
  if (request.method === 'GET' && path.join('/') === 'snapshot') target = '/api/local-workspace';
  else if (request.method === 'GET' && path.join('/') === 'identity') target = '/api/tasks/sync-state';
  else if (['GET', 'PATCH'].includes(request.method) && path.length === 2 && path[0] === 'tasks' && /^[0-9a-f-]{36}$/i.test(path[1]!)) target = `/api/tasks/${path[1]}`;
  else return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const headers = new Headers({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' });
  for (const name of ['x-operation-id', 'x-task-version', 'x-sync-identity']) { const value = request.headers.get(name); if (value) headers.set(name, value); }
  try {
    const result = await fetch(`${apiUrl()}${target}`, { method: request.method, headers, body: request.method === 'PATCH' ? await request.text() : undefined, cache: 'no-store', signal: AbortSignal.timeout(60_000) });
    return new NextResponse(await result.text(), { status: result.status, headers: { 'Content-Type': result.headers.get('content-type') ?? 'application/json', 'Cache-Control': 'no-store' } });
  } catch { return NextResponse.json({ error: 'sync_unavailable' }, { status: 503 }); }
}
export const GET = forward;
export const PATCH = forward;
