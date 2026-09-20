'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import Link from 'next/link';
import type { WorkPayload, WorkDomain } from '@/lib/api';
import { Pill } from '@/components/Pill';
import { Icon } from '@/components/Icon';
import { FilterInput, textMatches } from '@/components/FilterInput';
import { QuickAddTask } from '@/components/QuickAddTask';
import { domainColor } from '@/lib/domain-colors';
import { FocusControl, type FocusOption } from './focus-control';
import { ProjectCard, ContentRow, AssetCard, FittedArt } from './cards';

// UI-only browsing state; urgency and rollups remain server-derived.
const BROWSE_STATE_KEY = 'work-domain-browsing-v1';
const cardGrid = { gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 258px), 1fr))' };
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
  art?: Record<string, string>;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showParked, setShowParked] = useState(false);
  const [q, setQ] = useState('');
  const [restored, setRestored] = useState(false);

  // Restore on navigation back without changing the server's collapsed first
  // render. Storage is optional (private browsing or a full quota may block it).
  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(BROWSE_STATE_KEY) ?? 'null');
      if (saved && typeof saved === 'object') {
        if (Array.isArray(saved.expanded)) {
          setExpanded(new Set(saved.expanded.filter((id: unknown): id is string => typeof id === 'string')));
        }
        if (typeof saved.q === 'string') setQ(saved.q);
        if (typeof saved.showParked === 'boolean') setShowParked(saved.showParked);
      }
    } catch { /* Keep the initial, collapsed view. */ }
    setRestored(true);
  }, []);

  useEffect(() => {
    if (!restored) return;
    try {
      sessionStorage.setItem(BROWSE_STATE_KEY, JSON.stringify({ expanded: [...expanded], q, showParked }));
    } catch { /* Browsing still works without persistence. */ }
  }, [expanded, q, showParked, restored]);

  function toggle(id: string) {
    setExpanded((previous) => {
      const next = new Set(previous);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
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

  const renderDomain = (d: WorkDomain) => (
    <DomainSection key={d.id} domain={d} artSvg={art[d.id]} expanded={expanded.has(d.id)} onToggle={() => toggle(d.id)} />
  );

  return (
    <div className="min-w-0 px-5 lg:px-0 pt-6 pb-24">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4 mb-4">
        <h1 className="font-serif text-[40px] font-medium leading-[1.02] tracking-[-0.022em] text-ink">Domains</h1>
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/content?status=idea" className={`${actionClass} border border-line-strong px-3`}>Ideas ({payload.ideasCount})</Link>
          <Link href="/projects/new" className="inline-flex min-h-11 items-center rounded border border-ink bg-ink px-3 font-mono text-[11px] text-bg hover:bg-ink-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">+ Project</Link>
        </div>
      </div>
      <p className="mb-4 font-sans text-[14px] text-ink-3">
        Select a domain row to show its contents. Choose “Open domain” inside for its full page.
      </p>
      <div className="mb-4">
        <FilterInput value={q} onChange={setQ} placeholder="Find domains, assets, projects, content…" className="max-w-[420px]" />
      </div>
      <div className="border-y border-line mb-5 pb-3">
        <FocusControl current={tomorrowFocus} options={focusOptions} date={tomorrowDate} />
      </div>

      <div className="border-t border-line-strong">
        {visibleDomains.map(renderDomain)}
      </div>
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
          <div id="parked-domains" hidden={!showParked} className="mt-2 border-t border-line-strong">
            {showParked && visibleParked.map(renderDomain)}
            {showParked && visibleParked.length === 0 && <p className="py-4 text-sm text-ink-3">No parked domains match.</p>}
          </div>
        </div>
      )}
    </div>
  );
}

function DomainSection({ domain, artSvg, expanded, onToggle }: {
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
  const assetIds = new Set(domain.assets.map((a) => a.id));
  const otherProjects = domain.projects.filter((p) => !p.asset || !assetIds.has(p.asset.id));

  return (
    <section aria-labelledby={titleId} className="min-w-0 border-b border-line-strong">
      <h2 className="sticky top-0 lg:top-[60px] z-20 bg-bg">
        <button type="button" onClick={onToggle} aria-expanded={expanded} aria-controls={panelId}
          aria-labelledby={`${titleId} ${cueId}`}
          className="group flex w-full min-h-11 items-center gap-4 rounded py-4 text-left hover:bg-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
          <span className="min-w-0 flex-1">
            <span id={titleId} className="block font-serif text-[22px] font-medium leading-[1.2] tracking-[-0.015em] text-ink [overflow-wrap:anywhere]">
              <span className="mr-2 inline-block h-[10px] w-[10px] rounded-[3px]" style={{ background: color }} aria-hidden />
              {domain.name}
            </span>
            <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 font-mono text-[11px] font-normal text-ink-3">
              <Pill state={domain.urgency} />
              <span>{r.open} open</span>
              {r.overdue > 0 && <span className="text-accent">{r.overdue} overdue</span>}
              {r.waiting > 0 && <span>{r.waiting} waiting</span>}
              {r.attention > 0 && <span>{r.attention} {r.attention === 1 ? 'needs' : 'need'} attention</span>}
            </span>
            <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-sans text-[12px] font-normal text-ink-3">
              <span>{domain.assets.length} {domain.assets.length === 1 ? 'asset' : 'assets'} · {domain.projects.length} {domain.projects.length === 1 ? 'project' : 'projects'} · {domain.content.length} content</span>
              <span id={cueId} className="inline-flex items-center gap-1 text-ink-2 group-hover:text-accent">
                {expanded ? 'Hide contents' : 'Show contents'}
                <span className="inline-flex lg:hidden" aria-hidden>
                  <Icon name="chev" size={14} style={{ transform: `rotate(${expanded ? 90 : 0}deg)` }} />
                </span>
              </span>
            </span>
          </span>
          <span className="hidden lg:block h-[42px] max-w-[140px] shrink-0 overflow-hidden opacity-80" aria-hidden>
            <FittedArt name={domain.name} svg={artSvg} tone={domain.urgency === 'over' ? 'accent' : 'ink'} />
          </span>
          <span className="hidden lg:inline-flex shrink-0 text-ink-3" aria-hidden>
            <Icon name="chev" size={20} style={{ transform: `rotate(${expanded ? 90 : 0}deg)` }} />
          </span>
        </button>
      </h2>

      <div id={panelId} hidden={!expanded}>
        {expanded && (
          <div className="min-w-0 border-t border-line pb-5 [overflow-wrap:anywhere]">
            <Link href={`/domains/${domain.id}`} aria-label={`Open domain: ${domain.name}`} className={`${actionClass} my-2 underline underline-offset-4`}>
              Open domain<span aria-hidden className="ml-2">→</span>
            </Link>
            {domain.assets.length > 0 && (
              <div className="mb-4 space-y-4">
                <h3 className="font-mono text-[11px] uppercase tracking-wider text-ink-3">Assets &amp; their projects</h3>
                {domain.assets.map((a) => {
                  const projects = domain.projects.filter((p) => p.asset?.id === a.id);
                  return (
                    <div key={a.id} role="group" aria-label={a.name} className="min-w-0">
                      <div className="grid gap-3" style={cardGrid}><AssetCard a={a} color={color} /></div>
                      {projects.length > 0 && (
                        <div className="ml-2 mt-3 border-l-2 border-line pl-3">
                          <div className="grid gap-3" style={cardGrid}>
                            {projects.map((p) => <ProjectCard key={p.id} p={p} color={color} />)}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            {otherProjects.length > 0 && (
              <div className="mb-4">
                <h3 className="mb-3 font-mono text-[11px] uppercase tracking-wider text-ink-3">{domain.assets.length ? 'Other projects' : 'Projects'}</h3>
                <div className="grid gap-3" style={cardGrid}>
                  {otherProjects.map((p) => <ProjectCard key={p.id} p={p} color={color} />)}
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
