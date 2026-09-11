import { NextResponse } from 'next/server';
import { getAccessToken } from '@/lib/auth';
import { apiUrl } from '@/lib/server-env';
export const dynamic = 'force-dynamic';
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const token = await getAccessToken();
  if (!token) return NextResponse.json({ error: 'no_session' }, { status: 401 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'invalid_asset' }, { status: 400 });
  try {
    const response = await fetch(`${apiUrl()}/api/assets/${encodeURIComponent(id)}/export.md`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(30_000) });
    if (!response.ok || !response.body) return NextResponse.json({ error: 'export_unavailable' }, { status: response.status >= 400 ? response.status : 502 });
    return new NextResponse(response.body, { headers: { 'Content-Type': 'text/markdown; charset=utf-8', 'Content-Disposition': `attachment; filename="vehicle-${id}.md"`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "sandbox; default-src 'none'" } });
  } catch { return NextResponse.json({ error: 'export_unavailable' }, { status: 502 }); }
}
