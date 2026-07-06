import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from './env.js';

// Auth-only Supabase client. All data access moved to Drizzle (lib/db.ts);
// the sole remaining use is plugins/auth.ts calling auth.getUser(token) to
// verify the session JWT. Phase B removes this file entirely in favor of
// self-issued jose tokens.

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

export function isSupabaseConfigured(): boolean {
  return Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);
}
