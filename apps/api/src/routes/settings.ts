import type { FastifyPluginAsync } from 'fastify';
import { eq } from 'drizzle-orm';
import { env } from '../lib/env.js';
import { isDatabaseConfigured } from '../lib/db.js';
import { isAuthConfigured } from '../lib/jwt.js';
import { chatComplete, isLlmConfigured, llmDescription } from '../lib/llm.js';
import { isSttConfigured, sttDescription } from '../lib/stt.js';
import { isStorageConfigured } from '../lib/storage.js';
import { getDb } from '../lib/db.js';
import { app_settings } from '../db/schema.js';
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

  // App-wide settings (timezone + integration config) — single-row table.
  // GET reads the cached value; PATCH writes through and invalidates the
  // cache. API keys are returned as-is: single-user system, auth-gated,
  // and the settings form needs to show what's set.
  app.get('/api/settings/app', async () => {
    const settings = await getAppSettings();
    return settings;
  });

  // Connection tests for the AI section — cheap round-trips so the
  // dashboard "Test" buttons give a real signal, not just presence checks.
  app.post('/api/settings/test-llm', async (_req, reply) => {
    if (!(await isLlmConfigured())) {
      return reply.code(503).send({ ok: false, error: 'llm_not_configured' });
    }
    const started = Date.now();
    try {
      const res = await chatComplete({
        system: 'You are a connectivity check. Reply with the single word: ok',
        messages: [{ role: 'user', content: 'ping' }],
        maxTokens: 8,
        effort: 'low',
      });
      return {
        ok: true,
        latency_ms: Date.now() - started,
        detail: await llmDescription(),
        sample: res.text.slice(0, 40),
      };
    } catch (err) {
      return reply.code(502).send({
        ok: false,
        error: 'llm_unreachable',
        message: err instanceof Error ? err.message : 'unknown',
        detail: await llmDescription(),
      });
    }
  });

  app.post('/api/settings/test-stt', async (_req, reply) => {
    if (!(await isSttConfigured())) {
      return reply.code(503).send({ ok: false, error: 'stt_not_configured' });
    }
    const started = Date.now();
    try {
      const detail = await sttDescription();
      // Probe the server's models listing — supported by OpenAI cloud,
      // speaches, and faster-whisper-server. Proves reachability + auth
      // without shipping an audio sample.
      const base = detail.split(' · ')[0]!;
      const res = await fetch(`${base}/models`, { signal: AbortSignal.timeout(5000) });
      if (!res.ok && res.status !== 401 && res.status !== 403) {
        return reply.code(502).send({ ok: false, error: `stt_probe_http_${res.status}`, detail });
      }
      return { ok: true, latency_ms: Date.now() - started, detail };
    } catch (err) {
      return reply.code(502).send({
        ok: false,
        error: 'stt_unreachable',
        message: err instanceof Error ? err.message : 'unknown',
      });
    }
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
    const [row] = await getDb()
      .update(app_settings)
      .set(parsed.data)
      .where(eq(app_settings.id, true))
      .returning();
    if (!row) throw app.httpErrors.internalServerError('settings_row_missing');
    invalidateAppSettings();
    return row;
  });

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


