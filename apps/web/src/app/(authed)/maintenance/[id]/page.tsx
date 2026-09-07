import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ApiError, assetsApi, domainsApi, maintenanceApi } from '@/lib/api';
import {
  completeItemAction,
  deleteItemAction,
  deleteLogAction,
  setItemActiveAction,
} from '../actions';
import { cadenceLabel, dueDateLabel, meterLabel } from '../format';
import { ItemForm, type AssetOption, type DomainOption } from '../item-form';

// /maintenance/[id] — one item: current schedule state, quick complete,
// the full completion history (with undo), and the edit form.

export default async function MaintenanceItemPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let data: Awaited<ReturnType<typeof maintenanceApi.get>>;
  try {
    data = await maintenanceApi.get(id);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }
  const { item, logs, today } = data;

  let assets: AssetOption[] = [];
  let domains: DomainOption[] = [];
  try {
    const [a, d] = await Promise.all([assetsApi.list(), domainsApi.list()]);
    assets = a.assets.map(({ id: aid, name, meter_unit }) => ({ id: aid, name, meter_unit }));
    domains = d.domains.map(({ id: did, name }) => ({ id: did, name }));
  } catch {
    /* edit form renders with empty pickers */
  }

  const dateLabel = dueDateLabel(item.next_due_date, today);
  const meter = meterLabel(item);
  const metered = item.asset?.meter_unit != null && item.interval_meter != null;
  const unit = item.asset?.meter_unit ?? '';

  return (
    <div className="pb-32">
      {/* ─── Masthead ─────────────────────────────────────────────── */}
      <div className="px-5 lg:px-0 pt-5">
        <Link
          href="/maintenance"
          className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3 hover:text-ink-2 transition-colors mb-2 w-fit"
        >
          <span className="h-[5px] w-[5px] rounded-full bg-accent" aria-hidden />
          From Maintenance
        </Link>
        <h1 className="font-serif text-[28px] font-medium tracking-[-0.4px] text-ink leading-none">
          {item.name}
        </h1>
        <div className="mt-1.5 flex items-center gap-2 flex-wrap font-sans text-[12px] text-ink-3">
          {item.asset && (
            <Link href={`/maintenance/assets/${item.asset.id}`} className="hover:text-ink-2 transition-colors">
              {item.asset.name}
            </Link>
          )}
          <span className="font-mono text-[9px] tracking-[0.05em] px-1.5 py-px bg-surface-2">
            ↻ {cadenceLabel(item)}
          </span>
          {!item.active && (
            <span className="font-mono text-[9px] uppercase tracking-[0.05em] px-1.5 py-px bg-surface-2">
              inactive
            </span>
          )}
        </div>
      </div>

      <div className="hairline mt-4 mx-5 lg:mx-0" />

      {/* ─── Schedule state + quick complete ──────────────────────── */}
      <div className="px-5 lg:px-0 mt-5">
        <div className="flex items-baseline gap-4 flex-wrap">
          <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3">Next due</span>
          {dateLabel && <span className="font-mono text-[12px] tabular-nums text-ink">{dateLabel}</span>}
          {meter && <span className="font-mono text-[12px] tabular-nums text-ink">{meter}</span>}
          {!dateLabel && !meter && (
            <span className="font-sans text-[12px] text-ink-3 italic">
              needs a meter reading to anchor the schedule
            </span>
          )}
          {item.last_completed_on && (
            <span className="font-sans text-[12px] text-ink-3">
              last done {item.last_completed_on}
              {item.last_completed_meter != null
                ? ` at ${item.last_completed_meter.toLocaleString('en-US')} ${unit}`.trimEnd()
                : ''}
            </span>
          )}
        </div>

        <form action={completeItemAction} className="mt-4 flex flex-wrap items-end gap-3">
          <input type="hidden" name="id" value={item.id} />
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[9px] uppercase tracking-[0.08em] text-ink-3">Done on</span>
            <input type="date" name="completed_on" defaultValue={today}
              className="border border-line bg-surface px-2 py-1.5 font-sans text-[13px] text-ink" />
          </label>
          {metered && (
            <label className="flex flex-col gap-1">
              <span className="font-mono text-[9px] uppercase tracking-[0.08em] text-ink-3">{unit} reading</span>
              <input type="number" name="meter" min="0" step="any"
                placeholder={item.latest_reading != null ? String(item.latest_reading) : ''}
                className="w-28 border border-line bg-surface px-2 py-1.5 font-sans text-[13px] text-ink" />
            </label>
          )}
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[9px] uppercase tracking-[0.08em] text-ink-3">Cost</span>
            <input type="number" name="cost" min="0" step="any" placeholder="—"
              className="w-24 border border-line bg-surface px-2 py-1.5 font-sans text-[13px] text-ink" />
          </label>
          <label className="flex flex-col gap-1 flex-1 min-w-[140px]">
            <span className="font-mono text-[9px] uppercase tracking-[0.08em] text-ink-3">Notes</span>
            <input type="text" name="notes" placeholder="optional"
              className="border border-line bg-surface px-2 py-1.5 font-sans text-[13px] text-ink" />
          </label>
          <button type="submit"
            className="bg-ink text-bg px-4 py-2 font-sans font-semibold text-[12px] uppercase tracking-wider hover:bg-ink-2 transition-colors">
            Complete
          </button>
        </form>
      </div>

      {/* ─── History ──────────────────────────────────────────────── */}
      <div className="px-5 lg:px-0 mt-8">
        <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3 mb-2">
          History · {logs.length}
        </div>
        {logs.length === 0 ? (
          <p className="font-sans text-[13px] text-ink-3 italic">No completions logged yet.</p>
        ) : (
          logs.map((log) => (
            <div key={log.id} className="flex items-baseline gap-3 py-2 border-b border-line group">
              <span className="font-mono text-[12px] tabular-nums text-ink">{log.completed_on}</span>
              {log.meter_at_completion != null && (
                <span className="font-mono text-[11px] tabular-nums text-ink-3">
                  {log.meter_at_completion.toLocaleString('en-US')} {unit}
                </span>
              )}
              {log.cost != null && (
                <span className="font-mono text-[11px] tabular-nums text-ink-3">${log.cost}</span>
              )}
              {log.notes && <span className="font-sans text-[12px] text-ink-3 flex-1 min-w-0 truncate">{log.notes}</span>}
              <span className="font-mono text-[9px] uppercase tracking-[0.05em] text-ink-3 ml-auto">
                {log.source}
              </span>
              <form action={deleteLogAction}>
                <input type="hidden" name="id" value={item.id} />
                <input type="hidden" name="log_id" value={log.id} />
                <button type="submit"
                  className="font-mono text-[10px] text-ink-3 opacity-0 group-hover:opacity-100 hover:text-accent transition-all"
                  aria-label="Undo this completion">
                  undo
                </button>
              </form>
            </div>
          ))
        )}
      </div>

      {/* ─── Edit ─────────────────────────────────────────────────── */}
      <div className="px-5 lg:px-0 mt-10">
        <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3 mb-3">Edit</div>
        <ItemForm item={item} assets={assets} domains={domains} />
      </div>

      {/* ─── Danger row ───────────────────────────────────────────── */}
      <div className="px-5 lg:px-0 mt-10 flex items-center gap-5">
        <form action={setItemActiveAction}>
          <input type="hidden" name="id" value={item.id} />
          <input type="hidden" name="active" value={item.active ? 'false' : 'true'} />
          <button type="submit"
            className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3 hover:text-ink-2 transition-colors">
            {item.active ? 'Deactivate (pause the schedule)' : 'Reactivate'}
          </button>
        </form>
        <form action={deleteItemAction}>
          <input type="hidden" name="id" value={item.id} />
          <button type="submit"
            className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3 hover:text-accent transition-colors">
            Delete item + history
          </button>
        </form>
      </div>
    </div>
  );
}
