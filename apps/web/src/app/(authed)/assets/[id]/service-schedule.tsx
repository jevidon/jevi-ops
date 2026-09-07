import Link from 'next/link';
import type { MaintenanceItem } from '@/lib/api';
import { CompleteForm } from '../../maintenance/complete-form';
import { cadenceLabel, dataLabel, dueDateLabel, meterLabel, statusLabel } from '../../maintenance/format';

// The per-asset service schedule (0049): every item grouped by system
// (Fluids, Brakes, Legal…), one row each — Item · Interval · Last done ·
// Next due · Remaining · Status — with the policy-adapted completion form
// behind the row. Last done / next due are reading-and-date pairs; status
// names the axis that tripped; data confidence prints separately. Below
// the desktop gate the row stacks to two columns and the header row goes.

const GENERAL = 'General';

function groupBySystem(items: MaintenanceItem[]): Array<{ system: string; items: MaintenanceItem[] }> {
  const map = new Map<string, MaintenanceItem[]>();
  for (const i of items) {
    const key = i.system?.trim() || GENERAL;
    const list = map.get(key) ?? [];
    list.push(i);
    map.set(key, list);
  }
  return [...map.entries()]
    .map(([system, list]) => ({ system, items: list }))
    .sort((a, b) => (a.system === GENERAL ? 1 : b.system === GENERAL ? -1 : a.system.localeCompare(b.system)));
}

const COLS =
  'grid grid-cols-[minmax(0,1fr)_auto] lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)_minmax(0,1.1fr)_minmax(0,1.1fr)_minmax(0,.9fr)_minmax(0,1.1fr)] gap-x-4 items-baseline';
const cell = 'font-mono text-[11px] tabular-nums text-ink-2';
const hdr = 'font-mono text-[9.5px] uppercase tracking-[0.08em] text-ink-3';

function pair(date: string | null | undefined, meter: number | null | undefined, unit: string): string {
  const parts = [meter != null ? `${meter.toLocaleString('en-US')} ${unit}`.trim() : null, date ?? null].filter(Boolean);
  return parts.length ? parts.join(' · ') : '—';
}

export function ServiceSchedule({ items, today, unit }: { items: MaintenanceItem[]; today: string; unit: string | null }) {
  if (items.length === 0) {
    return (
      <p className="font-sans text-[13px] text-ink-3 italic py-1">
        Nothing scheduled on this asset yet.
      </p>
    );
  }
  const u = unit ?? '';
  return (
    <div>
      <div className={`${COLS} hidden lg:grid pb-2 border-b border-line-strong`}>
        <span className={hdr}>Item</span>
        <span className={hdr}>Interval</span>
        <span className={hdr}>Last done</span>
        <span className={hdr}>Next due</span>
        <span className={hdr}>Remaining</span>
        <span className={hdr}>Status</span>
      </div>
      {groupBySystem(items).map((g) => (
        <div key={g.system}>
          <div className="pt-4 pb-1 flex items-baseline gap-2">
            <span className="font-mono text-[9.5px] uppercase tracking-[0.12em] text-ink-3">{g.system}</span>
            <span className="font-mono text-[10px] text-ink-4">{g.items.length}</span>
          </div>
          {g.items.map((item) => {
            const s = item.due_state;
            const urgent = s?.status === 'overdue' || s?.status === 'due';
            const remaining = [dueDateLabel(item.next_due_date, today), meterLabel(item)].filter(Boolean).join(' · ');
            const data = dataLabel(item);
            return (
              <details key={item.id} id={`item-${item.id}`} className="group border-b border-line">
                <summary className={`${COLS} py-3 cursor-pointer list-none [&::-webkit-details-marker]:hidden`}>
                  <span className="min-w-0">
                    <Link href={`/maintenance/${item.id}`} className="font-sans text-[14px] font-medium text-ink hover:opacity-80 transition-opacity">
                      {item.name}
                    </Link>
                    {item.notes && (
                      <span className="block font-mono text-[10.5px] text-ink-3 truncate">{item.notes}</span>
                    )}
                    <span className="lg:hidden block mt-0.5 font-mono text-[10px] text-ink-3">↻ {cadenceLabel(item)}</span>
                  </span>
                  <span className={`${cell} hidden lg:block`}>{cadenceLabel(item)}</span>
                  <span className={`${cell} hidden lg:block`}>{pair(item.last_completed_on, item.last_completed_meter, u)}</span>
                  <span className={`${cell} hidden lg:block`}>{pair(item.next_due_date, item.next_due_meter, u)}</span>
                  <span className={`${cell} hidden lg:block ${urgent ? 'text-accent' : ''}`}>{remaining || '—'}</span>
                  <span className="text-right lg:text-left">
                    <span className={`block font-mono text-[9.5px] uppercase tracking-[0.06em] ${urgent ? 'text-accent' : 'text-ink-3'}`}>
                      {statusLabel(item)}
                    </span>
                    <span className={`lg:hidden block font-mono text-[10px] tabular-nums ${urgent ? 'text-accent' : 'text-ink-3'}`}>{remaining}</span>
                    {data && (
                      <span className="block mt-0.5 font-mono text-[9px] tracking-[0.05em] px-1 py-px border border-dashed border-line-strong text-ink-3 w-fit lg:w-auto ml-auto lg:ml-0">
                        {data}
                      </span>
                    )}
                  </span>
                </summary>
                <CompleteForm item={item} today={today} className="mb-4" />
              </details>
            );
          })}
        </div>
      ))}
      <p className="mt-3 font-mono text-[9.5px] uppercase tracking-[0.06em] text-ink-4">
        Open a row to record it · the cross-asset rotation lives at{' '}
        <Link href="/maintenance" className="hover:text-ink-2">/maintenance</Link>
      </p>
    </div>
  );
}
