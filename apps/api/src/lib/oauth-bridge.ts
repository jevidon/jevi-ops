import { createHmac, timingSafeEqual } from 'node:crypto';

// OAuth-begin bridge — verifies short-lived tokens minted by the web app.
//
// Why: the Google OAuth begin endpoint is hit via `<a href>` navigation, so
// the browser can't send the Supabase Bearer header. On a public deployment
// that would mean anyone in the world could initiate Jerad's OAuth flow.
//
// The web app (which DOES have the Supabase session) mints a short-lived
// HMAC-signed token containing { user_id, exp } and redirects the browser
// to /api/auth/google?t=<token>. The API verifies HMAC + exp, then uses
// user_id as the authenticated identity for this single redirect.
//
// Token format: base64url(payload_json) + '.' + base64url(hmac_sha256)

export interface OAuthBridgeClaims {
  user_id: string;
  exp: number; // unix seconds
}

const ENCODER = new TextEncoder();

function b64urlEncode(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

function b64urlDecode(s: string): Uint8Array {
  return Buffer.from(s, 'base64url');
}

export function signOAuthBridgeToken(claims: OAuthBridgeClaims, secret: string): string {
  const payloadJson = JSON.stringify(claims);
  const payloadB64 = b64urlEncode(ENCODER.encode(payloadJson));
  const sig = createHmac('sha256', secret).update(payloadB64).digest();
  return `${payloadB64}.${b64urlEncode(sig)}`;
}

export function verifyOAuthBridgeToken(
  token: string,
  secret: string,
): { ok: true; claims: OAuthBridgeClaims } | { ok: false; reason: string } {
  const parts = token.split('.');
  if (parts.length !== 2) return { ok: false, reason: 'malformed' };
  const [payloadB64, sigB64] = parts as [string, string];

  // Recompute the signature and compare in constant time.
  const expectedSig = createHmac('sha256', secret).update(payloadB64).digest();
  let providedSig: Uint8Array;
  try {
    providedSig = b64urlDecode(sigB64);
  } catch {
    return { ok: false, reason: 'bad_signature_encoding' };
  }
  if (providedSig.length !== expectedSig.length) return { ok: false, reason: 'bad_signature' };
  if (!timingSafeEqual(providedSig, expectedSig)) return { ok: false, reason: 'bad_signature' };

  let claims: OAuthBridgeClaims;
  try {
    const payloadStr = new TextDecoder().decode(b64urlDecode(payloadB64));
    claims = JSON.parse(payloadStr) as OAuthBridgeClaims;
  } catch {
    return { ok: false, reason: 'bad_payload' };
  }
  if (typeof claims.user_id !== 'string' || typeof claims.exp !== 'number') {
    return { ok: false, reason: 'bad_claims' };
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (claims.exp < nowSec) return { ok: false, reason: 'expired' };
  // Sanity: reject tokens whose exp is unreasonably far in the future.
  if (claims.exp - nowSec > 600) return { ok: false, reason: 'exp_too_far' };

  return { ok: true, claims };
}
