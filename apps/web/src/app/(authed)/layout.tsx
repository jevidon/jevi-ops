import { BottomTabBar } from '@/components/BottomTabBar';
import { DesktopRail } from '@/components/DesktopRail';
import { MicFAB } from '@/components/MicFAB';
import { requireUser } from '@/lib/auth';

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

  return (
    <div className="flex-1 flex">
      <DesktopRail email={user.email ?? undefined} />

      <div className="flex-1 flex flex-col min-w-0">
        {/* Inner wrapper: clamp width on mobile so the layout matches what
            we had before; on desktop, let it fill the rail-less space. */}
        <main className="flex-1 pb-24 lg:pb-12 mx-auto w-full max-w-[480px] lg:max-w-[1280px] lg:px-12">
          {children}
        </main>
        <MicFAB />
        <BottomTabBar />
      </div>
    </div>
  );
}
