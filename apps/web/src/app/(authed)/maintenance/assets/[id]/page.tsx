import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ApiError, assetsApi, domainsApi } from '@/lib/api';
import { addReadingAction, deleteAssetAction } from '../../actions';
import { AssetForm } from '../../asset-form';
import { cadenceLabel, dueDateLabel, meterLabel } from '../../format';
import type { DomainOption } from '../../item-form';

// /maintenance/assets/[id] — one asset: its items with due state, the meter
// log + add-reading form (when metered), stored facts (the metadata jsonb —
// read-only here; the future vehicle agent owns writing it), and the edit
// form.

export default async function AssetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let data: Awaited<ReturnType<typeof assetsApi.get>>;
  try {
    data = await assetsApi.get(id);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }
  const { asset, readings, items, today } = data;

  let domains: DomainOption[] = [];
  try {
    domains = (await domainsApi.list()).domains.map(({ id: did, name }) => ({ id: did, name }));
  } catch {
    /* edit form renders with empty picker */
  }

  const facts = Object.entries(asset.metadata ?? {});

  return (
    <div className="pb-32">
      {/* ─── Masthead ─────────────────────────────────────────────── */}
      <div className="px-5 lg:px-0 pt-5">
        <Link
          href="/maintenance/assets"
          className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3 hover:text-ink-2 transition-colors mb-2 w-fit"
        >
          <span className="h-[5px] w-[5px] rounded-full bg-accent" aria-hidden />
          From Assets
        </Link>
        <h1 className="font-serif text-[28px] font-medium tracking-[-0.4px] text-ink leading-none">
          {asset.name}
        </h1>
        <div className="mt-1.5 flex items-center gap-2 font-sans text-[12px] text-ink-3">
          <span className="font-mono text-[9px] uppercase tracking-[0.05em] px-1.5 py-px bg-surface-2">
            {asset.kind}
          </span>
          {asset.meter_unit && (
            <span>
              {readings[0]
                ? `${readings[0].reading.toLocaleString('en-US')} ${asset.meter_unit} as of ${readings[0].recorded_on}`
                : `metered (${asset.meter_unit}) — no readings yet`}
            </span>
          )}
        </div>
      </div>

      <div className="hairline mt-4 mx-5 lg:mx-0" />

      {/* ─── Items on this asset ──────────────────────────────────── */}
      <div className="px-5 lg:px-0 mt-5">
        <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3 mb-2">
          Maintenance · {items.length}
        </div>
        {items.length === 0 ? (
          <p className="font-sans text-[13px] text-ink-3 italic">Nothing scheduled on this asset yet.</p>
        ) : (
          items.map((item) => {
            const urgent =
              item.due_state?.status === 'overdue' || item.due_state?.status === 'due';
            const dateLabel = dueDateLabel(item.next_due_date, today);
            const meter = meterLabel(item);
            return (
              <Link
                key={item.id}
                href={`/maintenance/${item.id}`}
                className="flex items-baseline gap-3 py-3 border-b border-line hover:opacity-80 transition-opacity"
              >
                <span className="font-sans text-[14px] font-medium text-ink flex-1 min-w-0 truncate">
                  {item.name}
                </span>
                <span className="font-mono text-[9px] tracking-[0.05em] px-1.5 py-px bg-surface-2 text-ink-3">
                  ↻ {cadenceLabel(item)}
                </span>
                <span className={`font-mono text-[10px] tabular-nums ${urgent ? 'text-accent' : 'text-ink-3'}`}>
                  {[dateLabel, meter].filter(Boolean).join(' · ') || 'needs a reading'}
                </span>
              </Link>
            );
          })
        )}
        <Link
          href="/maintenance/new"
          className="mt-3 block w-fit font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3 hover:text-ink-2 transition-colors"
        >
          + Add an item
        </Link>
      </div>

      {/* ─── Meter log ────────────────────────────────────────────── */}
      {asset.meter_unit && (
        <div className="px-5 lg:px-0 mt-8">
          <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3 mb-2">
            {asset.meter_unit} log
          </div>
          <form action={addReadingAction} className="flex flex-wrap items-end gap-3 mb-4">
            <input type="hidden" name="asset_id" value={asset.id} />
            <label className="flex flex-col gap-1">
              <span className="font-mono text-[9px] uppercase tracking-[0.08em] text-ink-3">Reading</span>
              <input type="number" name="reading" min="0" step="any" required
                placeholder={readings[0] ? String(readings[0].reading) : ''}
                className="w-32 border border-line bg-surface px-2 py-1.5 font-sans text-[13px] text-ink" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-mono text-[9px] uppercase tracking-[0.08em] text-ink-3">On</span>
              <input type="date" name="recorded_on" defaultValue={today}
                className="border border-line bg-surface px-2 py-1.5 font-sans text-[13px] text-ink" />
            </label>
            <button type="submit"
              className="bg-ink text-bg px-4 py-2 font-sans font-semibold text-[12px] uppercase tracking-wider hover:bg-ink-2 transition-colors">
              Log
            </button>
          </form>
          {readings.length === 0 ? (
            <p className="font-sans text-[13px] text-ink-3 italic">
              No readings yet — meter-based schedules stay dark until one lands.
            </p>
          ) : (
            readings.map((r) => (
              <div key={r.id} className="flex items-baseline gap-3 py-1.5 border-b border-line/60">
                <span className="font-mono text-[12px] tabular-nums text-ink">
                  {r.reading.toLocaleString('en-US')} {asset.meter_unit}
                </span>
                <span className="font-mono text-[11px] tabular-nums text-ink-3">{r.recorded_on}</span>
                <span className="font-mono text-[9px] uppercase tracking-[0.05em] text-ink-3 ml-auto">
                  {r.source}
                </span>
              </div>
            ))
          )}
        </div>
      )}

      {/* ─── Stored facts (metadata jsonb) ────────────────────────── */}
      {facts.length > 0 && (
        <div className="px-5 lg:px-0 mt-8">
          <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3 mb-2">
            Facts
          </div>
          {facts.map(([k, v]) => (
            <div key={k} className="flex items-baseline gap-3 py-1.5 border-b border-line/60">
              <span className="font-mono text-[10px] uppercase tracking-[0.05em] text-ink-3 w-40 shrink-0">
                {k}
              </span>
              <span className="font-sans text-[13px] text-ink break-words min-w-0">
                {typeof v === 'string' || typeof v === 'number' ? String(v) : JSON.stringify(v)}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* ─── Edit ─────────────────────────────────────────────────── */}
      <div className="px-5 lg:px-0 mt-10">
        <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3 mb-3">Edit</div>
        <AssetForm asset={asset} domains={domains} />
      </div>

      <div className="px-5 lg:px-0 mt-10">
        <form action={deleteAssetAction}>
          <input type="hidden" name="id" value={asset.id} />
          <button type="submit"
            className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3 hover:text-accent transition-colors">
            Delete asset (items survive, unattached)
          </button>
        </form>
      </div>
    </div>
  );
}
