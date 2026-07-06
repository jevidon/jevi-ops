import 'server-only';
import { cache } from 'react';
import { settingsApi } from './api';

// App-wide settings reader for the web app. Cached per-request via
// React's cache() so multiple server components fetching the timezone
// in the same render share a single API read.
//
// Falls back to America/Denver if the settings endpoint fails. The site
// shouldn't 500 because of settings.

const DEFAULT_TIMEZONE = 'America/Denver';

export const getAppSettings = cache(async (): Promise<{ timezone: string }> => {
  try {
    const settings = await settingsApi.getApp();
    return { timezone: settings.timezone ?? DEFAULT_TIMEZONE };
  } catch {
    return { timezone: DEFAULT_TIMEZONE };
  }
});

export async function getAppTimezone(): Promise<string> {
  return (await getAppSettings()).timezone;
}
