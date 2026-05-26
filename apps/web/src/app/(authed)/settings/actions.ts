'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { calendarApi, googleApi, settingsApi, ApiError } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { signOAuthBridgeToken } from '@/lib/oauth-bridge';

export interface SyncResult {
  ok: boolean;
  message: string;
}

export async function syncCalendarAction(): Promise<SyncResult> {
  try {
    const res = await calendarApi.pull();
    revalidatePath('/today');
    revalidatePath('/calendar');
    revalidatePath('/settings');
    const parts = [
      `Pulled ${res.events_upserted}/${res.events_fetched} from Google`,
    ];
    if (res.events_deleted > 0) {
      parts.push(`removed ${res.events_deleted} deleted`);
    }
    if (res.orphans_pushed > 0) {
      parts.push(`pushed ${res.orphans_pushed} local-only up`);
    }
    if (res.orphans_failed > 0) {
      parts.push(`${res.orphans_failed} push failed`);
    }
    return { ok: true, message: parts.join(' · ') + '.' };
  } catch (err) {
    if (err instanceof ApiError) {
      const body = err.body as { error?: string } | null;
      return { ok: false, message: body?.error ?? `HTTP ${err.status}` };
    }
    return { ok: false, message: (err as Error).message };
  }
}

// Mints a short-lived HMAC-signed bridge token tying the current Supabase
// user to the OAuth begin redirect, then sends the browser to the API.
//
// Why a server action and not an <a href>: anchors send no Authorization
// header on cross-origin navigations, so the API has no way to know who
// initiated the flow. The bridge token solves that without exposing the
// Supabase access token in a URL.
export async function beginGoogleOAuthAction(): Promise<void> {
  const user = await requireUser();
  const secret = process.env.OAUTH_BRIDGE_SECRET;
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

  // Dev fallback — if no secret is configured, send the user straight to
  // the begin endpoint without a token. The API mirrors this fallback in
  // dev mode (see apps/api/src/routes/google-auth.ts).
  if (!secret) {
    redirect(`${apiUrl}/api/auth/google`);
  }

  const expSec = Math.floor(Date.now() / 1000) + 60; // 60 second window
  const token = signOAuthBridgeToken({ user_id: user.id, exp: expSec }, secret);
  redirect(`${apiUrl}/api/auth/google?t=${encodeURIComponent(token)}`);
}

export async function updateTimezoneAction(formData: FormData): Promise<SyncResult> {
  const tz = String(formData.get('timezone') ?? '').trim();
  if (!tz) return { ok: false, message: 'Timezone is required.' };
  // Validate against the runtime's known timezone list — Intl will throw
  // when formatting with a bogus zone, so reject up-front for a nice
  // error message rather than silently saving garbage.
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date());
  } catch {
    return { ok: false, message: `"${tz}" isn't a valid IANA timezone.` };
  }
  try {
    await settingsApi.updateApp({ timezone: tz });
  } catch (err) {
    if (err instanceof ApiError) {
      const body = err.body as { error?: string } | null;
      return { ok: false, message: body?.error ?? `HTTP ${err.status}` };
    }
    return { ok: false, message: (err as Error).message };
  }
  // Settings can ripple through every page — easier to invalidate the
  // layout cache than enumerate every consumer.
  revalidatePath('/', 'layout');
  return { ok: true, message: `Timezone set to ${tz}.` };
}

export async function disconnectGoogleAction(): Promise<SyncResult> {
  try {
    await googleApi.disconnect();
    revalidatePath('/settings');
    return { ok: true, message: 'Google Calendar disconnected.' };
  } catch (err) {
    if (err instanceof ApiError) {
      return { ok: false, message: `HTTP ${err.status}` };
    }
    return { ok: false, message: (err as Error).message };
  }
}
