import Link from 'next/link';
import type { MaintenanceItem } from '@/lib/api';
import { CompleteForm } from '../../maintenance/complete-form';
import { cadenceLabel, dataLabel, dueDateLabel, meterLabel, statusLabel } from '../../maintenance/format';

// The per-asset service schedule (0049): every item grouped by system
// (Fluids, Brakes, Legal…), one row each — Item · Interval · Last done ·
// Next due · Remaining · Status — with the policy-adapted completion form
// behind the row. Last done / next due are reading-and-date pairs; status
// names the axis that tripped; data confidence prints separately.
//
// SCOPE: rows the API marks tracked:false (paused items) sit in their own
// trailing "Paused" group with no completion form — they keep their
// schedule for reference but count nowhere and prompt nothing. readOnly
// (a stored/sold/archived asset) drops the completion forms everywhere.
//
// Below the desktop gate the row keeps BOTH pairs, stacked and labelled —
// nothing a phone reader needs is hidden.

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

export function ServiceSchedule({
  items,
  today,
  unit,
  readOnly = false,
}: {
  items: MaintenanceItem[];
  today: string;
  unit: string | null;
  readOnly?: boolean;
}) {
  if (items.length === 0) {
    return (
      <p className="font-sans text-[13px] text-ink-3 italic py-1">
        Nothing scheduled on this asset yet.
      </p>
    );
  }
  const u = unit ?? '';
  const live = items.filter((i) => i.tracked !== false);
  const paused = items.filter((i) => i.tracked === false);

  const row = (item: MaintenanceItem, opts: { paused: boolean }) => {
    const s = item.due_state;
    const muted = opts.paused || readOnly;
    const urgent = !muted && (s?.status === 'overdue' || s?.status === 'due');
    const remaining = [dueDateLabel(item.next_due_date, today), meterLabel(item)].filter(Boolean).join(' · ');
    const data = dataLabel(item);
    const last = pair(item.last_completed_on, item.last_completed_meter, u);
    const next = pair(item.next_due_date, item.next_due_meter, u);
    const summary = (
      <div className={`${COLS} py-3`}>
        <span className="min-w-0">
          <Link href={`/maintenance/${item.id}`} className={`font-sans text-[14px] font-medium hover:opacity-80 transition-opacity ${muted ? 'text-ink-2' : 'text-ink'}`}>
            {item.name}
          </Link>
          {item.notes && (
            <span className="block font-mono text-[10.5px] text-ink-3 truncate">{item.notes}</span>
          )}
          {/* Phone: both pairs, labelled, stacked. */}
          <span className="lg:hidden block mt-1 font-mono text-[10px] tabular-nums text-ink-3 leading-relaxed">
            <span className="block">↻ {cadenceLabel(item)}</span>
            <span className="block"><span className="uppercase tracking-[0.06em] text-ink-4">Last done</span> {last}</span>
            <span className="block"><span className="uppercase tracking-[0.06em] text-ink-4">Next due</span> {next}</span>
          </span>
        </span>
        <span className={`${cell} hidden lg:block`}>{cadenceLabel(item)}</span>
        <span className={`${cell} hidden lg:block`}>{last}</span>
        <span className={`${cell} hidden lg:block`}>{next}</span>
        <span className={`${cell} hidden lg:block ${urgent ? 'text-accent' : ''}`}>{remaining || '—'}</span>
        <span className="text-right lg:text-left">
          <span className={`block font-mono text-[9.5px] uppercase tracking-[0.06em] ${urgent ? 'text-accent' : 'text-ink-3'}`}>
            {opts.paused ? 'Paused' : statusLabel(item)}
          </span>
          <span className={`lg:hidden block font-mono text-[10px] tabular-nums ${urgent ? 'text-accent' : 'text-ink-3'}`}>{remaining}</span>
          {data && !opts.paused && (
            <span className="block mt-0.5 font-mono text-[9px] tracking-[0.05em] px-1 py-px border border-dashed border-line-strong text-ink-3 w-fit lg:w-auto ml-auto lg:ml-0">
              {data}
            </span>
          )}
        </span>
      </div>
    );
    if (muted) {
      return (
        <div key={item.id} id={`item-${item.id}`} className="border-b border-line opacity-70">
          {summary}
        </div>
      );
    }
    return (
      <details key={item.id} id={`item-${item.id}`} className="group border-b border-line">
        <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">{summary}</summary>
        <CompleteForm item={item} today={today} className="mb-4" />
      </details>
    );
  };

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
      {groupBySystem(live).map((g) => (
        <div key={g.system}>
          <div className="pt-4 pb-1 flex items-baseline gap-2">
            <span className="font-mono text-[9.5px] uppercase tracking-[0.12em] text-ink-3">{g.system}</span>
            <span className="font-mono text-[10px] text-ink-4">{g.items.length}</span>
          </div>
          {g.items.map((item) => row(item, { paused: false }))}
        </div>
      ))}
      {paused.length > 0 && (
        <div>
          <div className="pt-4 pb-1 flex items-baseline gap-2">
            <span className="font-mono text-[9.5px] uppercase tracking-[0.12em] text-ink-3">Paused</span>
            <span className="font-mono text-[10px] text-ink-4">{paused.length}</span>
            <span className="font-sans text-[11px] text-ink-4">— kept for reference; nothing here counts or prompts</span>
          </div>
          {paused.map((item) => row(item, { paused: true }))}
        </div>
      )}
      <p className="mt-3 font-mono text-[9.5px] uppercase tracking-[0.06em] text-ink-4">
        {readOnly ? 'Schedules paused while the asset is not active' : 'Open a row to record it'} · the cross-asset rotation lives at{' '}
        <Link href="/maintenance" className="hover:text-ink-2">/maintenance</Link>
      </p>
    </div>
  );
}
