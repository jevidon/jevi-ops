import { config as loadDotenv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';

// In the monorepo, .env lives at the repo root (one folder up from apps/api).
// Load that first, then fall back to a local .env so apps/api/.env still works
// if someone wants per-app overrides.
//
// `override: true` on the root .env so that the file is authoritative —
// otherwise a stale value already set in the shell environment (`unset` not
// run since exporting it, etc.) silently wins and you get cryptic "X not
// configured" errors despite the .env having the value.
const here = dirname(fileURLToPath(import.meta.url));
loadDotenv({ path: resolve(here, '../../../../.env'), override: true });
loadDotenv({ path: resolve(here, '../../.env'), override: false });

// Strict env validation. Anything required at boot lives here.
// Phase-2-only vars (Gmail OAuth, etc.) are optional for now.

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  API_HOST: z.string().default('127.0.0.1'),
  API_PORT: z.coerce.number().int().positive().default(3001),

  CORS_ORIGINS: z.string().default('http://localhost:3000'),

  // Postgres connection string. Optional at boot so healthz stays up on a
  // fresh install; every data route gates on isDatabaseConfigured().
  DATABASE_URL: z.string().optional(),

  // Session-token signing secret (HS256, shared with the web app so its
  // middleware can verify locally). Required for login to work.
  // Generate with: openssl rand -hex 32
  AUTH_SECRET: z.string().min(32).optional(),

  // Webhook secret for /api/ingest. External systems (Zapier, n8n, smart
  // glasses, Cowork workflows) post here and pass the same value in the
  // X-Ingest-Secret header.
  INGEST_WEBHOOK_SECRET: z.string().min(20).optional(),

  // Cron secret for /api/cron/* endpoints. External cron service (Supabase
  // pg_cron, system cron, etc.) passes this in the X-Cron-Secret header.
  CRON_SECRET: z.string().min(20).optional(),

  // Widget secret for /api/widget/* endpoints. iOS Scriptable / Android
  // HTTP Shortcuts widgets pass this as ?secret=... since they can't
  // carry a Supabase session.
  WIDGET_SECRET: z.string().min(20).optional(),

  // Public origin of the web app — used by widget endpoints to build
  // tap-through deep links. Set this on prod to the dashboard's public
  // URL. Without it the widget falls back to the hardcoded prod URL
  // below, which is fine for production but means dev widgets would
  // also point at prod.
  WEB_PUBLIC_URL: z.string().url().optional(),

  // Anthropic — required once voice capture is wired.
  ANTHROPIC_API_KEY: z.string().optional(),
  // Override the parser model. Default is the current best for structured
  // parsing accuracy (claude-opus-4-7). Swap to a smaller model for cost.
  ANTHROPIC_MODEL: z.string().default('claude-opus-4-7'),

  // OpenAI Whisper for audio transcription (browser MediaRecorder → server).
  // Web Speech API is blocked on some networks; Whisper bypasses Google entirely.
  OPENAI_API_KEY: z.string().optional(),
  // Default Whisper model. whisper-1 is fine; reserved for future override.
  OPENAI_WHISPER_MODEL: z.string().default('whisper-1'),

  // Google OAuth — Phase 1 (Calendar) + Phase 2 (Gmail, Drive). Optional at
  // boot; runtime checks enforce presence when the user tries to connect.
  GOOGLE_OAUTH_CLIENT_ID: z.string().optional(),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().optional(),
  GOOGLE_OAUTH_REDIRECT_URI: z.string().url().optional(),
  // Where to send the user after a successful OAuth callback. Defaults to
  // the web app's settings page.
  WEB_APP_URL: z.string().url().default('http://localhost:3000'),

  // Shared HMAC secret used by the web app to sign short-lived tokens for
  // /api/auth/google?t=<token>. Required in production — the begin endpoint
  // rejects requests without a valid token. See apps/api/src/lib/oauth-bridge.ts.
  // Generate with: openssl rand -hex 32
  OAUTH_BRIDGE_SECRET: z.string().min(32).optional(),

  // Pushover credentials for task due-time reminders. Both required for
  // /api/cron/reminders to actually dispatch — if either is missing the
  // cron just logs and exits cleanly so it's safe to enable Pushover later.
  // PUSHOVER_USER_KEY = your personal user key from the Pushover app.
  // PUSHOVER_API_TOKEN = the application/API token from pushover.net.
  PUSHOVER_USER_KEY: z.string().optional(),
  PUSHOVER_API_TOKEN: z.string().optional(),

  // Bunny.net Storage Zone + CDN Pull Zone for image attachments on
  // notes + journal entries. All four required for /api/uploads/image
  // to function; missing any → the route returns 503 and the UI hides
  // the "add image" affordance.
  //
  // BUNNY_STORAGE_ZONE   = the storage zone name from Bunny dashboard
  // BUNNY_STORAGE_REGION = optional region prefix (e.g., "ny", "la");
  //                        blank uses the default (Frankfurt) endpoint
  // BUNNY_STORAGE_ACCESS_KEY = the storage zone's password / API key
  // BUNNY_CDN_HOST       = the Pull Zone hostname (e.g., jevi-ops.b-cdn.net)
  //                        — what we put in the URL of stored files
  BUNNY_STORAGE_ZONE: z.string().optional(),
  BUNNY_STORAGE_REGION: z.string().optional(),
  BUNNY_STORAGE_ACCESS_KEY: z.string().optional(),
  BUNNY_CDN_HOST: z.string().optional(),
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('❌ Invalid environment variables:');
  // eslint-disable-next-line no-console
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;

export const corsOrigins = env.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean);

export const isDev = env.NODE_ENV === 'development';

// Status flags re-exported for the /healthz route, which surfaces them so
// you can sanity-check what loaded without re-deriving Boolean checks here.
