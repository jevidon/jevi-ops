// Public env vars used by the Supabase clients. Read once, fail loudly if
// missing — Supabase will produce confusing errors deep in the stack
// otherwise.

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `[supabase] ${name} is not set. Add it to .env (see .env.example). ` +
      'These two NEXT_PUBLIC_* vars duplicate SUPABASE_URL and SUPABASE_ANON_KEY.',
    );
  }
  return value;
}

export const SUPABASE_URL = required('NEXT_PUBLIC_SUPABASE_URL', process.env.NEXT_PUBLIC_SUPABASE_URL);
export const SUPABASE_ANON_KEY = required('NEXT_PUBLIC_SUPABASE_ANON_KEY', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
