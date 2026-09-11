import { NextResponse } from 'next/server';
import { getAccessToken } from '@/lib/auth';
import { apiUrl } from '@/lib/server-env';
export const dynamic = 'force-dynamic';
export async function GET() {
  const token = await getAccessToken();
  if (!token) return NextResponse.json({ error: 'no_session' }, { status: 401 });
  try {
    const response = await fetch(`${apiUrl()}/api/research/setup-guide`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15_000) });
    if (!response.ok || !response.body) return NextResponse.json({ error: 'worker_guide_unavailable' }, { status: response.status >= 400 ? response.status : 502 });
    return new NextResponse(response.body, { headers: { 'Content-Type': 'text/markdown; charset=utf-8', 'Content-Disposition': 'attachment; filename="hermes-worker-setup.md"', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "sandbox; default-src 'none'" } });
  } catch { return NextResponse.json({ error: 'worker_guide_unavailable' }, { status: 502 }); }
}
