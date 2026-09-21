'use client';

import { useId, useMemo, useState } from 'react';
import Link from 'next/link';
import type { WorkPayload, WorkDomain } from '@/lib/api';
import { Pill } from '@/components/Pill';
import { Icon } from '@/components/Icon';
import { FilterInput, textMatches } from '@/components/FilterInput';
import { QuickAddTask } from '@/components/QuickAddTask';
import { domainColor } from '@/lib/domain-colors';
import { FocusControl, type FocusOption } from './focus-control';
import { ProjectCard, ContentRow, AssetCard, FittedArt } from './cards';

// The Work page (issue #79 redesign, Sep 2026). No facet rail: the domains
// are compact cards in two independent columns on desktop, one on mobile,
// every card collapsed until opened. A card's name links to the domain page;
// everything else on the card (engraving, pill, counts, empty space, the
// desktop arrow) toggles its contents in place, constrained to the card's
// own column. Expansion lasts only for the current visit; every new visit
// starts with all domain cards collapsed.
//
// Everything is server-derived — urgency pills and counts come straight off
// the payload (buildWork), never re-computed here. State here is UI-only
// (search, open cards, the parked toggle).

const cardGrid = { gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 232px), 1fr))' };
const actionClass = 'inline-flex min-h-11 items-center rounded px-2 font-mono text-[11px] text-ink-2 hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

function matchesDomain(d: WorkDomain, q: string) {
  return textMatches(q, d.name)
    || d.assets.some((a) => textMatches(q, a.name))
    || d.projects.some((p) => textMatches(q, p.name, p.client, p.asset?.name))
    || d.content.some((c) => textMatches(q, c.title));
}

export function WorkView({
  payload, tomorrowFocus, tomorrowDate, art = {},
}: {
  payload: WorkPayload;
  tomorrowFocus: { title: string; href: string } | null;
  tomorrowDate: string;
  // Committed domain engravings (domain id → inner-SVG). Absent entries fall
  // back to the name-seeded procedural motif, so every card carries art.
  art?: Record<string, string>;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [showParked, setShowParked] = useState(false);
  const [q, setQ] = useState('');

  function toggle(id: string) {
    const next = new Set(expanded);
    next.has(id) ? next.delete(id) : next.add(id);
    setExpanded(next);
  }

  // Search retains the full matching domain, including its asset hierarchy.
  const visibleDomains = payload.domains.filter((d) => matchesDomain(d, q));
  const visibleParked = payload.parked.filter((d) => matchesDomain(d, q));

  const focusOptions = useMemo<FocusOption[]>(() => {
    const out: FocusOption[] = [];
    for (const d of payload.domains) {
      for (const p of d.projects) {
        if (!p.paused) out.push({ type: 'project', id: p.id, label: p.name, context: p.client ?? d.name });
      }
      for (const c of d.content) {
        if (c.holder === 'me') out.push({ type: 'content_item', id: c.id, label: c.title, context: c.status });
      }
    }
    return out;
  }, [payload.domains]);

  const renderBoard = (list: WorkDomain[], label: string) => (
    <Board list={list} label={label} render={(d) => (
      <DomainCard key={d.id} domain={d} artSvg={art[d.id]} expanded={expanded.has(d.id)} onToggle={() => toggle(d.id)} />
    )} />
  );

  return (
    <div className="min-w-0 px-5 lg:px-0 pt-6 pb-24">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4 mb-4">
        <h1 className="font-serif text-[40px] font-medium leading-[1.02] tracking-[-0.022em] text-ink">Domains</h1>
        {/* Masthead actions — the site's list-page button pair (34px, mono
            uppercase; outline secondary, solid ink primary). */}
        <div className="flex items-center gap-2 shrink-0">
          <Link
            href="/content?status=idea"
            className="inline-flex items-center h-[34px] px-3 rounded border border-line-strong font-mono text-[10px] uppercase tracking-[0.09em] text-ink-2 hover:border-ink-3 hover:text-ink transition-colors"
          >
            Ideas ({payload.ideasCount})
          </Link>
          <Link
            href="/domains/new"
            className="inline-flex items-center h-[34px] px-3 rounded bg-ink border border-ink font-mono text-[10px] uppercase tracking-[0.09em] text-bg hover:bg-ink-2 transition-colors"
          >
            + Domain
          </Link>
        </div>
      </div>
      <div className="mb-4">
        <FilterInput value={q} onChange={setQ} placeholder="Find domains, assets, projects, content…" className="max-w-[420px]" />
      </div>
      <div className="border-y border-line mb-5 pb-3">
        <FocusControl current={tomorrowFocus} options={focusOptions} date={tomorrowDate} />
      </div>

      {renderBoard(visibleDomains, 'Active domains')}
      {visibleDomains.length === 0 && (
        <p className="py-8 font-sans text-[14px] text-ink-3" role="status">
          {q.trim()
            ? visibleParked.length ? 'Matching domains are in Parked below.' : 'No domains match. Try another search or clear it.'
            : 'No active domains.'}
        </p>
      )}

      {payload.parked.length > 0 && (
        <div className="mt-6">
          <button type="button" onClick={() => setShowParked((v) => !v)}
            aria-expanded={showParked} aria-controls="parked-domains" className={actionClass}>
            <Icon name="chev" size={15} style={{ transform: `rotate(${showParked ? 90 : 0}deg)` }} />
            <span className="ml-2">Parked ({visibleParked.length})</span>
          </button>
          <div id="parked-domains" hidden={!showParked} className="mt-2 opacity-70">
            {showParked && renderBoard(visibleParked, 'Parked domains')}
            {showParked && visibleParked.length === 0 && <p className="py-4 text-sm text-ink-3">No parked domains match.</p>}
          </div>
        </div>
      )}
    </div>
  );
}

// CSS order cannot change keyboard or screen-reader order. Mobile therefore
// gets a list in payload order; desktop keeps independent column groups.
// display:none removes the inactive layout from tab and accessibility order.
// Both layouts share expansion state above and use unique card IDs, so this
// also works on the server's first paint and when crossing the breakpoint.
function Board({ list, label, render }: {
  list: WorkDomain[];
  label: string;
  render: (d: WorkDomain) => React.ReactNode;
}) {
  if (list.length === 0) return null;
  return (
    <div aria-label={label} className="border-t-2 border-ink">
      <div className="flex flex-col lg:hidden" data-domain-layout="mobile">
        {list.map(render)}
      </div>
      <div className="hidden lg:grid lg:grid-cols-2 lg:items-start lg:gap-x-10" data-domain-layout="desktop">
        {[0, 1].map((col) => (
          <div key={col} className="flex min-w-0 flex-col">
            {list.map((d, i) => (i % 2 === col ? render(d) : null))}
          </div>
        ))}
      </div>
    </div>
  );
}

function DomainCard({ domain, artSvg, expanded, onToggle }: {
  domain: WorkDomain;
  artSvg?: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  const r = domain.rollup;
  const color = domainColor(domain.name);
  const showDirect = domain.direct.open > 0 || domain.direct.waiting > 0;
  const empty = !domain.assets.length && !domain.projects.length && !domain.content.length && !showDirect;
  const id = useId();
  const panelId = `${id}-contents`;
  const titleId = `${id}-title`;
  const cueId = `${id}-cue`;
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

  return (
    <section aria-labelledby={titleId} className="min-w-0 border-b border-line-strong">
      {/* The card. A transparent button fills it and is the disclosure
          control (keyboard focus rings the whole card; Enter/Space toggle).
          Being absolutely positioned it paints above the in-flow content,
          so a click on the engraving, pill, counts or empty space lands on
          it. The name link is raised above the button so it navigates.
          Open cards sit on the raised paper surface — on mobile, where
          there is no arrow, that is the visible open state, and it clears
          on collapse. No hover tint: touch browsers pin :hover to the
          last tapped element, and on desktop the pointer cursor plus the
          arrow already say the card is interactive. The tint bleeds 8px
          past the content on both sides so nothing sits on its edge. */}
      <div className={`relative flex items-center gap-3.5 min-h-[80px] py-3 -mx-2 px-2 rounded transition-colors ${expanded ? 'bg-surface' : ''}`}>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-controls={panelId}
          aria-labelledby={`${titleId} ${cueId}`}
          className="absolute inset-0 rounded focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
        >
          <span id={cueId} className="sr-only">{expanded ? 'Hide contents' : 'Show contents'}</span>
        </button>

        {/* Lead slot: the engraving inked in the domain colour, with the
            urgency pill spanning its full width beneath. Fixed width so
            every name in a column starts at the same x. */}
        <span className="flex w-[84px] lg:w-[104px] shrink-0 flex-col items-end gap-1.5">
          <span className="flex h-[34px] lg:h-10 w-full items-center justify-end overflow-hidden" aria-hidden>
            <FittedArt name={domain.name} svg={artSvg} color={color} fit="xMaxYMid meet" />
          </span>
          <Pill state={domain.urgency} className="w-full" />
        </span>

        <span className="flex min-w-0 flex-1 flex-col gap-1.5">
          {/* Name links to the domain detail page — settings, cadence rule,
              and the illustration panel live there. */}
          <Link
            id={titleId}
            href={`/domains/${domain.id}`}
            className="relative z-10 self-start font-serif text-[21px] lg:text-[22px] font-medium leading-[1.1] tracking-[-0.015em] text-ink [overflow-wrap:anywhere] hover:text-accent transition-colors"
          >
            {domain.name}
          </Link>
          <span className="flex flex-wrap gap-x-2.5 gap-y-1 font-mono text-[11px] font-medium text-ink-3">
            <span>{r.open} open</span>
            {r.overdue > 0 && <span className="text-accent">{r.overdue} overdue</span>}
            {r.waiting > 0 && <span>{r.waiting} waiting</span>}
          </span>
        </span>

        {/* Desktop keeps a right-side arrow as the visible cue; decorative,
            the button above carries the state. Mobile has no arrow. */}
        <span className="hidden lg:grid h-[34px] w-[34px] shrink-0 place-items-center text-ink-3" aria-hidden>
          <Icon name="chev" size={16} style={{ transform: `rotate(${expanded ? 90 : 0}deg)`, transition: 'transform .15s' }} />
        </span>
      </div>

      <div id={panelId} hidden={!expanded}>
        {expanded && (
          <div className="min-w-0 border-t border-line pb-5 [overflow-wrap:anywhere]">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2">
              <Link href={`/domains/${domain.id}`} aria-label={`Open domain: ${domain.name}`} className={`${actionClass} underline underline-offset-4`}>
                Open domain<span aria-hidden className="ml-2">→</span>
              </Link>
              <span className="ml-auto font-mono text-[10.5px] text-ink-3">
                {plural(domain.assets.length, 'asset')} · {plural(domain.projects.length, 'project')} · {domain.content.length} content
              </span>
            </div>
            {/* Flat grids, as on the domain detail page: assets, then
                projects. A project that groups under an asset carries the
                asset's name as a chip on its card (see ProjectCard) rather
                than nesting beneath it — nesting left every asset card
                alone in a two-column grid. */}
            {domain.assets.length > 0 && (
              <div className="mb-4">
                <h3 className="mb-3 font-mono text-[11px] uppercase tracking-wider text-ink-3">Assets</h3>
                <div className="grid gap-3" style={cardGrid}>
                  {domain.assets.map((a) => <AssetCard key={a.id} a={a} color={color} />)}
                </div>
              </div>
            )}
            {domain.projects.length > 0 && (
              <div className="mb-4">
                <h3 className="mb-3 font-mono text-[11px] uppercase tracking-wider text-ink-3">Projects</h3>
                <div className="grid gap-3" style={cardGrid}>
                  {domain.projects.map((p) => <ProjectCard key={p.id} p={p} color={color} />)}
                </div>
              </div>
            )}
            {domain.content.length > 0 && (
              <div className="mb-4">
                <h3 className="mb-3 font-mono text-[11px] uppercase tracking-wider text-ink-3">Content</h3>
                <div className="border border-line rounded">
                  {domain.content.map((c) => <ContentRow key={c.id} c={c} color={color} />)}
                </div>
              </div>
            )}
            {empty && <p className="mb-3 font-sans text-[13px] italic text-ink-3">Nothing open.</p>}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              {showDirect && (
                <Link href={`/domains/${domain.id}`} className={actionClass}>
                  Direct tasks {domain.direct.open}
                  {domain.direct.overdue > 0 && ` · ${domain.direct.overdue} overdue`}
                  {domain.direct.waiting > 0 && ` · ${domain.direct.waiting} waiting`}
                </Link>
              )}
              <Link href={`/projects/new?domain_id=${domain.id}`} className={actionClass}>+ Project</Link>
              <Link href={`/maintenance/assets?domain_id=${domain.id}`} className={actionClass}>+ Asset</Link>
              <QuickAddTask domainId={domain.id} projects={domain.projects.map((p) => ({ id: p.id, name: p.name }))}
                placeholder={`Add a task in ${domain.name}…`} collapsible />
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
