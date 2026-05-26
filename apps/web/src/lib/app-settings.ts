import 'server-only';
import { cache } from 'react';
import { createClient } from './supabase/server';

// App-wide settings reader for the web app. Cached per-request via
// React's cache() so multiple server components fetching the timezone
// in the same render share a single DB read.
//
// Falls back to America/Denver if the row is missing (pre-migration)
// or the read fails. The site shouldn't 500 because of settings.

const DEFAULT_TIMEZONE = 'America/Denver';

export const getAppSettings = cache(async (): Promise<{ timezone: string }> => {
  try {
    const sb = await createClient();
    const { data, error } = await sb
      .from('app_settings')
      .select('timezone')
      .eq('id', true)
      .maybeSingle();
    if (error) throw error;
    return { timezone: data?.timezone ?? DEFAULT_TIMEZONE };
  } catch {
    return { timezone: DEFAULT_TIMEZONE };
  }
});

export async function getAppTimezone(): Promise<string> {
  return (await getAppSettings()).timezone;
}
