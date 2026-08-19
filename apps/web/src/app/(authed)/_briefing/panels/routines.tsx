import Link from 'next/link';
import { RoutinesTodayList } from '@/app/(authed)/routines/routines-today-list';
import { PanelFrame, PanelLink } from '../PanelFrame';
import type { BriefingContext } from '../registry';

// Routines — today's check-offs, compact. Module-gated via the registry
// (routines_module_enabled), so this component never renders while the
// module is off.

export function RoutinesPanel({ ctx }: { ctx: BriefingContext }) {
  const { routines, routinesFailed, rDone, rTotal, today } = ctx;
  return (
    <PanelFrame
      eyebrow={<>Routines · {rDone} of {rTotal} today</>}
      action={<PanelLink href="/routines">All →</PanelLink>}
    >
      {routines.length > 0 ? (
        <RoutinesTodayList routines={routines} compact today={today} />
      ) : (
        <Link href="/routines" className="block font-sans text-[13px] text-ink-3 italic hover:text-ink-2 transition-colors">
          {routinesFailed
            ? 'Couldn’t load routines — open /routines to check.'
            : 'No active routines. Add one →'}
        </Link>
      )}
    </PanelFrame>
  );
}
