import { google } from 'googleapis';
import type { OAuth2Client, Credentials } from 'google-auth-library';
import type { calendar_v3 } from 'googleapis';
import { env } from './env.js';
import { supabaseAdmin } from './supabase.js';

// Google OAuth + Calendar wrapper. Tokens are stored in google_oauth_tokens
// (single row, single-user system). All access goes through the
// service-role Supabase client — tokens never leave the API process.

// ─── OAuth client (used by /api/auth/google routes) ──────────────────────

export function isGoogleConfigured(): boolean {
  return Boolean(
    env.GOOGLE_OAUTH_CLIENT_ID &&
    env.GOOGLE_OAUTH_CLIENT_SECRET &&
    env.GOOGLE_OAUTH_REDIRECT_URI,
  );
}

export function oauth2Client(): OAuth2Client {
  if (!isGoogleConfigured()) {
    throw new Error('Google OAuth env vars not set');
  }
  return new google.auth.OAuth2(
    env.GOOGLE_OAUTH_CLIENT_ID,
    env.GOOGLE_OAUTH_CLIENT_SECRET,
    env.GOOGLE_OAUTH_REDIRECT_URI,
  );
}

// Scopes we ask for at consent. Add Gmail/Drive scopes in Phase 2.
export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/userinfo.email',
  'openid',
];

// ─── Token storage (service-role only) ───────────────────────────────────

interface StoredTokens {
  id: string;
  access_token: string;
  refresh_token: string | null;
  expires_at: string;
  scope: string;
  token_type: string;
  last_synced_at: string | null;
}

export async function loadTokens(): Promise<StoredTokens | null> {
  const { data, error } = await supabaseAdmin()
    .from('google_oauth_tokens')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`failed to load google tokens: ${error.message}`);
  return data ?? null;
}

export async function saveTokens(creds: Credentials): Promise<void> {
  if (!creds.access_token) throw new Error('saveTokens called without access_token');

  const row = {
    access_token: creds.access_token,
    refresh_token: creds.refresh_token ?? null,
    expires_at: new Date(creds.expiry_date ?? Date.now() + 3600 * 1000).toISOString(),
    scope: creds.scope ?? GOOGLE_SCOPES.join(' '),
    token_type: creds.token_type ?? 'Bearer',
  };

  const existing = await loadTokens();
  const sb = supabaseAdmin();
  if (existing) {
    // Refresh tokens come back only on the first consent — preserve the
    // stored one if a refresh response omits it.
    const update: Record<string, unknown> = { ...row };
    if (!row.refresh_token && existing.refresh_token) {
      update.refresh_token = existing.refresh_token;
    }
    const { error } = await sb.from('google_oauth_tokens').update(update).eq('id', existing.id);
    if (error) throw new Error(`failed to update google tokens: ${error.message}`);
  } else {
    const { error } = await sb.from('google_oauth_tokens').insert(row);
    if (error) throw new Error(`failed to insert google tokens: ${error.message}`);
  }
}

export async function clearTokens(): Promise<void> {
  const { error } = await supabaseAdmin().from('google_oauth_tokens').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  if (error) throw new Error(`failed to clear google tokens: ${error.message}`);
}

export async function markSynced(): Promise<void> {
  const existing = await loadTokens();
  if (!existing) return;
  await supabaseAdmin()
    .from('google_oauth_tokens')
    .update({ last_synced_at: new Date().toISOString() })
    .eq('id', existing.id);
}

// ─── Authenticated client factory (with auto-refresh) ───────────────────

/**
 * Returns an OAuth2 client preloaded with the stored tokens. The
 * googleapis library auto-refreshes the access token when expired and
 * fires the `tokens` event with the new credentials — we listen and
 * persist so subsequent API runs don't re-refresh.
 */
export async function getAuthedClient(): Promise<OAuth2Client | null> {
  const tokens = await loadTokens();
  if (!tokens) return null;

  const client = oauth2Client();
  client.setCredentials({
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token ?? undefined,
    expiry_date: new Date(tokens.expires_at).getTime(),
    scope: tokens.scope,
    token_type: tokens.token_type,
  });

  // Refresh event fires when the access_token was auto-refreshed. Persist
  // the new value so we don't refresh on every request.
  client.on('tokens', (newCreds) => {
    // Fire and forget — we don't want to await mid-API-call.
    saveTokens(newCreds).catch(() => {
      // best-effort; next request will trigger another refresh if this failed
    });
  });

  return client;
}

// ─── Calendar API surface ────────────────────────────────────────────────

export interface CalendarEventPayload {
  summary: string;
  description?: string;
  location?: string;
  start: string; // ISO 8601
  end: string;
  attendees?: string[]; // email addresses
}

function toGoogleEvent(p: CalendarEventPayload): calendar_v3.Schema$Event {
  return {
    summary: p.summary,
    description: p.description,
    location: p.location,
    start: { dateTime: p.start, timeZone: 'America/Denver' },
    end: { dateTime: p.end, timeZone: 'America/Denver' },
    ...(p.attendees?.length ? { attendees: p.attendees.map((email) => ({ email })) } : {}),
  };
}

/** List events on the user's primary calendar between two ISO timestamps.
 *  Includes cancelled events (status='cancelled') so callers can propagate
 *  deletions. orderBy 'startTime' is incompatible with showDeleted, so we
 *  drop it — the upsert path doesn't depend on order, and we sort client-
 *  side where presentation matters. */
export async function listEvents(timeMin: string, timeMax: string) {
  const client = await getAuthedClient();
  if (!client) return null;
  const cal = google.calendar({ version: 'v3', auth: client });
  const res = await cal.events.list({
    calendarId: 'primary',
    timeMin,
    timeMax,
    singleEvents: true,
    showDeleted: true,
    maxResults: 250,
  });
  return res.data.items ?? [];
}

/** Insert an event on the user's primary calendar. Returns the Google event. */
export async function insertEvent(payload: CalendarEventPayload) {
  const client = await getAuthedClient();
  if (!client) return null;
  const cal = google.calendar({ version: 'v3', auth: client });
  const res = await cal.events.insert({
    calendarId: 'primary',
    requestBody: toGoogleEvent(payload),
  });
  return res.data;
}

/** Delete an event by Google event ID. */
export async function deleteEvent(googleEventId: string): Promise<boolean> {
  const client = await getAuthedClient();
  if (!client) return false;
  const cal = google.calendar({ version: 'v3', auth: client });
  await cal.events.delete({ calendarId: 'primary', eventId: googleEventId });
  return true;
}
