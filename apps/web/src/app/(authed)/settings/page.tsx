import Link from 'next/link';
import { cookies } from 'next/headers';
import { ScreenHeader } from '@/components/ScreenHeader';
import {
  authApi, googleApi, settingsApi, ApiError,
  type ApiTokenRow, type AppSettings, type GoogleStatus,
} from '@/lib/api';
import { getAppTimezone, getFeatureFlag } from '@/lib/app-settings';
import { SettingsSection } from './settings-section';
import { AppearanceForm, type ThemePref } from './appearance-form';
import { TimezoneForm } from './timezone-form';
import { ModulesForm } from './modules-form';
import { BriefingPanelsForm, type PanelRow } from './briefing-panels-form';
import { mergePanelConfig, panelDef } from '../_briefing/registry';
import { getAppSettings } from '@/lib/app-settings';
import { AiSettingsForm } from './ai-settings-form';
import { ApiTokensPanel } from './api-tokens-panel';
import { beginGoogleOAuthAction } from './actions';

// /settings — integrations and account controls. Lives outside the six-tab
// nav (it's reachable from the rail's email footer or by direct URL).

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ google?: string; reason?: string }>;
}) {
  const { google: googleParam, reason } = await searchParams;
  const themeCookie = (await cookies()).get('jops2.theme')?.value;
  const theme: ThemePref =
    themeCookie === 'light' || themeCookie === 'dark' ? themeCookie : 'system';
  const tz = await getAppTimezone();
  const healthEnabled = await getFeatureFlag('health_module_enabled');
  const routinesEnabled = await getFeatureFlag('routines_module_enabled');
  const ruleEnabled = await getFeatureFlag('rule_module_enabled');

  // Briefing panel rows for the Settings form — resolved through the same
  // mergePanelConfig the homepage uses, so the two can never disagree. The
  // registry is server-only (it imports panel server components), hence the
  // projection to plain PanelRow data here.
  const webSettings = await getAppSettings();
  const gateLabel: Record<string, string> = {
    health_module_enabled: 'Health',
    routines_module_enabled: 'Routines',
  };
  const panelRows: PanelRow[] = mergePanelConfig(webSettings.briefing_panels).flatMap((entry) => {
    const def = panelDef(entry.id);
    if (!def) return [];
    return [{
      id: def.id,
      label: def.label,
      description: def.description,
      column: def.column,
      enabled: entry.enabled,
      gatedBy: def.moduleFlag ? gateLabel[def.moduleFlag] ?? def.moduleFlag : null,
    }];
  });

  let appSettings: AppSettings = {
    timezone: tz,
    health_module_enabled: healthEnabled,
    routines_module_enabled: routinesEnabled,
    rule_module_enabled: ruleEnabled,
  };
  try {
    appSettings = await settingsApi.getApp();
  } catch {
    /* section renders with env-only defaults */
  }
  let tokens: ApiTokenRow[] = [];
  try {
    tokens = (await authApi.listTokens()).tokens;
  } catch {
    /* token panel renders empty */
  }

  let status: GoogleStatus = {
    configured: false,
    connected: false,
    last_synced_at: null,
    scope: null,
  };
  let statusError: string | null = null;

  try {
    status = await googleApi.status();
  } catch (err) {
    statusError = err instanceof ApiError ? `API ${err.status}` : (err as Error).message;
  }

  // Banner from the OAuth callback redirect (?google=connected|error)
  const banner =
    googleParam === 'connected'
      ? { kind: 'ok' as const, text: 'Google Calendar connected.' }
      : googleParam === 'error'
      ? { kind: 'err' as const, text: `OAuth failed: ${reason ?? 'unknown_reason'}` }
      : null;

  return (
    <div>
      <ScreenHeader eyebrow="Account" title="Settings" meta="Integrations · sync" />
      <div className="hairline" />

      {banner && (
        <div
          className={`mx-5 lg:mx-0 mt-4 px-4 py-3 text-[13px] ${
            banner.kind === 'ok' ? 'bg-ink text-bg' : 'bg-accent text-bg'
          }`}
        >
          {banner.text}
        </div>
      )}

      <SettingsSection title="Appearance">
        <AppearanceForm initial={theme} />
      </SettingsSection>

      <SettingsSection title="Timezone">
        <TimezoneForm current={tz} />
      </SettingsSection>

      <SettingsSection title="Modules">
        <ModulesForm
          healthEnabled={healthEnabled}
          routinesEnabled={routinesEnabled}
          ruleEnabled={ruleEnabled}
        />
      </SettingsSection>

      <SettingsSection title="Briefing · panels">
        <p className="font-sans text-[12px] text-ink-3 leading-relaxed mb-3">
          Show, hide, and reorder the panels on the home screen. Columns are
          fixed per panel; order applies within each column.
        </p>
        <BriefingPanelsForm rows={panelRows} />
      </SettingsSection>

      <SettingsSection title="AI · language model, transcription, photos">
        <AiSettingsForm current={appSettings} />
      </SettingsSection>

      <SettingsSection title="API tokens · agents & devices">
        <ApiTokensPanel tokens={tokens} />
      </SettingsSection>

      <SettingsSection title="Integration status">
        <p className="font-sans text-[13px] text-ink-2 leading-relaxed">
          Live inventory of which env-var-backed services are configured.
          No secret values shown — just &ldquo;configured / partial / missing&rdquo;
          per integration with helpful detail. Use it after deploys or env
          var rotations to verify everything is wired correctly.
        </p>
        <Link
          href="/settings/integrations"
          className="self-start mt-3 inline-block px-3 py-1.5 border border-line text-ink-2 hover:border-ink-2 hover:text-ink font-mono text-[10px] uppercase tracking-wider transition-colors"
        >
          Open integrations status →
        </Link>
      </SettingsSection>

      <SettingsSection title="Google Calendar">
        {statusError ? (
          <Hint>Couldn&rsquo;t read status: {statusError}</Hint>
        ) : !status.configured ? (
          <Hint>
            Set <code className="font-mono">GOOGLE_OAUTH_CLIENT_ID</code>,{' '}
            <code className="font-mono">GOOGLE_OAUTH_CLIENT_SECRET</code>, and{' '}
            <code className="font-mono">GOOGLE_OAUTH_REDIRECT_URI</code> in{' '}
            <code>.env</code> before connecting. All three must be present —
            the redirect URI must be the absolute callback URL, e.g.{' '}
            <code className="font-mono">
              https://api.your-domain.com/api/auth/google/callback
            </code>.
          </Hint>
        ) : status.connected ? (
          <ConnectedView status={status} tz={tz} />
        ) : (
          <DisconnectedView />
        )}
      </SettingsSection>
    </div>
  );
}

function DisconnectedView() {
  return (
    <div className="flex flex-col gap-3">
      <p className="font-sans text-[13px] text-ink-2 leading-relaxed">
        Connect your Google Calendar to pull events into Today&rsquo;s &ldquo;Up next&rdquo; view, and to
        push events created via voice (&ldquo;schedule call Thursday at 2&rdquo;) back to Google.
        Calendly bookings will appear here too because Calendly writes them to your
        Google Calendar.
      </p>
      {/* Server-action form (not a plain <a>): the action mints a signed
          bridge token tying the current Supabase user to the OAuth redirect,
          so the API can verify intent. <a href> can't carry a session header. */}
      <form action={beginGoogleOAuthAction}>
        <button
          type="submit"
          className="self-start bg-ink hover:bg-ink-2 text-bg font-sans font-semibold text-[13px] uppercase tracking-wider px-4 py-2.5 transition-colors"
        >
          Connect Google Calendar
        </button>
      </form>
    </div>
  );
}

function ConnectedView({ status, tz }: { status: GoogleStatus; tz: string }) {
  const lastSync = status.last_synced_at
    ? new Date(status.last_synced_at).toLocaleString('en-US', {
        timeZone: tz,
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    : 'never';

  return (
    <div className="flex flex-col gap-4">
      <div className="font-mono text-[11px] uppercase tracking-wider text-ink-3">
        Status · connected · last synced {lastSync}
      </div>
      <ActionButtons />
      <p className="font-sans text-[11px] text-ink-3 leading-relaxed">
        Scopes: {status.scope ?? '—'}
      </p>
    </div>
  );
}

// Client-component island for the form buttons (server actions + pending state).
import { ActionButtons } from './action-buttons';

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="font-sans text-[12px] text-ink-3 leading-relaxed">{children}</p>;
}
