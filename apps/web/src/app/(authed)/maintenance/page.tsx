import Link from 'next/link';
import { ApiError, maintenanceApi, type MaintenanceItem } from '@/lib/api';
import { completeItemAction } from './actions';
import { cadenceLabel, dueDateLabel, meterLabel } from './format';

// /maintenance — the recurring-upkeep ledger. Every active item with its
// cadence and next-due, banded by urgency (the API pre-sorts overdue →
// due → due_soon → ok). Completing an item logs it and re-anchors the
// schedule from today — the record recurring tasks never kept.

const BANDS: Array<{ statuses: string[]; label: string }> = [
  { statuses: ['overdue', 'due'], label: 'Due' },
  { statuses: ['due_soon'], label: 'Due soon' },
  { statuses: ['ok'], label: 'Upcoming' },
];

export default async function MaintenancePage() {
  let items: MaintenanceItem[] = [];
  let today = '';
  let errorMessage: string | null = null;
  try {
    const res = await maintenanceApi.list();
    items = res.items;
    today = res.today;
  } catch (err) {
    errorMessage = err instanceof ApiError ? `API ${err.status}` : (err as Error).message;
  }

  const overdueCount = items.filter(
    (i) => i.due_state?.status === 'overdue' || i.due_state?.status === 'due',
  ).length;

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
            {overdueCount > 0 ? ` · ${overdueCount} due` : ''}
            {' · '}completing re-anchors the schedule from today
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

// One rotation row. The disclosure opens the quick-complete form: date
// (defaults to today server-side), meter reading when the asset has one,
// optional notes/cost.
function ItemRow({ item, today }: { item: MaintenanceItem; today: string }) {
  const status = item.due_state?.status ?? 'ok';
  const urgent = status === 'overdue' || status === 'due';
  const dateLabel = dueDateLabel(item.next_due_date, today);
  const meter = meterLabel(item);
  const metered = item.asset?.meter_unit != null && item.interval_meter != null;

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
              <span className="font-sans text-[11px] text-ink-3">{item.asset.name}</span>
            )}
            <span className="font-mono text-[9px] tracking-[0.05em] px-1.5 py-px bg-surface-2 text-ink-3">
              ↻ {cadenceLabel(item)}
            </span>
          </span>
        </span>
        <span className="flex flex-col items-end gap-0.5 shrink-0 pt-0.5">
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
          {!dateLabel && !meter && (
            <span className="font-mono text-[10px] text-ink-3">needs a reading</span>
          )}
        </span>
      </summary>

      <form action={completeItemAction} className="ml-7 mb-4 flex flex-wrap items-end gap-3">
        <input type="hidden" name="id" value={item.id} />
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[9px] uppercase tracking-[0.08em] text-ink-3">Done on</span>
          <input
            type="date"
            name="completed_on"
            defaultValue={today}
            className="border border-line bg-surface px-2 py-1.5 font-sans text-[13px] text-ink"
          />
        </label>
        {metered && (
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[9px] uppercase tracking-[0.08em] text-ink-3">
              {item.asset?.meter_unit} reading
            </span>
            <input
              type="number"
              name="meter"
              min="0"
              step="any"
              placeholder={item.latest_reading != null ? String(item.latest_reading) : ''}
              className="w-28 border border-line bg-surface px-2 py-1.5 font-sans text-[13px] text-ink"
            />
          </label>
        )}
        <label className="flex flex-col gap-1 flex-1 min-w-[140px]">
          <span className="font-mono text-[9px] uppercase tracking-[0.08em] text-ink-3">Notes</span>
          <input
            type="text"
            name="notes"
            placeholder="optional"
            className="border border-line bg-surface px-2 py-1.5 font-sans text-[13px] text-ink"
          />
        </label>
        <button
          type="submit"
          className="bg-ink text-bg px-4 py-2 font-sans font-semibold text-[12px] uppercase tracking-wider hover:bg-ink-2 transition-colors"
        >
          Complete
        </button>
      </form>
    </details>
  );
}
