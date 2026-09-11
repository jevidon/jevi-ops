import type { FastifyPluginAsync } from 'fastify';
import { env } from '../lib/env.js';
import { isDatabaseConfigured } from '../lib/db.js';
import { isAuthConfigured } from '../lib/jwt.js';
import { isLlmConfigured, llmDescription } from '../lib/llm.js';
import { isSttConfigured, sttDescription } from '../lib/stt.js';
import { isStorageConfigured } from '../lib/storage.js';
import { isImmichConfigured, immichDescription } from '../lib/immich.js';
import { getAppSettings } from '../lib/app-settings.js';
import { UpdateAppSettingsSchema, CandidateSettingsTestSchema } from '@jevi-ops/shared/schemas';
import { prepareSettings, publicSettings, recordCapabilityTest, resolveIntegration, updateSettings, type Integration } from '../lib/settings-config.js';
import { requireOwnerSession } from '../lib/owner-session.js';
import { SettingsError } from '../lib/settings-crypto.js';
import { testIntegration } from '../lib/settings-tests.js';

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
  app.addHook('preHandler', requireOwnerSession);
  // Settings endpoints never expose exceptions originating in SDKs, URLs,
  // database writes, or crypto, including error handler logs.
  app.setErrorHandler((error, _req, reply) => {
    const code = error as { code?: string; cause?: { code?: string } };
    if (error instanceof SettingsError) return reply.code(error.status).send({ error: error.code });
    if (code.code === '42703' || code.cause?.code === '42703') return reply.code(503).send({ error: 'schema_out_of_date', message: 'Run scripts/db-migrate.sh, then restart the API.' });
    return reply.code(503).send({ error: 'settings_unavailable' });
  });
  app.get('/api/settings/app', async () => publicSettings(await getAppSettings()));
  app.patch('/api/settings/app', async (req, reply) => {
    const parsed = UpdateAppSettingsSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_payload' });
    if (Object.keys(parsed.data).length <= 1) return reply.code(400).send({ error: 'empty_payload' });
    return updateSettings(parsed.data);
  });
  for (const integration of ['llm', 'stt', 'immich'] as Integration[]) {
    app.post(`/api/settings/test-${integration}`, { bodyLimit: 20_000 }, async (req, reply) => {
      const parsed = CandidateSettingsTestSchema.safeParse(req.body ?? {});
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_payload' });
      const active = await getAppSettings();
      const candidate = parsed.data.candidate ? prepareSettings(active, parsed.data.candidate) : active;
      const cfg = resolveIntegration(candidate, integration);
      const capability = integration === 'llm' ? parsed.data.capability : integration === 'stt' ? 'stt_reachability' : 'immich_reachability';
      const result = await testIntegration(cfg, capability);
      await recordCapabilityTest(result);
      return reply.code(result.status === 'passed' ? 200 : 502).send({
        ok: result.status === 'passed', ...result,
        detail: integration === 'stt' ? 'Authenticated models endpoint only; transcription is untested.' : integration === 'immich' ? 'Authenticated account endpoint only; photo access is untested.' : `${capability} capability only; external research is untested.`,
      });
    });
  }

  app.get('/api/settings/integrations-status', async () => {
    const items: IntegrationStatus[] = [
      {
        key: 'database',
        label: 'PostgreSQL',
        category: 'infrastructure',
        status: isDatabaseConfigured() ? 'configured' : 'missing',
        detail: detailForDatabase(),
        required: true,
        purpose: 'The database — required for the app to run.',
      },
      {
        key: 'auth',
        label: 'Auth secret',
        category: 'infrastructure',
        status: isAuthConfigured() ? 'configured' : 'missing',
        detail: isAuthConfigured()
          ? 'AUTH_SECRET set (length OK).'
          : 'AUTH_SECRET missing — sign-in disabled. Generate with: openssl rand -hex 32',
        required: true,
        purpose: 'Signs session tokens for the web app and API.',
      },
      {
        key: 'cron_secret',
        label: 'Cron secret',
        category: 'infrastructure',
        status: env.CRON_SECRET ? 'configured' : 'missing',
        detail: env.CRON_SECRET
          ? 'CRON_SECRET set (length OK).'
          : 'CRON_SECRET missing — /api/cron/* endpoints return 503.',
        required: false,
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
        key: 'llm',
        label: 'LLM',
        category: 'ai',
        status: (await isLlmConfigured()) ? 'configured' : 'missing',
        detail: await llmDescription(),
        required: false,
        purpose: 'Voice capture parser + /chat tool-use loop. Local OpenAI-compatible server or Anthropic fallback.',
      },
      {
        key: 'stt',
        label: 'Speech-to-text',
        category: 'ai',
        status: (await isSttConfigured()) ? 'configured' : 'missing',
        detail: await sttDescription(),
        required: false,
        purpose: 'Audio transcription for voice memos (OpenAI-compatible server).',
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
        key: 'immich',
        label: 'Immich',
        category: 'integrations',
        status: (await isImmichConfigured()) ? 'configured' : 'missing',
        detail: await immichDescription(),
        required: false,
        purpose: 'Journal "photos from this day" suggestions.',
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
        key: 'storage',
        label: 'Image storage',
        category: 'integrations',
        status: isStorageConfigured() ? 'configured' : 'missing',
        detail: env.UPLOADS_DIR
          ? `Local volume: ${env.UPLOADS_DIR}`
          : 'UPLOADS_DIR missing — image attachments disabled.',
        required: false,
        purpose: 'Image attachments on notes + journal entries (local volume).',
      },
    ];
    return { items };
  });
};

// ─── Detail helpers ──────────────────────────────────────────────────────
// These return strings that surface "what's set, what's not" without ever
// revealing the actual secret value.

function detailForDatabase(): string {
  if (!env.DATABASE_URL) return 'DATABASE_URL missing.';
  // Surface host:port/db only — never credentials.
  try {
    const u = new URL(env.DATABASE_URL);
    return `Connected target: ${u.hostname}:${u.port || '5432'}${u.pathname}`;
  } catch {
    return 'DATABASE_URL set (unparseable — check format).';
  }
}

function detailForGoogle(): string {
  const parts: string[] = [];
  parts.push(env.GOOGLE_OAUTH_CLIENT_ID ? 'client id set' : 'client id missing');
  parts.push(env.GOOGLE_OAUTH_CLIENT_SECRET ? 'client secret set' : 'client secret missing');
  if (env.GOOGLE_OAUTH_REDIRECT_URI) parts.push('redirect URI set');
  else parts.push('redirect URI missing');
  return parts.join(' · ');
}

function detailForPushover(): string {
  const parts: string[] = [];
  parts.push(env.PUSHOVER_USER_KEY ? 'user key set' : 'PUSHOVER_USER_KEY missing');
  parts.push(env.PUSHOVER_API_TOKEN ? 'api token set' : 'PUSHOVER_API_TOKEN missing');
  return parts.join(' · ');
}


