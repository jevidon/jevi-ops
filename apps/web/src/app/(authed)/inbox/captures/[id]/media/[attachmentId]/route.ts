import { getAccessToken } from '@/lib/auth';
import { apiUrl } from '@/lib/server-env';

// Authenticated download of a capture original. The browser has no bearer
// token, so the web server proxies the API's private media route with the
// session token. Never cached; never served from a public directory.

export async function GET(_req: Request, { params }: { params: Promise<{ id: string; attachmentId: string }> }) {
  const { id, attachmentId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id) || !/^[0-9a-f-]{36}$/i.test(attachmentId)) return new Response('Not found', { status: 404 });
  const token = await getAccessToken();
  if (!token) return new Response('Unauthorized', { status: 401 });
  const upstream = await fetch(`${apiUrl()}/api/captures/${id}/media/${attachmentId}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
    redirect: 'error',
  });
  if (!upstream.ok) return new Response('Not found', { status: upstream.status === 404 ? 404 : 502 });
  return new Response(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': upstream.headers.get('content-type') ?? 'application/octet-stream',
      'Content-Disposition': upstream.headers.get('content-disposition') ?? `attachment; filename="${attachmentId}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
