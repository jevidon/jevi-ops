import { BottomTabBar } from '@/components/BottomTabBar';
import { MicFAB } from '@/components/MicFAB';
import { requireUser } from '@/lib/auth';

// Every page inside the (authed) group requires a signed-in user — checked
// in middleware AND here as defense-in-depth. Tab bar + floating mic FAB
// are rendered once here so they don't appear on /sign-in.

export default async function AuthedLayout({ children }: { children: React.ReactNode }) {
  await requireUser();

  return (
    <>
      <main className="flex-1 pb-24">{children}</main>
      <MicFAB />
      <BottomTabBar />
    </>
  );
}
