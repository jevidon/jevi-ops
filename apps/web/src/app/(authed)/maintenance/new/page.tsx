import Link from 'next/link';
import { assetsApi, domainsApi } from '@/lib/api';
import { ItemForm, type AssetOption, type DomainOption } from '../item-form';

// /maintenance/new — create a maintenance item. Cadence can be date, meter
// (when the chosen asset has one), or both (whichever-first); policy picks
// how completion rolls the schedule. ?asset_id preselects the asset (the
// asset page's "＋ Item").

export default async function NewMaintenanceItemPage({
  searchParams,
}: {
  searchParams: Promise<{ asset_id?: string }>;
}) {
  const { asset_id: defaultAssetId } = await searchParams;
  let assets: AssetOption[] = [];
  let domains: DomainOption[] = [];
  try {
    const [a, d] = await Promise.all([assetsApi.list(), domainsApi.list()]);
    assets = a.assets.map(({ id, name, meter_unit }) => ({ id, name, meter_unit }));
    domains = d.domains.map(({ id, name }) => ({ id, name }));
  } catch {
    /* form renders with empty pickers */
  }
  const backHref = defaultAssetId ? `/assets/${defaultAssetId}` : '/maintenance';
  const backLabel = defaultAssetId ? (assets.find((a) => a.id === defaultAssetId)?.name ?? 'Asset') : 'Maintenance';

  return (
    <div className="pb-32">
      <div className="px-5 lg:px-0 pt-5">
        <Link
          href={backHref}
          className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3 hover:text-ink-2 transition-colors mb-2 w-fit"
        >
          <span className="h-[5px] w-[5px] rounded-full bg-accent" aria-hidden />
          From {backLabel}
        </Link>
        <h1 className="font-serif text-[28px] font-medium tracking-[-0.4px] text-ink leading-none">
          New item
        </h1>
      </div>
      <div className="hairline mt-4 mx-5 lg:mx-0" />
      <div className="px-5 lg:px-0 mt-6">
        <ItemForm assets={assets} domains={domains} defaultAssetId={defaultAssetId ?? null} />
      </div>
    </div>
  );
}
