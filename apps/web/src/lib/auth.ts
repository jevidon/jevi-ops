import { cache } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, verifySessionToken } from './session';

// Server-only helpers. Throw / redirect when there's no session. Use inside
// Server Components and Server Actions. Signatures unchanged from the
// Supabase era — consumers (layout, AccountChip, api.ts) need no edits.

export const getUser = cache(async (): Promise<{ id: string; email: string } | null> => {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const claims = await verifySessionToken(token);
  if (!claims) return null;
  return { id: claims.sub, email: claims.email };
});

export async function requireUser() {
  const user = await getUser();
  if (!user) redirect('/sign-in');
  return user;
}

// Returns the session token (JWT) for forwarding to the Fastify API.
// Null if there's no session. The API verifies the same HS256 signature.
export async function getAccessToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(SESSION_COOKIE)?.value ?? null;
}
