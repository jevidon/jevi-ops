import type { FastifyPluginAsync } from 'fastify';
import { env } from '../lib/env.js';
import { getAppSettings, invalidateAppSettings } from '../lib/app-settings.js';
import { UpdateAppSettingsSchema } from '@jevi-ops/shared/schemas';

// /api/settings/integrations-status — read-only inventory of which env-var
// backed integrations are configured. Never returns the actual values —
// just presence flags + helpful "what to set" detail, so the response is
// safe to render in a server component even though it's auth-gated.

interface IntegrationStatus {
  key: string;
  label: string;
  category: 'infrastructure' | 'ai' | 'integrations' | 'notifications';
  status: 'configured' | 'partial' | 'missing';
  detail: string;
  required: boolean;
  purpose: string;
}

function statusForAll(present: boolean[]): 'configured' | 'partial' | 'missing' {
  if (present.every(Boolean)) return 'configured';
  if (present.some(Boolean)) return 'partial';
  return 'missing';
}

export const settingsRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.requireAuth);

  // App-wide settings (timezone, etc.) — single-row table. GET reads
  // the cached value; PATCH writes through and invalidates the cache.
  app.get('/api/settings/app', async () => {
    const settings = await getAppSettings();
    return settings;
  });

  app.patch('/api/settings/app', async (req, reply) => {
    const parsed = UpdateAppSettingsSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'invalid_payload',
        details: parsed.error.flatten().fieldErrors,
      });
    }
    if (Object.keys(parsed.data).length === 0) {
      return reply.code(400).send({ error: 'empty_payload' });
    }
    const { data, error } = await req.supabase!
      .from('app_settings')
      .update(parsed.data)
      .eq('id', true)
      .select('timezone, updated_at')
      .single();
    if (error) throw app.httpErrors.internalServerError(error.message);
    invalidateAppSettings();
    return data;
  });

  app.get('/api/settings/integrations-status', async () => {
    const items: IntegrationStatus[] = [
      {
        key: 'supabase',
        label: 'Supabase',
        category: 'infrastructure',
        status: statusForAll([
          !!env.SUPABASE_URL,
          !!env.SUPABASE_ANON_KEY,
          !!env.SUPABASE_SERVICE_ROLE_KEY,
        ]),
        detail: detailForSupabase(),
        required: true,
        purpose: 'Database, auth, RLS — required for the app to run.',
      },
      {
        key: 'cron_secret',
        label: 'Cron secret',
        category: 'infrastructure',
        status: env.CRON_SECRET ? 'configured' : 'missing',
        detail: env.CRON_SECRET
          ? 'CRON_SECRET set (length OK).'
          : 'CRON_SECRET missing — /api/cron/* endpoints return 503.',
        required: true,
        purpose: 'Gates the cron endpoints (reminders, observations, etc.).',
      },
      {
        key: 'ingest_secret',
        label: 'Ingest secret',
        category: 'infrastructure',
        status: env.INGEST_WEBHOOK_SECRET ? 'configured' : 'missing',
        detail: env.INGEST_WEBHOOK_SECRET
          ? 'INGEST_WEBHOOK_SECRET set.'
          : 'INGEST_WEBHOOK_SECRET missing — external webhooks rejected.',
        required: false,
        purpose: 'Lets external systems (Zapier, n8n, glasses) post to /api/ingest.',
      },
      {
        key: 'oauth_bridge',
        label: 'OAuth bridge secret',
        category: 'infrastructure',
        status: env.OAUTH_BRIDGE_SECRET ? 'configured' : 'missing',
        detail: env.OAUTH_BRIDGE_SECRET
          ? 'OAUTH_BRIDGE_SECRET set.'
          : 'OAUTH_BRIDGE_SECRET missing — Google OAuth begin flow will fail in prod.',
        required: false,
        purpose: 'Signs short-lived tokens for the OAuth begin handshake.',
      },
      {
        key: 'anthropic',
        label: 'Anthropic (Claude)',
        category: 'ai',
        status: env.ANTHROPIC_API_KEY ? 'configured' : 'missing',
        detail: env.ANTHROPIC_API_KEY
          ? `Configured · model: ${env.ANTHROPIC_MODEL}`
          : 'ANTHROPIC_API_KEY missing — voice parsing + chat disabled.',
        required: false,
        purpose: 'Voice capture parser + /chat tool-use loop.',
      },
      {
        key: 'openai',
        label: 'OpenAI (Whisper)',
        category: 'ai',
        status: env.OPENAI_API_KEY ? 'configured' : 'missing',
        detail: env.OPENAI_API_KEY
          ? `Configured · model: ${env.OPENAI_WHISPER_MODEL}`
          : 'OPENAI_API_KEY missing — audio transcription disabled (text capture still works).',
        required: false,
        purpose: 'Whisper transcription for voice memos.',
      },
      {
        key: 'google_oauth',
        label: 'Google Calendar OAuth',
        category: 'integrations',
        status: statusForAll([
          !!env.GOOGLE_OAUTH_CLIENT_ID,
          !!env.GOOGLE_OAUTH_CLIENT_SECRET,
          !!env.GOOGLE_OAUTH_REDIRECT_URI,
        ]),
        detail: detailForGoogle(),
        required: false,
        purpose: 'Two-way calendar sync. Without it the /calendar page only shows local events.',
      },
      {
        key: 'pushover',
        label: 'Pushover',
        category: 'notifications',
        status: statusForAll([!!env.PUSHOVER_USER_KEY, !!env.PUSHOVER_API_TOKEN]),
        detail: detailForPushover(),
        required: false,
        purpose: 'Task reminders, overdue alerts, daily summary, routine reminders.',
      },
      {
        key: 'bunny',
        label: 'Bunny CDN',
        category: 'integrations',
        status: statusForAll([
          !!env.BUNNY_STORAGE_ZONE,
          !!env.BUNNY_STORAGE_ACCESS_KEY,
          !!env.BUNNY_CDN_HOST,
        ]),
        detail: detailForBunny(),
        required: false,
        purpose: 'Image attachments on notes + journal entries.',
      },
    ];
    return { items };
  });
};

// ─── Detail helpers ──────────────────────────────────────────────────────
// These return strings that surface "what's set, what's not" without ever
// revealing the actual secret value.

function detailForSupabase(): string {
  const parts: string[] = [];
  if (env.SUPABASE_URL) parts.push(`URL: ${env.SUPABASE_URL}`);
  else parts.push('SUPABASE_URL missing');
  if (env.SUPABASE_ANON_KEY) parts.push('anon key set');
  else parts.push('SUPABASE_ANON_KEY missing');
  if (env.SUPABASE_SERVICE_ROLE_KEY) parts.push('service role set');
  else parts.push('SUPABASE_SERVICE_ROLE_KEY missing');
  return parts.join(' · ');
}

function detailForGoogle(): string {
  const parts: string[] = [];
  parts.push(env.GOOGLE_OAUTH_CLIENT_ID ? 'client id set' : 'client id missing');
  parts.push(env.GOOGLE_OAUTH_CLIENT_SECRET ? 'client secret set' : 'client secret missing');
  if (env.GOOGLE_OAUTH_REDIRECT_URI) parts.push(`redirect: ${env.GOOGLE_OAUTH_REDIRECT_URI}`);
  else parts.push('redirect URI missing');
  return parts.join(' · ');
}

function detailForPushover(): string {
  const parts: string[] = [];
  parts.push(env.PUSHOVER_USER_KEY ? 'user key set' : 'PUSHOVER_USER_KEY missing');
  parts.push(env.PUSHOVER_API_TOKEN ? 'api token set' : 'PUSHOVER_API_TOKEN missing');
  return parts.join(' · ');
}

function detailForBunny(): string {
  const parts: string[] = [];
  if (env.BUNNY_STORAGE_ZONE) parts.push(`storage zone: ${env.BUNNY_STORAGE_ZONE}`);
  else parts.push('BUNNY_STORAGE_ZONE missing');
  if (env.BUNNY_STORAGE_REGION) parts.push(`region: ${env.BUNNY_STORAGE_REGION}`);
  parts.push(env.BUNNY_STORAGE_ACCESS_KEY ? 'access key set' : 'BUNNY_STORAGE_ACCESS_KEY missing');
  if (env.BUNNY_CDN_HOST) parts.push(`pull zone: ${env.BUNNY_CDN_HOST}`);
  else parts.push('BUNNY_CDN_HOST missing');
  return parts.join(' · ');
}
