import Link from 'next/link';
import type { AttentionItem } from '@/lib/api';
import { Pill } from '@/components/Pill';
import { silenceUrgency, silenceLabel } from '@/lib/silence';
import { logCheckInAction } from '../../today/actions';
import { PanelFrame, PanelLink } from '../PanelFrame';
import type { BriefingContext } from '../registry';

// Silent clients — the company_silent attention rule pulled into its own
// panel (so it isn't shown twice under Attention), with an inline check-in.

// Days-silent parsed out of the company_silent detail ("No conversation in N
// days" | "No conversation logged yet") — feeds the shared silence pill.
function silentDays(detail: string | null): number | null {
  if (!detail) return null;
  const m = detail.match(/(\d+)\s*day/);
  return m ? Number(m[1]) : null;
}

export function SilentClientsPanel({ ctx }: { ctx: BriefingContext }) {
  const { silentClients } = ctx;
  if (silentClients.length === 0) return null;
  return (
    <PanelFrame
      eyebrow={<>Silent clients · {silentClients.length}</>}
      action={<PanelLink href="/companies">Companies →</PanelLink>}
      headerGap="mb-2"
    >
      <ul>
        {silentClients.map((c) => (
          <SilentClientRow key={c.id} item={c} />
        ))}
      </ul>
    </PanelFrame>
  );
}

function SilentClientRow({ item }: { item: AttentionItem }) {
  const name = item.title.replace(/^Silent client:\s*/i, '');
  const days = silentDays(item.detail);
  return (
    <li className="flex items-center gap-3.5 py-3 border-b border-line">
      <Link href={`/companies/${item.source_id}`} className="flex-1 min-w-0 group">
        <div className="font-serif text-[15px] font-medium text-ink group-hover:text-accent transition-colors truncate">{name}</div>
        {item.detail && <div className="mt-0.5 font-mono text-[11px] text-ink-3">{item.detail}</div>}
      </Link>
      {/* Every silent client is already past the rule's cadence; a never-
          contacted one (days null) is the most urgent, not calm. */}
      <Pill state={days == null ? 'over' : silenceUrgency(days)}>{silenceLabel(days)}</Pill>
      <form action={logCheckInAction} className="shrink-0">
        <input type="hidden" name="company_id" value={item.source_id} />
        <button
          type="submit"
          className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-2 border border-line-strong rounded px-2.5 py-1.5 hover:border-ink-3 hover:text-ink transition-colors whitespace-nowrap"
        >
          Log check-in
        </button>
      </form>
    </li>
  );
}
