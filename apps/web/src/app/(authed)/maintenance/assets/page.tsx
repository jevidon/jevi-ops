import Link from 'next/link';
import { ApiError, assetsApi, domainsApi, type AssetListItem } from '@/lib/api';
import { AssetForm } from '../asset-form';
import type { DomainOption } from '../item-form';

// /maintenance/assets — the things under upkeep. Each row shows the latest
// meter reading (and its age — the staleness signal the odometer nag keys
// on) plus how many active items hang off the asset.

export default async function AssetsPage() {
  let assets: AssetListItem[] = [];
  let domains: DomainOption[] = [];
  let errorMessage: string | null = null;
  try {
    const [a, d] = await Promise.all([assetsApi.list(), domainsApi.list()]);
    assets = a.assets;
    domains = d.domains.map(({ id, name }) => ({ id, name }));
  } catch (err) {
    errorMessage = err instanceof ApiError ? `API ${err.status}` : (err as Error).message;
  }

  return (
    <div className="pb-32">
      <div className="px-5 lg:px-0 pt-5">
        <Link
          href="/maintenance"
          className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3 hover:text-ink-2 transition-colors mb-2 w-fit"
        >
          <span className="h-[5px] w-[5px] rounded-full bg-accent" aria-hidden />
          From Maintenance
        </Link>
        <h1 className="font-serif text-[28px] font-medium tracking-[-0.4px] text-ink leading-none">
          Assets
        </h1>
        <div className="mt-1.5 font-sans text-[12px] text-ink-3">
          {assets.length} under upkeep · a meter unit unlocks the readings log
        </div>
      </div>

      <div className="hairline mt-4 mx-5 lg:mx-0" />

      {errorMessage && (
        <div className="px-5 lg:px-0 mt-6 font-sans text-[13px] text-ink-3">
          Couldn&rsquo;t load assets: {errorMessage}
        </div>
      )}

      <div className="px-5 lg:px-0 mt-5">
        {assets.length === 0 && !errorMessage ? (
          <p className="font-sans text-[13px] text-ink-3 italic">
            No assets yet. Items don&rsquo;t require one — but a vehicle, an air
            purifier, or a bike gives its maintenance a shared home (and a meter,
            if it has one).
          </p>
        ) : (
          assets.map((a) => (
            <Link
              key={a.id}
              href={`/maintenance/assets/${a.id}`}
              className="flex items-baseline gap-3 py-3 border-b border-line hover:opacity-80 transition-opacity"
            >
              <span className="font-sans text-[14px] font-medium text-ink flex-1 min-w-0 truncate">
                {a.name}
              </span>
              <span className="font-mono text-[9px] uppercase tracking-[0.05em] px-1.5 py-px bg-surface-2 text-ink-3">
                {a.kind}
              </span>
              {a.meter_unit && (
                <span className="font-mono text-[11px] tabular-nums text-ink-3">
                  {a.latest_reading != null
                    ? `${a.latest_reading.toLocaleString('en-US')} ${a.meter_unit}${
                        a.latest_reading_days_ago != null && a.latest_reading_days_ago > 0
                          ? ` · ${a.latest_reading_days_ago}d ago`
                          : ''
                      }`
                    : `no ${a.meter_unit} readings`}
                </span>
              )}
              <span className="font-mono text-[10px] tabular-nums text-ink-3">
                {a.active_item_count} item{a.active_item_count === 1 ? '' : 's'}
              </span>
            </Link>
          ))
        )}
      </div>

      <div className="px-5 lg:px-0 mt-10">
        <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3 mb-3">
          New asset
        </div>
        <AssetForm domains={domains} />
      </div>
    </div>
  );
}
