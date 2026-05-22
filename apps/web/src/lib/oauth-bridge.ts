import 'server-only';
import { createHmac } from 'node:crypto';

// Mints short-lived HMAC-signed bridge tokens for the Google OAuth begin
// endpoint on the API. See apps/api/src/lib/oauth-bridge.ts for the
// matching verifier — keep these two in sync.
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

export function signOAuthBridgeToken(claims: OAuthBridgeClaims, secret: string): string {
  const payloadJson = JSON.stringify(claims);
  const payloadB64 = b64urlEncode(ENCODER.encode(payloadJson));
  const sig = createHmac('sha256', secret).update(payloadB64).digest();
  return `${payloadB64}.${b64urlEncode(sig)}`;
}
