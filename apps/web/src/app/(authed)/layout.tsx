import { BottomTabBar } from '@/components/BottomTabBar';
import { IconRail } from '@/components/IconRail';
import { Topbar } from '@/components/Topbar';
import { Suspense } from 'react';
import { CrumbsProvider } from '@/components/crumbs/crumbs';
import { MobileCrumbs } from '@/components/crumbs/MobileCrumbs';
import { ToastProvider } from '@/components/toast/ToastProvider';
import { CreatedTaskToast } from '@/components/toast/CreatedTaskToast';
import { MicFAB } from '@/components/MicFAB';
import { TextCaptureFAB } from '@/components/TextCaptureFAB';
import { NotificationBell } from '@/components/NotificationBell';
import { SearchHotkey } from '@/components/SearchHotkey';
import { CapturePortal } from '@/components/capture/CapturePortal';
import { TimezoneProvider } from '@/components/TimezoneProvider';
import { requireUser } from '@/lib/auth';
import { notificationsApi, attentionApi, ApiError } from '@/lib/api';
import { getAppTimezone, getFeatureFlag } from '@/lib/app-settings';

// Every page inside the (authed) group requires a signed-in user — checked
// in middleware AND here as defense-in-depth.
//
// Responsive layout:
//   Mobile (default): single column capped at 480px, BottomTabBar at the
//     bottom, floating MicFAB.
//   Desktop (lg+):    DesktopRail on the left (220px wide), main content
//     flows right of the rail with generous padding, no BottomTabBar.
// The MicFAB renders on both — it's already absolute-positioned to the
// bottom-right.

export default async function AuthedLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  // Fetch unread notification count so the rail badge stays in sync across
  // navigation. Best-effort — a failure here just hides the badge.
  let unreadNotifications = 0;
  let attentionActive = 0;
  try {
    const [notif, attention] = await Promise.allSettled([
      notificationsApi.count(),
      attentionApi.count(),
    ]);
    if (notif.status === 'fulfilled') unreadNotifications = notif.value.unread;
    if (attention.status === 'fulfilled') attentionActive = attention.value.active;
  } catch (err) {
    if (!(err instanceof ApiError)) {
      // swallow; the layout shouldn't block on observability
    }
  }

  // Pull the configured timezone once per request and pass it into a
  // client-side context so date/time-aware UI (DateInput, the routine
  // strip, etc.) doesn't need to hardcode 'America/Denver'.
  const timezone = await getAppTimezone();
  const healthEnabled = await getFeatureFlag('health_module_enabled');
  const routinesEnabled = await getFeatureFlag('routines_module_enabled');

  return (
    <TimezoneProvider timezone={timezone}>
      <CrumbsProvider>
      <ToastProvider>
      <div className="flex-1 flex">
        <IconRail
          email={user.email ?? undefined}
          unreadNotifications={unreadNotifications}
          attentionActive={attentionActive}
          healthEnabled={healthEnabled}
          routinesEnabled={routinesEnabled}
        />

        <div className="flex-1 flex flex-col min-w-0">
          {/* v2 topbar (desktop only) — breadcrumb + search + Capture. */}
          <Topbar />

          {/* Mobile crumb line — renders only on detail pages (trail depth
              >= 2); in-flow so Work's sticky headers keep their offsets. */}
          <MobileCrumbs />

          {/* Inner wrapper: FLUID up to the desktop gate — no mobile max-width
              cap, so a wider-than-typical viewport (e.g. a foldable's cover
              screen) fills edge to edge instead of centering with side gutters.
              Each page owns its own horizontal padding (px-5 below lg), so
              dropping the cap doesn't push content to the bezel. On desktop the
              1120px cap + mx-auto centers within the rail-less space.

              Bottom padding adapts: a base value clears the tab bar in
              regular Safari (where env(safe-area-inset-bottom) is 0), and
              the inset adds on top of that in PWA mode so the last row of
              content stays above the home indicator without any over-
              padding in browser mode. */}
          <main
            className="flex-1 lg:pb-12 mx-auto w-full lg:max-w-[1120px] lg:px-10"
            style={{ paddingBottom: 'calc(5rem + env(safe-area-inset-bottom))' }}
          >
            {children}
          </main>
          <MicFAB />
          <TextCaptureFAB />
          <NotificationBell unread={unreadNotifications} />
          <BottomTabBar
            email={user.email ?? undefined}
            unreadNotifications={unreadNotifications}
            attentionActive={attentionActive}
            healthEnabled={healthEnabled}
            routinesEnabled={routinesEnabled}
          />
          <SearchHotkey />
          <CapturePortal />
          {/* Fires the "Task created" toast after a return-to-origin
              redirect (?created=<id>); Suspense keeps useSearchParams from
              deopting the authed tree to client rendering. */}
          <Suspense>
            <CreatedTaskToast />
          </Suspense>
        </div>
      </div>
      </ToastProvider>
      </CrumbsProvider>
    </TimezoneProvider>
  );
}
