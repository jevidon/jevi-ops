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

interface WebAppSettings {
  timezone: string;
  health_module_enabled: boolean;
  routines_module_enabled: boolean;
  rule_module_enabled: boolean;
  shopping_module_enabled: boolean;
}

// Feature flags stored as boolean columns on app_settings. Health (Addendum
// 05) defaults off; Routines (Addendum 06) defaults on; the Daily Rule
// (Addendum 06) defaults OFF — retired by Addendum 09; Shopping (migration
// 0044) defaults on.
export type FeatureFlag =
  | 'health_module_enabled'
  | 'routines_module_enabled'
  | 'rule_module_enabled'
  | 'shopping_module_enabled';

export const getAppSettings = cache(async (): Promise<WebAppSettings> => {
  try {
    const settings = await settingsApi.getApp();
    return {
      timezone: settings.timezone ?? DEFAULT_TIMEZONE,
      health_module_enabled: settings.health_module_enabled ?? false,
      // Default on: keep Routines visible unless explicitly turned off.
      routines_module_enabled: settings.routines_module_enabled ?? true,
      // Default off: the Rule module stays retired unless explicitly re-enabled.
      rule_module_enabled: settings.rule_module_enabled ?? false,
      // Default on: keep Shopping visible unless explicitly turned off.
      shopping_module_enabled: settings.shopping_module_enabled ?? true,
    };
  } catch {
    return {
      timezone: DEFAULT_TIMEZONE,
      health_module_enabled: false,
      routines_module_enabled: true,
      rule_module_enabled: false,
      shopping_module_enabled: true,
    };
  }
});

export async function getAppTimezone(): Promise<string> {
  return (await getAppSettings()).timezone;
}

// Feature-flag lookup for server components / layouts. Returns false on
// any read failure so a gated module never leaks on a transient error.
export async function getFeatureFlag(flag: FeatureFlag): Promise<boolean> {
  return (await getAppSettings())[flag] === true;
}
