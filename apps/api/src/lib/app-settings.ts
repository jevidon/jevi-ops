import { eq } from 'drizzle-orm';
import { getDb } from './db.js';
import { app_settings } from '../db/schema.js';

// Internal settings only. Public callers must use publicSettings(). Read
// the indexed singleton afresh so another process or a credential rotation
// cannot leave stale active configuration in a lifetime cache. Concurrent
// reads share one in-flight query. Database errors fail closed.

const DEFAULT_TIMEZONE = 'America/Denver';

export interface AppSettings {
  revision: number;
  credential_settings: Record<string, unknown>;
  capability_tests: Record<string, unknown>;
  timezone: string;
  llm_provider: 'openai_compatible' | 'anthropic' | null;
  llm_base_url: string | null;
  llm_model: string | null;
  /** Quarantined legacy plaintext, used ONLY by the migration command. */
  llm_api_key: string | null;
  stt_base_url: string | null;
  stt_model: string | null;
  immich_base_url: string | null;
  immich_api_key: string | null;
  health_module_enabled: boolean;
  routines_module_enabled: boolean;
  rule_module_enabled: boolean;
  maintenance_module_enabled: boolean;
  meter_stale_days: number;
  currency: string;
  briefing_panels: Array<{ id: string; enabled: boolean }> | null;
  agenda_image_url: string | null;
  agenda_data_url: string | null;
}

// Concurrent reads may share one query. Mutations invalidate this handle.
let inflight: Promise<AppSettings> | null = null;

async function load(): Promise<AppSettings> {
  try {
    const row = await getDb().query.app_settings.findFirst({
      where: eq(app_settings.id, true),
    });
    if (!row) throw new Error('settings_unavailable');
    return {
      revision: row.revision,
      credential_settings: row.credential_settings,
      capability_tests: row.capability_tests,
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
      maintenance_module_enabled: row.maintenance_module_enabled ?? true,
      meter_stale_days: row.meter_stale_days ?? 14,
      currency: row.currency ?? 'USD',
      briefing_panels: row.briefing_panels ?? null,
      agenda_image_url: row.agenda_image_url ?? null,
      agenda_data_url: row.agenda_data_url ?? null,
    };
  } catch {
    throw new Error('settings_unavailable');
  }
}

export async function getAppSettings(): Promise<AppSettings> {
  if (inflight) return inflight;
  inflight = load().then((s) => {
    inflight = null;
    return s;
  }).catch((error: unknown) => { inflight = null; throw error; });
  return inflight;
}

// Convenience for the most common use — getting just the TZ string.
export async function getAppTz(): Promise<string> {
  return (await getAppSettings()).timezone;
}

export function invalidateAppSettings(): void {
  inflight = null;
}
