import Link from 'next/link';
import { PanelFrame, PanelLink } from '../PanelFrame';
import type { BriefingContext } from '../registry';

// Agenda — today's rail anchor. Currently the count + next-event stub the
// page always had; the real merged event/task timeline (briefingApi.agenda)
// replaces these internals in a follow-up commit.

export function AgendaPanel({ ctx }: { ctx: BriefingContext }) {
  const { briefing } = ctx;
  if (!briefing || briefing.events_today_count === 0) return null;
  return (
    <PanelFrame
      eyebrow={<>Today · {briefing.events_today_count} {briefing.events_today_count === 1 ? 'event' : 'events'}</>}
      action={<PanelLink href="/calendar">Open →</PanelLink>}
    >
      {briefing.next_event && (
        <Link href="/calendar" className="flex items-baseline gap-4 py-1.5 border-b border-line hover:opacity-80 transition-opacity">
          <span className="font-mono text-[12px] text-ink tabular-nums shrink-0 w-12">{briefing.next_event.time}</span>
          <span className="font-sans text-[13px] text-ink-2 truncate">{briefing.next_event.title}</span>
        </Link>
      )}
      {briefing.events_today_count > 1 && (
        <Link href="/calendar" className="mt-2 inline-block font-mono text-[10px] uppercase tracking-wider text-ink-3 hover:text-accent transition-colors">
          + {briefing.events_today_count - 1} more →
        </Link>
      )}
    </PanelFrame>
  );
}
