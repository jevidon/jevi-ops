'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { SESSION_COOKIE, sessionCookieOptions } from '@/lib/session';
import { apiUrl } from '@/lib/server-env';

const SignInSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  next: z.string().optional(),
});

export async function signInAction(_prev: { error?: string } | null, formData: FormData) {
  const parsed = SignInSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
    next: formData.get('next') ?? '/today',
  });
  if (!parsed.success) {
    return { error: 'Email and password are required.' };
  }

  // The API owns the credential store — it verifies the password and mints
  // the session JWT. We just stash the token in an HttpOnly cookie.
  let res: Response;
  try {
    res = await fetch(`${apiUrl()}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: parsed.data.email, password: parsed.data.password }),
      cache: 'no-store',
    });
  } catch {
    return { error: 'Could not reach the API. Is it running?' };
  }

  if (!res.ok) {
    if (res.status === 401) return { error: 'Invalid email or password.' };
    if (res.status === 429) return { error: 'Too many attempts — wait a minute and try again.' };
    if (res.status === 503) return { error: 'Sign-in is not configured yet (AUTH_SECRET missing on the API).' };
    return { error: `Sign-in failed (${res.status}).` };
  }

  const body = (await res.json()) as { token?: string };
  if (!body.token) {
    return { error: 'Sign-in failed: no token returned.' };
  }

  const store = await cookies();
  store.set(SESSION_COOKIE, body.token, sessionCookieOptions());

  revalidatePath('/', 'layout');
  const target = parsed.data.next && parsed.data.next.startsWith('/') ? parsed.data.next : '/today';
  redirect(target);
}

export async function signOutAction() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  revalidatePath('/', 'layout');
  redirect('/sign-in');
}
