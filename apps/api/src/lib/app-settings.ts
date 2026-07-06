import { eq } from 'drizzle-orm';
import { getDb } from './db.js';
import { app_settings } from '../db/schema.js';

// App-wide settings loader with a process-lifetime cache. The settings
// table is a single row that changes essentially never, so we read it
// once per process and refresh only when an admin update succeeds.
// Falls back to a hardcoded default if the row hasn't been created
// yet (pre-migration boot) or if the read fails.

const DEFAULT_TIMEZONE = 'America/Denver';

interface AppSettings {
  timezone: string;
}

// In-memory cache. Reset by invalidateAppSettings() when /api/settings/app
// PATCH succeeds. This is the single API process, so drift isn't a concern.
let cache: AppSettings | null = null;
let inflight: Promise<AppSettings> | null = null;

async function load(): Promise<AppSettings> {
  try {
    const row = await getDb().query.app_settings.findFirst({
      columns: { timezone: true },
      where: eq(app_settings.id, true),
    });
    return { timezone: row?.timezone ?? DEFAULT_TIMEZONE };
  } catch {
    // Pre-migration or transient DB error — keep the app running with
    // the default. Callers don't need to handle this case.
    return { timezone: DEFAULT_TIMEZONE };
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
