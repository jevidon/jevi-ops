import { NextResponse, type NextRequest } from 'next/server';
import {
  SESSION_COOKIE,
  sessionCookieOptions,
  signSessionToken,
  verifySessionToken,
} from '@/lib/session';

// Runs on every page request. Verifies the session cookie locally (jose,
// edge-compatible — no network round-trip), redirects unauthenticated
// requests on protected paths, and re-issues the token once it's past half
// its lifetime so an active user never gets logged out.

const PUBLIC_PATHS = ['/sign-in', '/sign-out', '/auth'];

export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC_PATHS.some((p) => path === p || path.startsWith(p + '/'));

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const claims = token ? await verifySessionToken(token) : null;

  if (!claims && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = '/sign-in';
    url.searchParams.set('next', path);
    return NextResponse.redirect(url);
  }

  const response = NextResponse.next({ request });

  // Sliding renewal: past 50% of the token's lifetime, mint a fresh one.
  if (claims) {
    const nowS = Math.floor(Date.now() / 1000);
    const age = nowS - claims.iat;
    const lifetime = claims.exp - claims.iat;
    if (lifetime > 0 && age > lifetime / 2) {
      const fresh = await signSessionToken(claims);
      if (fresh) response.cookies.set(SESSION_COOKIE, fresh, sessionCookieOptions());
    }
  }

  return response;
}

// Run on every page request except Next internals, static assets, and the
// favicon. Don't include the API routes (we have none locally), images, etc.
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg|manifest.webmanifest|.*\\.(?:png|jpg|jpeg|gif|svg|webp)).*)'],
};
