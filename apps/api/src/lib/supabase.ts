import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from './env.js';

// Two clients:
//   * supabaseAdmin uses the service-role key. Bypasses RLS — only used by
//     backend cron jobs, autonomous actions, and the ingest endpoint.
//   * supabaseFor(userJwt) returns a client scoped to a user's JWT. Used for
//     request handlers so RLS is enforced.

let _admin: SupabaseClient | null = null;

export function supabaseAdmin(): SupabaseClient {
  if (_admin) return _admin;
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      'Supabase admin client requested but SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set. ' +
      'Add them to .env (see .env.example).'
    );
  }
  _admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _admin;
}

export function supabaseFor(userJwt: string): SupabaseClient {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    throw new Error('SUPABASE_URL / SUPABASE_ANON_KEY not set');
  }
  return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${userJwt}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function isSupabaseConfigured(): boolean {
  return Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);
}
