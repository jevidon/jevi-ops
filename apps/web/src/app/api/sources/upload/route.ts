import { NextResponse } from 'next/server';
import { getAccessToken } from '@/lib/auth';
import { apiUrl } from '@/lib/server-env';
import { SourceSubjectSchema } from '@jevi-ops/shared';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  const token = await getAccessToken();
  if (!token) return NextResponse.json({ error: 'no_session' }, { status: 401 });
  // This cookie-authenticated write uses same-origin browser fetch. Reject
  // cross-origin posts before parsing potentially large multipart bodies.
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return NextResponse.json({ error: 'origin_not_allowed' }, { status: 403 });
  const parsed = SourceSubjectSchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_subject' }, { status: 400 });
  const type = request.headers.get('content-type');
  if (!type?.startsWith('multipart/form-data;')) return NextResponse.json({ error: 'expected_multipart' }, { status: 400 });
  const maximum = 26 * 1024 * 1024;
  if (Number(request.headers.get('content-length')) > maximum) return NextResponse.json({ error: 'source_too_large' }, { status: 413 });
  try {
    if (!request.body) return NextResponse.json({ error: 'source_file_required' }, { status: 400 });
    let received = 0;
    const limited = request.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({ transform(chunk, controller) {
      received += chunk.byteLength;
      if (received > maximum) throw new Error('source_too_large');
      controller.enqueue(chunk);
    } }));
    const upstream = await fetch(`${apiUrl()}/api/sources/upload?${new URLSearchParams(parsed.data as Record<string, string>)}`, {
      method: 'POST', body: limited, duplex: 'half', headers: { Authorization: `Bearer ${token}`, 'Content-Type': type },
      cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(60_000),
    } as RequestInit & { duplex: 'half' });
    const result = await upstream.json();
    return NextResponse.json(result, { status: upstream.status, headers: { 'Cache-Control': 'private, no-store' } });
  } catch { return NextResponse.json({ error: 'source_upload_failed', message: 'Upload failed. Check the 25 MB file limit and retry.' }, { status: 502 }); }
}
