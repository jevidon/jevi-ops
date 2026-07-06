import { SignJWT, jwtVerify } from 'jose';

// Session-token helpers shared by lib/auth.ts (Node runtime) and
// middleware.ts (edge runtime). MUST stay jose-only — no node:crypto, no
// imports that drag Node built-ins into the middleware bundle.
//
// Tokens are minted by the API's /api/auth/login (same AUTH_SECRET, HS256);
// the middleware re-signs for sliding renewal past the half-life.

export const SESSION_COOKIE = 'ops_session';
export const SESSION_TTL_S = 30 * 24 * 60 * 60; // 30 days
const ISSUER = 'jevi-ops';

export interface SessionClaims {
  sub: string;
  email: string;
  iat: number;
  exp: number;
}

function secretKey(): Uint8Array | null {
  const secret = process.env.AUTH_SECRET;
  if (!secret) return null;
  return new TextEncoder().encode(secret);
}

export async function verifySessionToken(token: string): Promise<SessionClaims | null> {
  const key = secretKey();
  if (!key) return null;
  try {
    const { payload } = await jwtVerify(token, key, { issuer: ISSUER });
    if (typeof payload.sub !== 'string' || typeof payload.email !== 'string') return null;
    return {
      sub: payload.sub,
      email: payload.email,
      iat: payload.iat ?? 0,
      exp: payload.exp ?? 0,
    };
  } catch {
    return null;
  }
}

/** Re-issue a fresh token for the same identity (sliding renewal). */
export async function signSessionToken(claims: Pick<SessionClaims, 'sub' | 'email'>): Promise<string | null> {
  const key = secretKey();
  if (!key) return null;
  return new SignJWT({ email: claims.email })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_S}s`)
    .sign(key);
}

export function sessionCookieOptions() {
  return {
    httpOnly: true as const,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_TTL_S,
  };
}
