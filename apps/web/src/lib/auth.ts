import { redirect } from 'next/navigation';
import { createClient } from './supabase/server';

// Server-only helpers. Throw / redirect when there's no session. Use inside
// Server Components and Server Actions.

export async function getUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

export async function requireUser() {
  const user = await getUser();
  if (!user) redirect('/sign-in');
  return user;
}

// Returns the access token (JWT) for forwarding to the Fastify API.
// Null if there's no session.
export async function getAccessToken(): Promise<string | null> {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}
