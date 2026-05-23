import { ScreenHeader } from '@/components/ScreenHeader';
import { googleApi, ApiError, type GoogleStatus } from '@/lib/api';
import { SettingsSection } from './settings-section';
import { beginGoogleOAuthAction } from './actions';

// /settings — integrations and account controls. Lives outside the six-tab
// nav (it's reachable from the rail's email footer or by direct URL).

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ google?: string; reason?: string }>;
}) {
  const { google: googleParam, reason } = await searchParams;

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

      <SettingsSection title="Google Calendar">
        {statusError ? (
          <Hint>Couldn't read status: {statusError}</Hint>
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
          <ConnectedView status={status} />
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
        Connect your Google Calendar to pull events into Today's "Up next" view, and to
        push events created via voice ("schedule call Thursday at 2") back to Google.
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

function ConnectedView({ status }: { status: GoogleStatus }) {
  const lastSync = status.last_synced_at
    ? new Date(status.last_synced_at).toLocaleString('en-US', {
        timeZone: 'America/Denver',
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
