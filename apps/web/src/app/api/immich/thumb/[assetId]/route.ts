import { NextResponse, type NextRequest } from 'next/server';
import { getAccessToken } from '@/lib/auth';
import { apiUrl } from '@/lib/server-env';

// Thumbnail proxy: <img> tags can't send the Bearer the Fastify API
// requires, so the browser hits this Next route (session cookie) and we
// forward server-side with the token. Bytes stream straight through.

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ assetId: string }> },
) {
  const token = await getAccessToken();
  if (!token) return NextResponse.json({ error: 'no_session' }, { status: 401 });
  const { assetId } = await params;

  const upstream = await fetch(`${apiUrl()}/api/immich/thumb/${encodeURIComponent(assetId)}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  if (!upstream.ok || !upstream.body) {
    return NextResponse.json({ error: 'thumb_unavailable' }, { status: upstream.status || 502 });
  }
  return new NextResponse(upstream.body, {
    headers: {
      'Content-Type': upstream.headers.get('content-type') ?? 'image/jpeg',
      'Cache-Control': 'private, max-age=86400',
    },
  });
}
