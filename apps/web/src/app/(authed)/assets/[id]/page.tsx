import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Pill } from '@/components/Pill';
import { SetCrumbs } from '@/components/crumbs/crumbs';
import {
  DetailHeader, CrumbDot, ActionButton, StatStrip, Stat, DetailBody, DetailSection, RailBlock,
} from '@/components/detail/DetailShell';
import { EditDrawer } from '@/components/detail/EditDrawer';
import {
  ApiError, assetsApi, domainsApi, workApi,
  type AssetProjectRow, type MaintenanceItem, type WorkAssetCard, type WorkProjectCard,
} from '@/lib/api';
import { factValue, maintenanceUrgency, type Urgency } from '@jevi-ops/shared';
import { domainColor } from '@/lib/domain-colors';
import { ProjectCard } from '../../work/cards';
import { ProjectQuickCreate } from '../../domains/[id]/quick-create';
import { ActionForm } from '../../maintenance/action-form';
import { addReadingAction, deleteAssetAction, voidReadingAction } from '../../maintenance/actions';
import { AssetForm } from '../../maintenance/asset-form';
import { dataLabel, dueDateLabel, meterLabel, statusLabel } from '../../maintenance/format';
import type { DomainOption } from '../../maintenance/item-form';
import { DocPanel } from '@/components/doc/DocPanel';
import { promoteIdeaAction } from '../../projects/actions';
import { assignAssetDomainAction } from './actions';
import { AssetGallery } from './asset-gallery';
import { isStructuredFact, renderFact } from './facts';
import { FactsEditor, type FactRow } from './facts-editor';
import { ServiceSchedule } from './service-schedule';

// /assets/[id] — the asset as an area (0049). The same anatomy as a
// project or domain page: header band → stat strip → two-column read
// layout. Main column, top-down: what needs deciding NOW (Next up), then
// the service schedule grouped by system, the projects grouped under the
// asset, and the meter log. Rail: the facts (metadata), details with the
// domain assignment, and the hero photo. Assigned assets trail their
// domain in the topbar; unassigned ones trail Maintenance and carry an
// "Assign to a domain" prompt — assignment is what promotes an asset into
// a domain (cards, bands, the board); its upkeep reaches Inbox and
// attention regardless.
//
// SCOPE: every count, prompt, and pill on this page comes from the items
// the API marks `tracked` — the same predicate the Work card uses — so the
// card and the page can never disagree. Paused items and a non-active
// asset are shown, not counted.

const LIFECYCLE_NOTE: Record<string, string | null> = {
  active: null,
  stored: 'Stored — schedules paused; nothing here counts or prompts until it is active again. History kept.',
  sold: 'Sold — history kept for the record; schedules are paused.',
  archived: 'Archived — history kept; schedules are paused.',
};

const WORKSHOP_POLICIES = new Set(['interval', 'on_condition']);

export default async function AssetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const [detailRes, workRes, domainsRes] = await Promise.allSettled([
    assetsApi.get(id),
    workApi.get(),
    domainsApi.list(),
  ]);
  if (detailRes.status === 'rejected') {
    if (detailRes.reason instanceof ApiError && detailRes.reason.status === 404) notFound();
    throw detailRes.reason;
  }
  const { asset, domain, latest_reading: latest, readings, items, projects, cost_ytd, today, meter_stale_days } = detailRes.value;
  const domains: DomainOption[] =
    domainsRes.status === 'fulfilled' ? domainsRes.value.domains.map(({ id: did, name }) => ({ id: did, name })) : [];

  // The Work payload's view of this asset (assigned + active only) — the
  // same derivation the board and domain page render, so the pill agrees.
  let card: WorkAssetCard | null = null;
  let projectCards: WorkProjectCard[] = [];
  if (workRes.status === 'fulfilled') {
    for (const d of [...workRes.value.domains, ...workRes.value.parked]) {
      card ??= d.assets.find((a) => a.id === asset.id) ?? null;
      projectCards.push(...d.projects.filter((p) => p.asset?.id === asset.id));
    }
  }
  const cardIds = new Set(projectCards.map((p) => p.id));
  // Ideas (0050): candidates grouped under the asset — off the board until
  // promoted, so they never ride in projectCards.
  const ideas = projects.filter((p) => p.status === 'idea');
  // Projects the board doesn't carry (paused-but-unassigned, done): plain rows.
  const otherProjects = projects.filter((p) => !cardIds.has(p.id) && p.status !== 'idea');

  const assetActive = asset.lifecycle === 'active';
  const live = readings.filter((r) => !r.voided_at);
  const readingAge = latest ? daysBetween(latest.recorded_on, today) : null;
  const readingStale = assetActive && asset.meter_unit != null && readingAge != null && readingAge > meter_stale_days;

  // Only tracked items count, prompt, or colour the pill.
  const tracked = items.filter((i) => i.tracked !== false);
  const paused = items.filter((i) => i.tracked === false);
  const due = tracked.filter((i) => i.due_state?.status === 'overdue' || i.due_state?.status === 'due');
  const soon = tracked.filter((i) => i.due_state?.status === 'due_soon');
  const unknown = tracked.filter((i) => i.due_state && i.due_state.data !== 'complete');
  const DUE_RANK = { ok: 0, due_soon: 1, due: 2, overdue: 3 } as const;
  let worst: keyof typeof DUE_RANK | null = null;
  for (const i of tracked) {
    const s = i.due_state?.status;
    if (s && (worst == null || DUE_RANK[s] > DUE_RANK[worst])) worst = s;
  }
  const urgency: Urgency = !assetActive
    ? 'quiet'
    : card?.urgency ?? maintenanceUrgency(worst, projectCards.length + otherProjects.length > 0);
  const color = domain ? domainColor(domain.name) : null;
  const unit = asset.meter_unit;
  const lifecycleNote = LIFECYCLE_NOTE[asset.lifecycle] ?? null;

  // The batch is a suggestion: workshop jobs (services, inspections) plan
  // together; renewals (rego, WoF, RUC) are errands with their own paths.
  const window = [...due, ...soon];
  const workshop = window.filter((i) => WORKSHOP_POLICIES.has(i.policy));
  const renewals = window.filter((i) => !WORKSHOP_POLICIES.has(i.policy));

  // Facts (metadata) — bare scalars, rich {value, source, observed_on,
  // verified}, or structured objects (rendered, not editable).
  const facts: FactRow[] = Object.entries(asset.metadata ?? {}).map(([key, raw]) => {
    const rich = raw && typeof raw === 'object' ? (raw as { source?: string | null; observed_on?: string | null; verified?: boolean }) : null;
    return {
      key,
      value: renderFact(raw),
      raw,
      source: rich?.source ?? null,
      observed_on: rich?.observed_on ?? null,
      verified: rich?.verified ?? false,
      structured: isStructuredFact(raw),
    };
  });
  const fact = (k: string) => {
    const v = factValue(asset.metadata?.[k]);
    return v == null ? null : String(v);
  };
  const specLine = [
    [fact('year'), fact('make'), fact('model')].filter(Boolean).join(' '),
    fact('variant'),
    fact('engine'),
    fact('plate'),
    latest && unit ? `${latest.reading.toLocaleString('en-US')} ${unit}` : null,
  ].filter(Boolean);

  const year = today.slice(0, 4);
  const hasNextUp = assetActive && (due.length > 0 || soon.length > 0 || unknown.length > 0 || readingStale);

  return (
    <div>
      {/* Ancestors only — the header band names the asset itself. */}
      <SetCrumbs trail={domain ? [{ label: domain.name, href: `/domains/${domain.id}` }] : [{ label: 'Assets', href: '/maintenance/assets' }]} />

      <DetailHeader
        crumb={
          <>
            <Link href={domain ? `/domains/${domain.id}` : '/maintenance/assets'} className="hover:text-ink-2 transition-colors">Asset</Link>
            <CrumbDot /><span>{asset.kind}</span>
            {asset.lifecycle !== 'active' && (<><CrumbDot /><span>{asset.lifecycle}</span></>)}
            {!domain && (<><CrumbDot /><span>unassigned</span></>)}
          </>
        }
        name={asset.name}
        color={color}
        state={<Pill state={urgency}>{assetActive && (card?.worst === 'due_soon' || (!card && worst === 'due_soon')) ? 'Due soon' : undefined}</Pill>}
        actions={
          <>
            <ActionButton href={`/maintenance/new?asset_id=${asset.id}`}>＋ Item</ActionButton>
            <ActionButton href="#projects">＋ Project</ActionButton>
            {unit && assetActive && <ActionButton href="#meter">Log reading</ActionButton>}
            <EditDrawer title="Edit asset">
              <AssetForm asset={asset} domains={domains} hasReadings={readings.length > 0} />
              <div className="mt-8 pt-6 border-t border-line">
                <ActionForm action={deleteAssetAction} hidden={{ id: asset.id }} submit="Delete asset" variant="quiet" pendingLabel="Deleting…" />
                <p className="mt-1 font-sans text-[12px] text-ink-4">
                  For a car you sold, set the lifecycle above instead — history stays. Delete is refused while
                  meter-cadence items depend on this asset.
                </p>
              </div>
            </EditDrawer>
          </>
        }
        below={
          specLine.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[11px] tracking-[0.02em] text-ink-3">
              {specLine.map((s, i) => (
                <span key={i} className="flex gap-3">
                  {i > 0 && <span className="text-ink-4">|</span>}
                  {s}
                </span>
              ))}
            </div>
          ) : undefined
        }
      />

      <StatStrip>
        <Stat
          label="Maintenance"
          value={assetActive ? due.length : '—'}
          unit={assetActive ? 'due' : 'paused'}
          tone={assetActive && due.length > 0 ? 'accent' : undefined}
          sub={[
            assetActive && soon.length > 0 ? `${soon.length} due soon` : null,
            `${tracked.length} tracked`,
            paused.length > 0 ? `${paused.length} paused` : null,
            assetActive && unknown.length > 0 ? `${unknown.length} need a reading` : null,
          ].filter(Boolean).join(' · ')}
        />
        {unit ? (
          <Stat
            label="Meter"
            value={latest ? latest.reading.toLocaleString('en-US') : '—'}
            unit={unit}
            tone={readingStale ? 'warn' : undefined}
            sub={latest ? `read ${latest.recorded_on} · ${readingAge === 0 ? 'today' : `${readingAge}d ago`}` : 'no readings yet'}
          />
        ) : (
          <Stat label="Meter" value="—" sub="date-only asset" />
        )}
        <Stat
          label="Projects"
          value={projectCards.filter((p) => !p.paused).length}
          unit="active"
          sub={[
            projectCards.filter((p) => p.paused).length > 0 ? `${projectCards.filter((p) => p.paused).length} paused` : null,
            otherProjects.length > 0 ? `${otherProjects.length} more` : null,
          ].filter(Boolean).join(' · ') || undefined}
        />
        <Stat
          label={`Spend · ${year}`}
          value={cost_ytd > 0 ? `$${cost_ytd.toLocaleString('en-US')}` : '—'}
          sub="logged completions"
        />
      </StatStrip>

      <DetailBody
        main={
          <>
            {lifecycleNote && (
              <p className="mt-0 mb-5 px-3 py-2 border border-dashed border-line-strong font-sans text-[12.5px] text-ink-3">
                {lifecycleNote}
              </p>
            )}

            {/* Next up — the decision block, above everything: what's overdue,
                what's coming, what the schedule can't evaluate yet. */}
            {hasNextUp && (
              <DetailSection label="Next up" className="mt-0">
                <ul className="border-t border-line/40">
                  {due.map((i) => <NextUpRow key={i.id} item={i} today={today} />)}
                  {soon.map((i) => <NextUpRow key={i.id} item={i} today={today} />)}
                  {readingStale && unit && (
                    <li className="py-2 border-b border-line/40 flex items-baseline justify-between gap-3">
                      <span className="font-sans text-[14px] text-ink">
                        Log a {unit} reading
                        <span className="ml-2 font-mono text-[10px] text-ink-3">last one {readingAge}d ago · expected every {meter_stale_days}d</span>
                      </span>
                      <a href="#meter" className="font-mono text-[10px] uppercase tracking-[0.08em] text-accent hover:text-ink shrink-0">Log →</a>
                    </li>
                  )}
                  {unknown
                    .filter((i) => !due.includes(i) && !soon.includes(i))
                    .map((i) => (
                      <li key={`u-${i.id}`} className="py-2 border-b border-line/40 flex items-baseline justify-between gap-3">
                        <span className="font-sans text-[14px] text-ink">
                          {i.name}
                          <span className="ml-2 font-mono text-[10px] text-ink-3">{dataLabel(i)}</span>
                        </span>
                        <Link
                          href={i.due_state?.data === 'needs_baseline' ? `/maintenance/${i.id}#baseline` : '#meter'}
                          className="font-mono text-[10px] uppercase tracking-[0.08em] text-accent hover:text-ink shrink-0"
                        >
                          {i.due_state?.data === 'needs_baseline' ? 'Set a baseline →' : 'Log a reading →'}
                        </Link>
                      </li>
                    ))}
                </ul>
                {workshop.length >= 2 && (
                  <p className="mt-3 font-sans text-[12.5px] text-ink-3">
                    <span className="font-mono text-[9.5px] uppercase tracking-[0.08em] text-ink-3 mr-2">Plan together</span>
                    {workshop.map((i) => i.name).join(' · ')}
                    <span className="text-ink-4"> — inside their lead windows; a suggestion, grouped by who does the work.</span>
                  </p>
                )}
                {renewals.length > 0 && (
                  <p className="mt-1.5 font-sans text-[12.5px] text-ink-3">
                    <span className="font-mono text-[9.5px] uppercase tracking-[0.08em] text-ink-3 mr-2">Renewals due</span>
                    {renewals.map((i) => i.name).join(' · ')}
                  </p>
                )}
              </DetailSection>
            )}

            {/* The overview document (0050) — the asset's living page, under
                Next up (decisions first) and above the schedule. */}
            <DetailSection label="Overview" className={hasNextUp || lifecycleNote ? '' : 'mt-0'}>
              <DocPanel
                entity="asset"
                id={asset.id}
                body={asset.doc_md ?? null}
                version={asset.doc_version ?? 1}
                promote={{ domainId: domain?.id ?? null, source: `overview of ${asset.name}`, revalidate: `/assets/${asset.id}` }}
                emptyHint="The living page for this asset — specs, history, links, decisions, a parts list. Markdown; a checklist line can become a task with → task."
              />
            </DetailSection>

            <DetailSection
              label="Service schedule"
              count={tracked.length}
              action={
                <Link href={`/maintenance/new?asset_id=${asset.id}`} className="font-mono text-[10px] uppercase tracking-wider text-accent hover:text-ink transition-colors">
                  ＋ Item
                </Link>
              }
            >
              <ServiceSchedule items={items} today={today} unit={unit} readOnly={!assetActive} />
            </DetailSection>

            <DetailSection label="Projects" count={projectCards.length + otherProjects.length}>
              <div id="projects" />
              {projectCards.length > 0 && (
                <div className="grid gap-3.5 mb-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(258px, 1fr))' }}>
                  {projectCards.map((p) => <ProjectCard key={p.id} p={p} color={color ?? 'rgb(var(--ink-3))'} />)}
                </div>
              )}
              {otherProjects.length > 0 && (
                <div className="border border-line rounded mb-3">
                  {otherProjects.map((p) => <ProjectRow key={p.id} p={p} />)}
                </div>
              )}
              {projectCards.length === 0 && otherProjects.length === 0 && (
                <p className="font-sans text-[13px] text-ink-3 italic py-1 mb-3">
                  No improvement work yet — a roof rack, a repair, a modification. Projects here group under the asset
                  {domain ? ' and land in its domain.' : '; assign the asset to a domain and they follow it.'}
                </p>
              )}
              <div className="mt-2 pt-3 border-t border-line/40">
                <ProjectQuickCreate assetId={asset.id} domainId={domain?.id} placeholder={`New project for ${asset.name}…`} />
              </div>
            </DetailSection>

            {/* Improvement ideas (0050): projects with status 'idea' — candidates
                grouped under the asset, off the Work board and attention until
                promoted. Distinct from the board's Ideas (content ideas). */}
            <DetailSection label="Improvement ideas" count={ideas.length}>
              <p className="font-sans text-[12.5px] text-ink-3 mb-2">
                Candidates for {asset.name} — not work yet, not on the board. Promote one when you commit to it; its notes, overview and photos come along.
              </p>
              {ideas.length > 0 && (
                <div className="border border-line rounded mb-3">
                  {ideas.map((p) => (
                    <div key={p.id} className="flex items-center gap-3 px-3 py-2.5 border-b border-line last:border-b-0">
                      <span className="w-[9px] h-[9px] rounded-[2.5px] shrink-0 border border-dashed border-ink-3" aria-hidden />
                      <Link href={`/projects/${p.id}`} className="flex-1 min-w-0 font-sans text-[14.5px] leading-[1.3] text-ink truncate hover:text-accent transition-colors">
                        {p.name}
                      </Link>
                      <ActionForm
                        action={promoteIdeaAction}
                        hidden={{ id: p.id, asset_id: asset.id }}
                        submit="Promote →"
                        variant="quiet"
                        pendingLabel="…"
                      />
                    </div>
                  ))}
                </div>
              )}
              <div className="mt-2 pt-3 border-t border-line/40">
                <ProjectQuickCreate
                  assetId={asset.id}
                  domainId={domain?.id}
                  status="idea"
                  returnTo={`/assets/${asset.id}`}
                  placeholder={`An idea for ${asset.name}…`}
                />
              </div>
            </DetailSection>

            {unit && (
              <DetailSection label={`${unit} log`} count={live.length}>
                <div id="meter" />
                {assetActive && (
                  <ActionForm
                    action={addReadingAction}
                    hidden={{ asset_id: asset.id }}
                    eventKey
                    submit="Log"
                    pendingLabel="Logging…"
                    className="flex flex-wrap items-end gap-3 mb-4"
                  >
                    <label className="flex flex-col gap-1">
                      <span className="font-mono text-[9px] uppercase tracking-[0.08em] text-ink-3">Reading</span>
                      <input type="number" name="reading" min="0" step="any" required placeholder={latest ? String(latest.reading) : ''}
                        className="w-32 border border-line bg-surface px-2 py-1.5 font-sans text-[13px] text-ink" />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="font-mono text-[9px] uppercase tracking-[0.08em] text-ink-3">On</span>
                      <input type="date" name="recorded_on" defaultValue={today} max={today}
                        className="border border-line bg-surface px-2 py-1.5 font-sans text-[13px] text-ink" />
                    </label>
                    <label className="flex items-center gap-2 pb-2 font-sans text-[12px] text-ink-3">
                      <input type="checkbox" name="allow_decrease" className="accent-accent" />
                      meter replaced
                    </label>
                  </ActionForm>
                )}
                {live.length === 0 ? (
                  <p className="font-sans text-[13px] text-ink-3 italic">No readings yet — meter-based schedules stay dark until one lands.</p>
                ) : (
                  readings.slice(0, 12).map((r) => (
                    <div key={r.id} className={`flex items-baseline gap-3 py-1.5 border-b border-line/60 group ${r.voided_at ? 'opacity-50' : ''}`}>
                      <span className={`font-mono text-[12px] tabular-nums text-ink ${r.voided_at ? 'line-through' : ''}`}>
                        {r.reading.toLocaleString('en-US')} {unit}
                      </span>
                      <span className="font-mono text-[11px] tabular-nums text-ink-3">{r.recorded_on}</span>
                      <span className="font-mono text-[9px] uppercase tracking-[0.05em] text-ink-3 ml-auto">{r.voided_at ? 'voided' : r.source}</span>
                      {!r.voided_at && assetActive && (
                        <ActionForm action={voidReadingAction} hidden={{ asset_id: asset.id, reading_id: r.id }} submit="void" variant="quiet" pendingLabel="…"
                          className="opacity-60 group-hover:opacity-100 transition-opacity" />
                      )}
                    </div>
                  ))
                )}
                {readings.length > 12 && (
                  <p className="mt-2 font-mono text-[10px] text-ink-4">{readings.length - 12} older readings not shown</p>
                )}
              </DetailSection>
            )}
          </>
        }
        rail={
          <>
            {/* Photos (0050): gallery + uploader; the hero is an explicit
                choice ("Set as hero"), never upload order. */}
            <RailBlock label="Photos">
              <AssetGallery assetId={asset.id} assetName={asset.name} attachments={asset.attachments ?? []} />
            </RailBlock>
            <RailBlock label="Facts">
              <FactsEditor assetId={asset.id} initial={facts} />
            </RailBlock>
            <RailBlock label="Details">
              <KV k="Kind" v={asset.kind} />
              <KV k="Meter" v={unit ?? 'none (date-only)'} />
              <KV k="Lifecycle" v={asset.lifecycle} />
              {unit && <KV k="Readings" v={`every ${meter_stale_days} days`} />}
              <KV k="Created" v={asset.created_at.slice(0, 10)} />
              {/* Assignment — the one switch that promotes the asset into a
                  domain (Assets band + Work board) or drops it back to the
                  Maintenance list. Awareness is unaffected either way. */}
              <div className="mt-3 pt-3 border-t border-line/60">
                <div className="font-mono text-[9px] uppercase tracking-[0.08em] text-ink-4 mb-1">
                  {domain ? 'Domain' : 'Assign to a domain'}
                </div>
                {!domain && (
                  <p className="font-sans text-[12px] text-ink-3 mb-2">
                    Unassigned — listed under Maintenance only. Its schedules still raise tasks in Inbox and attention;
                    assigning it puts it in the domain&rsquo;s Assets band and on the board, and routes that upkeep there.
                  </p>
                )}
                <ActionForm
                  action={assignAssetDomainAction}
                  hidden={{ asset_id: asset.id, previous_domain_id: domain?.id ?? '' }}
                  submit={domain ? 'Move' : 'Assign'}
                  variant="ghost"
                  pendingLabel="…"
                  className="flex flex-wrap items-center gap-2"
                >
                  <select name="domain_id" defaultValue={domain?.id ?? ''} className="flex-1 min-w-[140px] border border-line bg-surface px-2 py-1.5 font-sans text-[13px] text-ink">
                    <option value="">— unassigned —</option>
                    {domains.map((d) => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                  </select>
                </ActionForm>
              </div>
            </RailBlock>
          </>
        }
      />
    </div>
  );
}

function NextUpRow({ item, today }: { item: MaintenanceItem; today: string }) {
  const urgent = item.due_state?.status === 'overdue' || item.due_state?.status === 'due';
  const remaining = [dueDateLabel(item.next_due_date, today), meterLabel(item)].filter(Boolean).join(' · ');
  return (
    <li className="py-2 border-b border-line/40 flex items-baseline justify-between gap-3">
      <span className="font-sans text-[14px] text-ink min-w-0 truncate">
        {item.name}
        <span className={`ml-2 font-mono text-[10px] uppercase tracking-[0.06em] ${urgent ? 'text-accent' : 'text-ink-3'}`}>{statusLabel(item)}</span>
        {remaining && <span className="ml-2 font-mono text-[10px] text-ink-3">{remaining}</span>}
      </span>
      <a href={`#item-${item.id}`} className="font-mono text-[10px] uppercase tracking-[0.08em] text-accent hover:text-ink shrink-0">
        {item.policy === 'expiry' ? 'Renew →' : item.policy === 'on_condition' ? 'Inspect →' : 'Complete →'}
      </a>
    </li>
  );
}

function ProjectRow({ p }: { p: AssetProjectRow }) {
  return (
    <Link href={`/projects/${p.id}`} className="flex items-center gap-3 px-3 py-2.5 border-b border-line last:border-b-0 hover:bg-surface transition-colors">
      <span className="w-[9px] h-[9px] rounded-[2.5px] shrink-0" style={{ background: p.color ?? 'rgb(var(--ink-4))' }} aria-hidden />
      <span className="flex-1 min-w-0 font-sans text-[14.5px] leading-[1.3] text-ink truncate">{p.name}</span>
      <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3">
        {p.status}{p.target_date ? ` · target ${p.target_date.slice(5)}` : ''}
      </span>
    </Link>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="font-mono text-[10px] uppercase tracking-[0.04em] text-ink-3">{k}</span>
      <span className="font-sans text-[13.5px] text-ink text-right">{v}</span>
    </div>
  );
}

function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(`${toIso}T12:00:00Z`) - Date.parse(`${fromIso}T12:00:00Z`)) / 86_400_000);
}
