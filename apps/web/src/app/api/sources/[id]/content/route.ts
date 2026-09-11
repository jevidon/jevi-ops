import { NextResponse } from 'next/server';
import { getAccessToken } from '@/lib/auth';
import { apiUrl } from '@/lib/server-env';
export const dynamic = 'force-dynamic';
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const token = await getAccessToken();
  if (!token) return NextResponse.json({ error: 'no_session' }, { status: 401 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'invalid_source' }, { status: 400 });
  try {
    const upstream = await fetch(`${apiUrl()}/api/sources/${encodeURIComponent(id)}/content`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(30_000) });
    if (!upstream.ok || !upstream.body) return NextResponse.json({ error: 'source_unavailable' }, { status: upstream.status >= 400 ? upstream.status : 502 });
    const disposition = upstream.headers.get('content-disposition');
    return new NextResponse(upstream.body, { headers: {
      'Content-Type': upstream.headers.get('content-type') ?? 'application/octet-stream',
      'Content-Disposition': disposition?.startsWith('attachment;') ? disposition : 'attachment; filename="source"',
      'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "sandbox; default-src 'none'",
    } });
  } catch { return NextResponse.json({ error: 'source_unavailable' }, { status: 502 }); }
}
