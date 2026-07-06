import { SignJWT, jwtVerify } from 'jose';
import { env } from './env.js';

// Self-issued session tokens (HS256 via jose). The same AUTH_SECRET signs
// on the API and verifies in the web app's middleware (jose is
// edge-compatible), so one login works across both.

const SESSION_TTL = '30d';
const ISSUER = 'jevi-ops';

export interface SessionClaims {
  sub: string;    // auth_user.id
  email: string;
  iat: number;
  exp: number;
}

function secretKey(): Uint8Array {
  if (!env.AUTH_SECRET) {
    throw new Error('AUTH_SECRET is not set. Generate one with: openssl rand -hex 32');
  }
  return new TextEncoder().encode(env.AUTH_SECRET);
}

export function isAuthConfigured(): boolean {
  return Boolean(env.AUTH_SECRET);
}

export async function signSession(user: { id: string; email: string }): Promise<string> {
  return new SignJWT({ email: user.email })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(SESSION_TTL)
    .sign(secretKey());
}

export async function verifySession(token: string): Promise<SessionClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(), { issuer: ISSUER });
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
