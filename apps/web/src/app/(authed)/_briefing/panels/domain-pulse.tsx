import Link from 'next/link';
import { briefingApi, ApiError, type CadenceRow } from '@/lib/api';
import { PanelFrame, PanelLink } from '../PanelFrame';

// Domain pulse — every domain's cadence heartbeat + workload, from the
// GET /api/briefing/domains board payload (Agenda layout v2). Slipping
// domains sort first and read in accent; stale in warn; healthy domains
// stay quiet. This absorbs the old Needs-a-move panel: the slips are the
// top rows here, and the panel never renders empty.

const STATUS_ORDER: Record<CadenceRow['status'], number> = {
  slip: 0,
  stale: 1,
  ok: 2,
  unconfigured: 3,
};

export async function DomainPulsePanel() {
  let rows: CadenceRow[];
  try {
    rows = (await briefingApi.domains()).domains;
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    return null; // degrade quietly — the masthead already reports API trouble
  }
  if (rows.length === 0) return null;

  const sorted = [...rows].sort(
    (a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.name.localeCompare(b.name),
  );

  return (
    <PanelFrame
      eyebrow={<>Domain pulse · {sorted.length}</>}
      action={<PanelLink href="/work">All domains →</PanelLink>}
    >
      <div>
        {sorted.map((d) => (
          <div
            key={d.id}
            className="flex items-baseline gap-3 py-2.5 border-t border-line last:border-b"
          >
            <Link
              href={`/domains/${d.id}`}
              className="w-28 lg:w-32 shrink-0 font-sans text-[14px] font-semibold text-ink hover:text-accent transition-colors truncate"
            >
              {d.name}
            </Link>
            <div className="flex-1 min-w-0">
              {d.metric != null ? (
                <span
                  className={`font-sans text-[12px] ${
                    d.status === 'slip'
                      ? 'text-accent'
                      : d.status === 'stale'
                        ? 'text-warn'
                        : 'text-ink-3'
                  }`}
                >
                  <span className="font-serif text-[19px] font-medium mr-1 align-[-0.05em]">
                    {d.metric}
                  </span>
                  {d.unit}
                  {d.cadence != null && d.status !== 'ok' && (
                    <span className="text-ink-4"> · cadence {d.cadence}</span>
                  )}
                </span>
              ) : (
                <span className="font-sans text-[12px] text-ink-4 italic">
                  quiet — no cadence set
                </span>
              )}
            </div>
            {d.stats && (
              <div className="shrink-0 flex items-baseline gap-3 font-mono text-[10px] uppercase tracking-[0.05em] text-ink-3">
                <span>{d.stats.open_tasks} open</span>
                {d.stats.overdue > 0 && <span className="text-accent">{d.stats.overdue} overdue</span>}
                {d.stats.next_due && (
                  <span className="hidden sm:inline">due {d.stats.next_due.date.slice(5)}</span>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </PanelFrame>
  );
}
