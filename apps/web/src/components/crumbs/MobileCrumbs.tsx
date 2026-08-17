'use client';

import { CrumbTrail, useCrumbTrail } from './crumbs';

// Mobile counterpart to the Topbar trail (which is hidden < lg). Renders
// whenever the page registered any ancestors (trails never include the
// current item, so non-empty = there's somewhere to go up to). Index pages
// register nothing; the BottomTabBar carries page identity there.
//
// Deliberately IN-FLOW, not sticky: the Work page's mobile sticky domain
// headers assume top-0 (z-20) and the BottomTabBar owns z-40 — a sticky bar
// here would force re-budgeting both. If this ever becomes sticky, revisit
// work-view.tsx's `top-0 lg:top-[60px]` offsets.
export function MobileCrumbs() {
  const trail = useCrumbTrail();
  if (!trail) return null;
  return (
    <div className="lg:hidden h-9 px-5 flex items-center shrink-0 border-b border-line bg-bg overflow-x-auto">
      <CrumbTrail trail={trail} />
    </div>
  );
}
