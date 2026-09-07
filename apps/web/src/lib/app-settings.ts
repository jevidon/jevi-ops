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
  // Maintenance module (migration 0047). Default on — core home-ops.
  maintenance_module_enabled: boolean;
  // Briefing panel visibility/order (migration 0044); null → registry
  // defaults. Projected here deliberately — this interface drops unknown
  // fields, so forgetting this line silently loses the config.
  briefing_panels: Array<{ id: string; enabled: boolean }> | null;
  // Frame panel image URL (migration 0045); null hides the panel.
  agenda_image_url: string | null;
  // Weather panel data-bundle URL (migration 0046); null hides the panel.
  agenda_data_url: string | null;
}

// Feature flags stored as boolean columns on app_settings. Health (Addendum
// 05) defaults off; Routines (Addendum 06) defaults on; the Daily Rule
// (Addendum 06) defaults OFF — retired by Addendum 09.
export type FeatureFlag =
  | 'health_module_enabled'
  | 'routines_module_enabled'
  | 'rule_module_enabled'
  | 'maintenance_module_enabled';

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
      // Default on: maintenance is core home-ops.
      maintenance_module_enabled: settings.maintenance_module_enabled ?? true,
      briefing_panels: settings.briefing_panels ?? null,
      agenda_image_url: settings.agenda_image_url ?? null,
      agenda_data_url: settings.agenda_data_url ?? null,
    };
  } catch {
    return {
      timezone: DEFAULT_TIMEZONE,
      health_module_enabled: false,
      routines_module_enabled: true,
      rule_module_enabled: false,
      maintenance_module_enabled: true,
      briefing_panels: null,
      agenda_image_url: null,
      agenda_data_url: null,
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
