'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { apiPublicUrl } from '@/lib/server-env';
import { authApi, calendarApi, googleApi, settingsApi, ApiError, type UpdateAppSettingsBody } from '@/lib/api';
import { BriefingPanelConfigSchema } from '@jevi-ops/shared/schemas';
import { requireUser } from '@/lib/auth';
import { signOAuthBridgeToken } from '@/lib/oauth-bridge';

export interface SyncResult {
  ok: boolean;
  message: string;
}

export async function syncCalendarAction(): Promise<SyncResult> {
  try {
    const res = await calendarApi.pull();
    revalidatePath('/');
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
  const apiUrl = apiPublicUrl();

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

// Frame panel image URL (migration 0045) + Weather data-bundle URL (0046).
// Empty string clears → null (the shared ClearableUrl transform) which
// hides the respective panel.
export async function updateFrameUrlAction(formData: FormData): Promise<SyncResult> {
  const url = String(formData.get('agenda_image_url') ?? '').trim();
  const dataUrl = String(formData.get('agenda_data_url') ?? '').trim();
  for (const u of [url, dataUrl]) {
    if (u && !/^https?:\/\//.test(u)) {
      return { ok: false, message: 'Must be http(s) URLs, or blank to hide a panel.' };
    }
  }
  try {
    await settingsApi.updateApp({
      agenda_image_url: url || null,
      agenda_data_url: dataUrl || null,
    });
  } catch (err) {
    if (err instanceof ApiError) {
      const body = err.body as { error?: string } | null;
      return { ok: false, message: body?.error ?? `HTTP ${err.status}` };
    }
    return { ok: false, message: (err as Error).message };
  }
  revalidatePath('/');
  revalidatePath('/settings');
  return { ok: true, message: 'Frame settings saved.' };
}

// Toggle the Health module (Addendum 05). Default off; enabling reveals the
// /health tabs in the nav. Data is retained either way.
export async function toggleHealthModuleAction(formData: FormData): Promise<SyncResult> {
  const enabled = formData.get('enabled') === 'true';
  try {
    await settingsApi.updateApp({ health_module_enabled: enabled });
  } catch (err) {
    if (err instanceof ApiError) {
      const body = err.body as { error?: string } | null;
      return { ok: false, message: body?.error ?? `HTTP ${err.status}` };
    }
    return { ok: false, message: (err as Error).message };
  }
  revalidatePath('/', 'layout');
  return {
    ok: true,
    message: enabled ? 'Health module enabled.' : 'Health module hidden.',
  };
}

// Toggle the Routines module (Addendum 06). Default on; turning it off hides
// Routines from the nav + Today, 404s its routes, and quiets its cron pings +
// chat tool. Data is retained. Layout revalidation refreshes the rail.
export async function toggleRoutinesModuleAction(formData: FormData): Promise<SyncResult> {
  const enabled = formData.get('enabled') === 'true';
  try {
    await settingsApi.updateApp({ routines_module_enabled: enabled });
  } catch (err) {
    if (err instanceof ApiError) {
      const body = err.body as { error?: string } | null;
      return { ok: false, message: body?.error ?? `HTTP ${err.status}` };
    }
    return { ok: false, message: (err as Error).message };
  }
  revalidatePath('/', 'layout');
  return {
    ok: true,
    message: enabled ? 'Routines module enabled.' : 'Routines module hidden.',
  };
}

// Toggle the Daily Rule module flag. In this fork the Rule surfaces
// (/shutdown, /recap, /hedge) were never ported, so the flag is inert
// beyond hiding/showing nothing — kept for schema parity with upstream.
export async function toggleRuleModuleAction(formData: FormData): Promise<SyncResult> {
  const enabled = formData.get('enabled') === 'true';
  try {
    await settingsApi.updateApp({ rule_module_enabled: enabled });
  } catch (err) {
    if (err instanceof ApiError) {
      const body = err.body as { error?: string } | null;
      return { ok: false, message: body?.error ?? `HTTP ${err.status}` };
    }
    return { ok: false, message: (err as Error).message };
  }
  revalidatePath('/', 'layout');
  return {
    ok: true,
    message: enabled ? 'Daily Rule module restored.' : 'Daily Rule module retired.',
  };
}

// Toggle the Maintenance module (migration 0047). Default on; turning it off
// hides /maintenance from the nav. The cron sweep + attention rules keep
// running server-side either way — the flag is a UI gate, not a data gate.
export async function toggleMaintenanceModuleAction(formData: FormData): Promise<SyncResult> {
  const enabled = formData.get('enabled') === 'true';
  try {
    await settingsApi.updateApp({ maintenance_module_enabled: enabled });
  } catch (err) {
    if (err instanceof ApiError) {
      const body = err.body as { error?: string } | null;
      return { ok: false, message: body?.error ?? `HTTP ${err.status}` };
    }
    return { ok: false, message: (err as Error).message };
  }
  revalidatePath('/', 'layout');
  return {
    ok: true,
    message: enabled ? 'Maintenance module enabled.' : 'Maintenance module hidden.',
  };
}

// The one reading-staleness policy (migration 0048): how many days a metered
// asset with meter-cadence items may go without a reading before the
// reading nag fires. Read by the attention rule and shown on /maintenance.
export async function setMeterStaleDaysAction(formData: FormData): Promise<SyncResult> {
  const raw = Number(String(formData.get('meter_stale_days') ?? '').trim());
  if (!Number.isInteger(raw) || raw < 1 || raw > 365) {
    return { ok: false, message: 'Enter a whole number of days between 1 and 365.' };
  }
  try {
    await settingsApi.updateApp({ meter_stale_days: raw });
  } catch (err) {
    if (err instanceof ApiError) {
      const body = err.body as { error?: string } | null;
      return { ok: false, message: body?.error ?? `HTTP ${err.status}` };
    }
    return { ok: false, message: (err as Error).message };
  }
  revalidatePath('/settings');
  revalidatePath('/maintenance');
  return { ok: true, message: `Readings expected every ${raw} days.` };
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


// ─── AI / Immich integration settings ────────────────────────────────────

function errMessage(err: unknown): string {
  if (err instanceof ApiError) {
    const body = err.body as { error?: string; message?: string } | null;
    return body?.message ?? body?.error ?? `HTTP ${err.status}`;
  }
  return (err as Error).message;
}

export async function updateIntegrationSettingsAction(
  body: UpdateAppSettingsBody,
): Promise<SyncResult> {
  try {
    await settingsApi.updateApp(body);
  } catch (err) {
    return { ok: false, message: errMessage(err) };
  }
  revalidatePath('/settings');
  return { ok: true, message: 'Saved.' };
}

export async function testLlmAction(): Promise<SyncResult> {
  try {
    const res = await settingsApi.testLlm();
    return { ok: true, message: `OK · ${res.detail} · ${res.latency_ms}ms` };
  } catch (err) {
    return { ok: false, message: errMessage(err) };
  }
}

export async function testSttAction(): Promise<SyncResult> {
  try {
    const res = await settingsApi.testStt();
    return { ok: true, message: `OK · ${res.detail} · ${res.latency_ms}ms` };
  } catch (err) {
    return { ok: false, message: errMessage(err) };
  }
}

// ─── API tokens (agents / devices) ───────────────────────────────────────

export async function createApiTokenAction(formData: FormData): Promise<SyncResult & { token?: string }> {
  const name = String(formData.get('name') ?? '').trim();
  const kind = String(formData.get('kind') ?? 'agent') === 'device' ? 'device' : 'agent';
  if (!name) return { ok: false, message: 'Name is required.' };
  try {
    const res = await authApi.createToken({ name, kind });
    revalidatePath('/settings');
    return { ok: true, message: `Token "${name}" created — copy it now, it won't be shown again.`, token: res.token };
  } catch (err) {
    return { ok: false, message: errMessage(err) };
  }
}

export async function revokeApiTokenAction(id: string): Promise<SyncResult> {
  try {
    await authApi.revokeToken(id);
    revalidatePath('/settings');
    return { ok: true, message: 'Token revoked.' };
  } catch (err) {
    return { ok: false, message: errMessage(err) };
  }
}

// ─── Briefing panels (migration 0044) ────────────────────────────────────

// The form posts the FULL next config as hidden JSON (each button computes
// the complete ordered array client-side — no ambiguity, no single-move
// races). Validated with the shared schema so malformed config can never
// reach the homepage.
export async function updateBriefingPanelsAction(formData: FormData): Promise<SyncResult> {
  let raw: unknown;
  try {
    raw = JSON.parse(String(formData.get('config') ?? ''));
  } catch {
    return { ok: false, message: 'Malformed panel config.' };
  }
  const parsed = BriefingPanelConfigSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, message: 'Malformed panel config.' };
  try {
    await settingsApi.updateApp({ briefing_panels: parsed.data });
  } catch (err) {
    return { ok: false, message: errMessage(err) };
  }
  revalidatePath('/');
  revalidatePath('/settings');
  return { ok: true, message: 'Briefing layout saved.' };
}
