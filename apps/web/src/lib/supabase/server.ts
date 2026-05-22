import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './env';

type CookieToSet = { name: string; value: string; options: CookieOptions };

// Server-side Supabase client. Reads cookies via next/headers; the setAll
// branch is needed for server actions / route handlers that refresh the
// session. In RSC (Server Components) you can't mutate cookies — the catch
// makes that fail silently, which is the documented @supabase/ssr pattern.

export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: CookieToSet[]) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component. Middleware refreshes the session;
          // this is fine.
        }
      },
    },
  });
}
