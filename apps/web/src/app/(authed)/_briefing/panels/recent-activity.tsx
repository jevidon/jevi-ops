import { cache } from 'react';
import { briefingApi } from '@/lib/api';
import { PanelFrame, PanelLink } from '../PanelFrame';
import type { BriefingContext } from '../registry';
import { RecentActivityList } from './recent-activity-list';

const loadActivity = cache(async () => {
  try {
    return await briefingApi.activity();
  } catch {
    return null;
  }
});

export async function RecentActivityPanel({ placement = 'main' }: {
  ctx: BriefingContext;
  placement?: 'main' | 'rail-mobile';
}) {
  const activity = await loadActivity();

  return (
    <PanelFrame eyebrow="Recent activity" className={placement === 'main' ? 'hidden lg:block' : 'lg:hidden'}>
      {activity === null ? (
        <div className="text-[13px] text-ink-3">
          <p>Recent activity didn’t load.</p>
          <PanelLink href="/">Retry →</PanelLink>
        </div>
      ) : activity.entries.length === 0 ? (
        <p className="text-[13px] italic text-ink-3">
          Nothing in the last 7 days. Tasks you add, capture, finish or set waiting, and new content, show up here.
        </p>
      ) : (
        <RecentActivityList entries={activity.entries} />
      )}
    </PanelFrame>
  );
}
