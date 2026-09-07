import Link from 'next/link';
import { ApiError, maintenanceApi, type MaintenanceItem } from '@/lib/api';
import { CompleteForm } from './complete-form';
import { cadenceLabel, dataLabel, dueDateLabel, meterLabel, statusLabel } from './format';

// /maintenance — the recurring-upkeep ledger. Every active item with its
// cadence and next-due, banded by urgency (the API pre-sorts overdue →
// due → due_soon → ok). Completing an item logs it and re-anchors the
// schedule from the evidence — the record recurring tasks never kept.
//
// Urgency and data confidence are shown separately: an "on track" row
// whose meter axis has no baseline says so, instead of looking healthy.

const BANDS: Array<{ statuses: string[]; label: string }> = [
  { statuses: ['overdue', 'due'], label: 'Due' },
  { statuses: ['due_soon'], label: 'Due soon' },
  { statuses: ['ok'], label: 'Upcoming' },
];

export default async function MaintenancePage() {
  let items: MaintenanceItem[] = [];
  let today = '';
  let staleDays = 14;
  let errorMessage: string | null = null;
  try {
    const res = await maintenanceApi.list();
    items = res.items;
    today = res.today;
    staleDays = res.meter_stale_days;
  } catch (err) {
    errorMessage = err instanceof ApiError ? `API ${err.status}` : (err as Error).message;
  }

  const dueCount = items.filter(
    (i) => i.due_state?.status === 'overdue' || i.due_state?.status === 'due',
  ).length;
  const unknownCount = items.filter((i) => i.due_state && i.due_state.data !== 'complete').length;

  return (
    <div className="pb-32">
      {/* ─── Masthead ─────────────────────────────────────────────── */}
      <div className="px-5 lg:px-0 pt-5 flex items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-[28px] font-medium tracking-[-0.4px] text-ink leading-none">
            Maintenance
          </h1>
          <div className="mt-1.5 font-sans text-[12px] text-ink-3">
            {items.length} in rotation
            {dueCount > 0 ? ` · ${dueCount} due` : ''}
            {unknownCount > 0 ? ` · ${unknownCount} need a reading` : ''}
            {` · readings expected every ${staleDays} days`}
          </div>
        </div>
        <Link
          href="/maintenance/assets"
          className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3 hover:text-ink-2 transition-colors pb-0.5"
        >
          Assets →
        </Link>
      </div>

      <div className="hairline mt-4 mx-5 lg:mx-0" />

      {errorMessage && (
        <div className="px-5 lg:px-0 mt-6 font-sans text-[13px] text-ink-3">
          Couldn&rsquo;t load maintenance items: {errorMessage}
        </div>
      )}

      {/* ─── Urgency bands ────────────────────────────────────────── */}
      <div className="px-5 lg:px-0 mt-5">
        {items.length === 0 && !errorMessage ? (
          <p className="font-sans text-[13px] text-ink-3 italic">
            Nothing in rotation yet. Add the things you replace, service, or renew
            on a rhythm — filters, vehicle service, registrations — and this page
            keeps the schedule.
          </p>
        ) : (
          BANDS.map((band) => {
            const rows = items.filter((i) => band.statuses.includes(i.due_state?.status ?? 'ok'));
            if (rows.length === 0) return null;
            return (
              <div key={band.label} className="mb-6">
                <div className="flex items-baseline justify-between mb-2">
                  <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3">
                    {band.label}
                  </span>
                  <span className="font-mono text-[10px] text-ink-3">{rows.length}</span>
                </div>
                {rows.map((item) => (
                  <ItemRow key={item.id} item={item} today={today} />
                ))}
              </div>
            );
          })
        )}
      </div>

      {/* ─── Footer add ──────────────────────────────────────────── */}
      <div className="mx-5 lg:mx-0 mt-10">
        <Link
          href="/maintenance/new"
          className="block border border-dashed border-line-strong px-4 py-3 text-center font-sans text-[13px] text-ink-2 hover:text-ink hover:border-ink-2 transition-colors"
        >
          + Add a maintenance item
        </Link>
      </div>
    </div>
  );
}

// One rotation row. The disclosure opens the policy-adapted completion
// form (date + reading for a service; new expiry for a renewal; purchased
// distance for RUC; finding + next review for an inspection).
function ItemRow({ item, today }: { item: MaintenanceItem; today: string }) {
  const status = item.due_state?.status ?? 'ok';
  const urgent = status === 'overdue' || status === 'due';
  const dateLabel = dueDateLabel(item.next_due_date, today);
  const meter = meterLabel(item);
  const data = dataLabel(item);

  return (
    <details className="group border-b border-line">
      <summary className="flex gap-3 items-start py-3 cursor-pointer list-none [&::-webkit-details-marker]:hidden">
        <span
          aria-hidden
          className="mt-1 h-4 w-4 border border-ink-3 group-hover:border-ink group-open:bg-surface-2 transition-colors block shrink-0"
        />
        <span className="flex-1 min-w-0">
          <span className="block font-sans text-[14px] font-medium text-ink leading-snug">
            <Link href={`/maintenance/${item.id}`} className="hover:opacity-80 transition-opacity">
              {item.name}
            </Link>
          </span>
          <span className="mt-1 flex items-center gap-2 flex-wrap">
            {item.asset?.name && (
              <Link href={`/maintenance/assets/${item.asset.id}`} className="font-sans text-[11px] text-ink-3 hover:text-ink-2">
                {item.asset.name}
              </Link>
            )}
            <span className="font-mono text-[9px] tracking-[0.05em] px-1.5 py-px bg-surface-2 text-ink-3">
              ↻ {cadenceLabel(item)}
            </span>
            {data && (
              <span className="font-mono text-[9px] tracking-[0.05em] px-1.5 py-px border border-dashed border-line-strong text-ink-3">
                {data}
              </span>
            )}
          </span>
        </span>
        <span className="flex flex-col items-end gap-0.5 shrink-0 pt-0.5">
          <span className={`font-mono text-[9.5px] uppercase tracking-[0.06em] ${urgent ? 'text-accent' : 'text-ink-3'}`}>
            {statusLabel(item)}
          </span>
          {dateLabel && (
            <span className={`font-mono text-[10px] tabular-nums ${urgent && item.due_state?.trigger === 'date' ? 'text-accent' : 'text-ink-3'}`}>
              {dateLabel}
            </span>
          )}
          {meter && (
            <span className={`font-mono text-[10px] tabular-nums ${urgent && item.due_state?.trigger === 'meter' ? 'text-accent' : 'text-ink-3'}`}>
              {meter}
            </span>
          )}
        </span>
      </summary>

      <CompleteForm item={item} today={today} className="ml-7 mb-4" />
    </details>
  );
}
