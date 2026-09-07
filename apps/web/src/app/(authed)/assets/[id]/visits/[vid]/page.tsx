import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { SetCrumbs } from '@/components/crumbs/crumbs';
import { ApiError, assetsApi } from '@/lib/api';
import { VisitForm } from './visit-form';

// /assets/[id]/visits/new — log a visit outright.
// /assets/[id]/visits/[vid] — complete a planned visit (its lines preselected,
// with the plan's per-line notes). A done visit's id lands back on the
// asset page's Visits section.

export default async function VisitPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; vid: string }>;
  searchParams: Promise<{ items?: string }>;
}) {
  const { id, vid } = await params;
  const { items: itemsParam } = await searchParams;
  let bundle: Awaited<ReturnType<typeof assetsApi.get>>;
  try {
    bundle = await assetsApi.get(id);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }
  const { asset, domain, items, latest_reading, visits, today } = bundle;
  const planned = vid === 'new' ? null : (visits.find((v) => v.id === vid) ?? null);
  if (vid !== 'new' && !planned) notFound();
  if (planned && planned.status !== 'planned') redirect(`/assets/${asset.id}#visits`);

  // Tracked items only — a paused item is not serviced through a visit.
  const tracked = items.filter((i) => i.tracked !== false);
  const preselected = planned
    ? planned.lines.map((l) => l.item_id)
    : (itemsParam ?? '').split(',').filter((s) => tracked.some((i) => i.id === s));
  const lineNotes: Record<string, string> = {};
  for (const l of planned?.lines ?? []) if (l.notes) lineNotes[l.item_id] = l.notes;

  return (
    <div className="px-5 lg:px-0 pt-5 pb-32">
      <SetCrumbs
        trail={[
          ...(domain ? [{ label: domain.name, href: `/domains/${domain.id}` }] : [{ label: 'Assets', href: '/maintenance/assets' }]),
          { label: asset.name, href: `/assets/${asset.id}` },
        ]}
      />
      <Link href={`/assets/${asset.id}#visits`} className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3 hover:text-ink-2 transition-colors mb-2 w-fit">
        <span className="h-[5px] w-[5px] rounded-full bg-accent" aria-hidden />
        {asset.name}
      </Link>
      <h1 className="font-serif text-[28px] font-medium tracking-[-0.4px] text-ink leading-none">
        {planned ? 'Record the visit' : 'Log a visit'}
      </h1>
      <p className="mt-2 mb-6 font-sans text-[13px] text-ink-3 max-w-[60ch]">
        One trip, recorded once: the odometer at the visit, who did the work, the invoice, and a line for each item done.
        Each line re-anchors its own schedule; a line you leave unticked stays due.
        {planned?.planned_on ? ` Planned for ${planned.planned_on}.` : ''}
      </p>
      <VisitForm
        assetId={asset.id}
        assetName={asset.name}
        visitId={planned?.id ?? null}
        today={today}
        unit={asset.meter_unit}
        latestReading={latest_reading?.reading ?? null}
        items={tracked}
        preselected={preselected}
        lineNotes={lineNotes}
        provider={planned?.provider ?? null}
        notes={planned?.notes ?? null}
      />
    </div>
  );
}
