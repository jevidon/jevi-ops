import { eq } from 'drizzle-orm';
import { getDb } from './db.js';
import { app_settings } from '../db/schema.js';

// App-wide settings loader with a process-lifetime cache. The settings
// table is a single row that changes essentially never, so we read it
// once per process and refresh only when an admin update succeeds.
// Falls back to a hardcoded default if the row hasn't been created
// yet (pre-migration boot) or if the read fails.

const DEFAULT_TIMEZONE = 'America/Denver';

export interface AppSettings {
  timezone: string;
  llm_provider: 'openai_compatible' | 'anthropic' | null;
  llm_base_url: string | null;
  llm_model: string | null;
  llm_api_key: string | null;
  stt_base_url: string | null;
  stt_model: string | null;
  immich_base_url: string | null;
  immich_api_key: string | null;
  // Module feature flags (migration 0036). Defaults mirror the column
  // defaults so a pre-migration boot fails safe (health/rule hidden,
  // routines visible).
  health_module_enabled: boolean;
  routines_module_enabled: boolean;
  rule_module_enabled: boolean;
}

const DEFAULTS: AppSettings = {
  timezone: DEFAULT_TIMEZONE,
  llm_provider: null,
  llm_base_url: null,
  llm_model: null,
  llm_api_key: null,
  stt_base_url: null,
  stt_model: null,
  immich_base_url: null,
  immich_api_key: null,
  health_module_enabled: false,
  routines_module_enabled: true,
  rule_module_enabled: false,
};

// In-memory cache. Reset by invalidateAppSettings() when /api/settings/app
// PATCH succeeds. This is the single API process, so drift isn't a concern.
let cache: AppSettings | null = null;
let inflight: Promise<AppSettings> | null = null;

async function load(): Promise<AppSettings> {
  try {
    const row = await getDb().query.app_settings.findFirst({
      where: eq(app_settings.id, true),
    });
    if (!row) return { ...DEFAULTS };
    return {
      timezone: row.timezone ?? DEFAULT_TIMEZONE,
      llm_provider: (row.llm_provider as AppSettings['llm_provider']) ?? null,
      llm_base_url: row.llm_base_url ?? null,
      llm_model: row.llm_model ?? null,
      llm_api_key: row.llm_api_key ?? null,
      stt_base_url: row.stt_base_url ?? null,
      stt_model: row.stt_model ?? null,
      immich_base_url: row.immich_base_url ?? null,
      immich_api_key: row.immich_api_key ?? null,
      health_module_enabled: row.health_module_enabled ?? false,
      routines_module_enabled: row.routines_module_enabled ?? true,
      rule_module_enabled: row.rule_module_enabled ?? false,
    };
  } catch {
    // Pre-migration or transient DB error — keep the app running with
    // the defaults. Callers don't need to handle this case.
    return { ...DEFAULTS };
  }
}

export async function getAppSettings(): Promise<AppSettings> {
  if (cache) return cache;
  if (inflight) return inflight;
  inflight = load().then((s) => {
    cache = s;
    inflight = null;
    return s;
  });
  return inflight;
}

// Convenience for the most common use — getting just the TZ string.
export async function getAppTz(): Promise<string> {
  return (await getAppSettings()).timezone;
}

export function invalidateAppSettings(): void {
  cache = null;
  inflight = null;
}
