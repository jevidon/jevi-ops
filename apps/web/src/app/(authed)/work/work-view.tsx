'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import type { WorkPayload, WorkDomain, WorkProjectCard, WorkContentRow } from '@/lib/api';
import type { Urgency } from '@jevi-ops/shared';
import { URGENCY_LABEL } from '@jevi-ops/shared';
import { Pill } from '@/components/Pill';
import { Icon } from '@/components/Icon';
import { FacetRail, FacetGroup, FacetRow, FacetTag, FacetTags, FacetSep } from '@/components/FacetRail';
import { domainColor } from '@/lib/domain-colors';
import { DomainFrieze } from '../domains/domain-illustration';
import { flipHolderAction } from './actions';
import { FocusControl, type FocusOption } from './focus-control';

// The Work page (Addendum 08 + v2 redesign, Jul 2026). One computed map: a left
// facet rail (View / Domain / Status / Show) filters domain sections, each a
// sticky colour-chip header over project cards + content rows + direct tasks.
//
// Everything is server-derived — the urgency pills come straight off the
// payload's `urgency` fields (buildWork), never re-computed here, so a domain
// pill can't disagree with a card inside it. State here is UI-only (filters,
// collapse). Preserved from Addendum 08: Tomorrow's Focus, the holder flip, and
// the needs-attention semantics.

const CONTENT_TYPE_LABEL: Record<string, string> = {
  video: 'Video', course: 'Course', article: 'Article',
  short_clip: 'Short', podcast_episode: 'Podcast', newsletter: 'Newsletter',
};

const STATUS_ORDER: Urgency[] = ['over', 'due', 'ok', 'quiet'];
type Kind = 'projects' | 'content' | 'tasks';

// Waiting/holder aging → the single accent, ramping in.
function ageClass(days: number | null): string {
  if (days == null) return 'text-ink-3';
  if (days >= 14) return 'text-accent';
  if (days >= 7) return 'text-accent/80';
  if (days >= 3) return 'text-ink-2';
  return 'text-ink-3';
}

// Addendum 08 §5 needs-attention predicates — richer than a plain over/due.
const projectNeedsAttention = (p: WorkProjectCard) =>
  p.flagged || p.overdue > 0 || (p.waitDays != null && p.waitDays >= 7);
const contentNeedsAttention = (c: WorkContentRow) =>
  c.flagged || (c.holder === 'editor' && c.days != null && c.days >= 7) || c.myMoveDue;
// A domain "needs attention" (badge + filter share this so they can't disagree).
// Note: waiting-aging and flagged signals don't lift urgency to over/due, so
// checking the pill state alone would undercount — check the real predicates.
const domainNeedsAttention = (d: WorkDomain) =>
  d.rollup.attention > 0 ||
  d.projects.some(projectNeedsAttention) ||
  d.content.some(contentNeedsAttention) ||
  d.direct.overdue > 0 ||
  d.direct.waitingAging > 0;

export function WorkView({
  payload,
  tomorrowFocus,
  tomorrowDate,
  art = {},
}: {
  payload: WorkPayload;
  tomorrowFocus: { title: string; href: string } | null;
  tomorrowDate: string;
  // Fork: committed domain engravings (domain id → inner-SVG), rendered as
  // muted spot art in section headers. Absent entries render no art.
  art?: Record<string, string>;
}) {
  const [attention, setAttention] = useState(false);
  const [dsel, setDsel] = useState<Set<string>>(new Set());
  const [ssel, setSsel] = useState<Set<Urgency>>(new Set());
  const [kinds, setKinds] = useState<Set<Kind>>(new Set(['projects', 'content', 'tasks']));
  const [showParked, setShowParked] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const toggle = <T,>(set: React.Dispatch<React.SetStateAction<Set<T>>>, v: T) =>
    set((s) => {
      const n = new Set(s);
      n.has(v) ? n.delete(v) : n.add(v);
      return n;
    });

  // Apply the active facets to a domain, returning a filtered copy or null if it
  // drops out. Preserves the Addendum 08 needs-attention semantics for the View
  // toggle; Status is the new four-state multi-select.
  const applyFacets = (d: WorkDomain): WorkDomain | null => {
    let projects = kinds.has('projects') ? d.projects : [];
    let content = kinds.has('content') ? d.content : [];

    if (attention) {
      projects = projects.filter(projectNeedsAttention);
      content = content.filter(contentNeedsAttention);
    }
    if (ssel.size) {
      projects = projects.filter((p) => ssel.has(p.urgency));
      content = content.filter((c) => ssel.has(c.urgency));
    }

    // Domain drops out when nothing survives AND it has no other reason to show.
    const directHot =
      kinds.has('tasks') && (d.direct.overdue > 0 || d.direct.waitingAging > 0);
    if (attention && d.rollup.attention === 0 && !projects.length && !content.length && !directHot) {
      return null;
    }
    if (ssel.size && !ssel.has(d.urgency) && !projects.length && !content.length) {
      return null;
    }
    return { ...d, projects, content };
  };

  const visibleDomains = useMemo(() => {
    let list = payload.domains;
    if (dsel.size) list = list.filter((d) => dsel.has(d.id));
    return list.map(applyFacets).filter((d): d is WorkDomain => d !== null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payload.domains, dsel, ssel, kinds, attention]);

  // Focus candidates — active projects + my-move content, from the same payload.
  const focusOptions = useMemo<FocusOption[]>(() => {
    const out: FocusOption[] = [];
    for (const d of payload.domains) {
      for (const p of d.projects) {
        if (p.paused) continue;
        out.push({ type: 'project', id: p.id, label: p.name, context: p.client ?? d.name });
      }
      for (const c of d.content) {
        if (c.holder !== 'me') continue;
        out.push({ type: 'content_item', id: c.id, label: c.title, context: c.status });
      }
    }
    return out;
  }, [payload.domains]);

  const attentionCount = payload.domains.filter(domainNeedsAttention).length;
  const activeFilters = dsel.size + ssel.size + (attention ? 1 : 0) + (3 - kinds.size);
  const resetFilters = () => {
    setAttention(false);
    setDsel(new Set());
    setSsel(new Set());
    setKinds(new Set(['projects', 'content', 'tasks']));
  };

  // The celebratory reward state means "the whole board is genuinely clear" —
  // only when Needs-attention is the ONLY active facet. A Status- or
  // Show-emptied view falls through to the neutral "nothing matches" message.
  const nothingFlagged =
    attention && dsel.size === 0 && ssel.size === 0 && kinds.size === 3 && visibleDomains.length === 0;

  return (
    <div className="lg:flex">
      {/* ─── Facet rail ─────────────────────────────────────────────── */}
      <FacetRail activeCount={activeFilters} onReset={resetFilters}>
        <FacetGroup
          label="View"
          action={
            activeFilters > 0 ? (
              <button type="button" onClick={resetFilters} className="font-mono text-[9px] uppercase tracking-[0.09em] text-ink-3 hover:text-accent transition-colors">
                Reset
              </button>
            ) : undefined
          }
        >
          <FacetRow on={!attention} onClick={() => setAttention(false)} name="All work" count={payload.domains.length} />
          <FacetRow on={attention} onClick={() => setAttention(true)} name="Needs attention" count={attentionCount} />
        </FacetGroup>
        <FacetSep />

        <FacetGroup
          label="Domain"
          action={
            dsel.size ? (
              <button type="button" onClick={() => setDsel(new Set())} className="font-mono text-[9px] uppercase tracking-[0.09em] text-ink-3 hover:text-accent transition-colors">
                Clear
              </button>
            ) : undefined
          }
        >
          {payload.domains.map((d) => (
            <FacetRow
              key={d.id}
              on={dsel.has(d.id)}
              onClick={() => toggle(setDsel, d.id)}
              color={domainColor(d.name)}
              name={d.name}
              count={d.projects.length + d.content.length + d.rollup.open}
            />
          ))}
        </FacetGroup>
        <FacetSep />

        <FacetGroup
          label="Status"
          action={
            ssel.size ? (
              <button type="button" onClick={() => setSsel(new Set())} className="font-mono text-[9px] uppercase tracking-[0.09em] text-ink-3 hover:text-accent transition-colors">
                Clear
              </button>
            ) : undefined
          }
        >
          <FacetTags>
            {STATUS_ORDER.map((s) => (
              <FacetTag key={s} on={ssel.has(s)} onClick={() => toggle(setSsel, s)} name={URGENCY_LABEL[s]} />
            ))}
          </FacetTags>
        </FacetGroup>
        <FacetSep />

        <FacetGroup label="Show">
          {([['projects', 'Projects'], ['content', 'Content'], ['tasks', 'Direct tasks']] as [Kind, string][]).map(
            ([k, label]) => (
              <FacetRow key={k} on={kinds.has(k)} onClick={() => toggle(setKinds, k)} name={label} />
            ),
          )}
        </FacetGroup>
      </FacetRail>

      {/* ─── Body ───────────────────────────────────────────────────── */}
      <div className="flex-1 min-w-0 px-5 lg:px-0 lg:pl-8 pt-6 pb-24">
        {/* Masthead */}
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4 mb-5">
          <div>
            <div className="eyebrow mb-2">Manager&rsquo;s map · everything computed</div>
            <h1 className="font-serif text-[40px] font-medium leading-[1.02] tracking-[-0.022em] text-ink">Work</h1>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Link
              href="/content?status=idea"
              className="inline-flex items-center h-[34px] px-3 rounded border border-line-strong font-mono text-[10px] uppercase tracking-[0.09em] text-ink-2 hover:border-ink-3 hover:text-ink transition-colors"
            >
              Ideas ({payload.ideasCount})
            </Link>
            <Link
              href="/projects/new"
              className="inline-flex items-center h-[34px] px-3 rounded bg-ink border border-ink font-mono text-[10px] uppercase tracking-[0.09em] text-bg hover:bg-ink-2 transition-colors"
            >
              + Project
            </Link>
          </div>
        </div>

        {/* Tomorrow's focus */}
        <div className="border-y border-line mb-3">
          <FocusControl current={tomorrowFocus} options={focusOptions} date={tomorrowDate} />
        </div>

        {/* Domain sections */}
        {nothingFlagged ? (
          <WorkEmpty />
        ) : visibleDomains.length === 0 ? (
          <div className="pt-16 text-center">
            <div className="font-serif text-[25px] font-medium tracking-[-0.015em] text-ink">Nothing matches this view.</div>
            <p className="mt-1.5 font-sans text-[14px] text-ink-3">Loosen a filter on the left, or reset them all.</p>
          </div>
        ) : (
          visibleDomains.map((d) => (
            <DomainSection key={d.id} domain={d} kinds={kinds} artSvg={art[d.id]} collapsed={collapsed.has(d.id)} onToggle={() => toggle(setCollapsed, d.id)} />
          ))
        )}

        {/* Parked */}
        {payload.parked.length > 0 && (
          <div className="mt-8">
            <button
              type="button"
              onClick={() => setShowParked((v) => !v)}
              className="font-mono text-[10px] uppercase tracking-wider text-ink-3 hover:text-ink-2 transition-colors"
            >
              {showParked ? '▾' : '▸'} Parked ({payload.parked.length})
            </button>
            {showParked && (
              <div className="mt-4 opacity-60">
                {/* Run parked domains through the same facets so Status/Show/
                    attention narrow them too. */}
                {payload.parked
                  .map(applyFacets)
                  .filter((d): d is WorkDomain => d !== null)
                  .map((d) => (
                    <DomainSection key={d.id} domain={d} kinds={kinds} artSvg={art[d.id]} collapsed={collapsed.has(d.id)} onToggle={() => toggle(setCollapsed, d.id)} />
                  ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function DomainSection({
  domain, kinds, artSvg, collapsed, onToggle,
}: {
  domain: WorkDomain;
  kinds: Set<Kind>;
  // Fork: committed engraving (inner-SVG) shown as muted header spot art.
  artSvg?: string;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const r = domain.rollup;
  const color = domainColor(domain.name);
  const showDirect = kinds.has('tasks') && (domain.direct.open > 0 || domain.direct.waiting > 0);
  const empty =
    domain.projects.length === 0 && domain.content.length === 0 && !showDirect;

  return (
    <section className="mb-8">
      {/* Sticky header — colour chip · name · urgency pill · counts · toggle,
          with a 2px ink rule under it. Sticks below the 60px topbar. */}
      <div className="sticky top-0 lg:top-[60px] z-20 flex items-center gap-3 py-3 bg-bg border-b-2 border-ink">
        <span className="w-[11px] h-[11px] rounded-[3px] shrink-0" style={{ background: color }} aria-hidden />
        {/* Name links to the domain detail page — settings, cadence rule, and
            the illustration panel live there. Previously the only doorway was
            the Direct-tasks chip, which not every domain renders. */}
        <Link
          href={`/domains/${domain.id}`}
          className="font-serif text-[21px] font-medium leading-none tracking-[-0.015em] text-ink truncate shrink min-w-0 hover:text-accent transition-colors"
        >
          {domain.name}
        </Link>
        <Pill state={domain.urgency} />
        <div className="flex items-center gap-3 ml-auto min-w-0 overflow-hidden font-mono text-[11px] font-medium text-ink-3">
          <span className="whitespace-nowrap">{r.open} open</span>
          {r.overdue > 0 && <span className="whitespace-nowrap text-accent">{r.overdue} overdue</span>}
          {r.waiting > 0 && <span className="whitespace-nowrap">{r.waiting} waiting</span>}
        </div>
        <button
          type="button"
          onClick={onToggle}
          aria-label={collapsed ? 'Expand' : 'Collapse'}
          className="grid place-items-center w-6 h-6 shrink-0 rounded text-ink-3 hover:bg-surface-2 hover:text-ink transition-colors"
        >
          <Icon name="chev" size={15} style={{ transform: `rotate(${collapsed ? 0 : 90}deg)`, transition: 'transform .15s' }} />
        </button>
      </div>

      {!collapsed && (
        <div className="pt-3.5">
          {/* Fork: engraved frieze banner — the domain's committed art (or its
              name-seeded procedural motif) tiled under the sticky header,
              fading out right. Scrolls away with the section; accent-inked
              when the domain is slipping. Identity, not information. */}
          <div
            className="hidden lg:block h-[56px] mb-3.5 overflow-hidden opacity-[0.55]"
            style={{
              WebkitMaskImage: 'linear-gradient(to right, black 45%, transparent 96%)',
              maskImage: 'linear-gradient(to right, black 45%, transparent 96%)',
            }}
            aria-hidden
          >
            <DomainFrieze name={domain.name} svg={artSvg} tone={domain.urgency === 'over' ? 'accent' : 'ink'} />
          </div>
          {domain.projects.length > 0 && (
            <div
              className="grid gap-3.5 mb-3"
              style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(258px, 1fr))' }}
            >
              {domain.projects.map((p) => <ProjectCard key={p.id} p={p} color={color} />)}
            </div>
          )}
          {domain.content.length > 0 && (
            <div className="border border-line rounded mb-3">
              {domain.content.map((c) => <ContentRow key={c.id} c={c} color={color} />)}
            </div>
          )}
          <div className="flex items-center gap-4">
            {showDirect && (
              <Link href={`/domains/${domain.id}`} className="inline-flex items-center gap-1.5 h-[26px] px-[9px] rounded border border-line-strong font-mono text-[9.5px] font-semibold uppercase tracking-[0.07em] text-ink-3 hover:border-ink-3 hover:text-ink transition-colors">
                Direct tasks {domain.direct.open}
                {domain.direct.overdue > 0 && ` · ${domain.direct.overdue} overdue`}
                {domain.direct.waiting > 0 && ` · ${domain.direct.waiting} waiting`}
              </Link>
            )}
            <Link href={`/projects/new?domain_id=${domain.id}`} className="font-mono text-[9px] uppercase tracking-[0.09em] text-ink-3 hover:text-accent transition-colors">
              + Project in {domain.name}
            </Link>
          </div>
          {empty && <p className="mt-0.5 font-sans text-[13px] italic text-ink-3">Nothing open.</p>}
        </div>
      )}
    </section>
  );
}

function ProjectCard({ p, color }: { p: WorkProjectCard; color: string }) {
  const pct =
    p.kind === 'target'
      ? p.pct
      : p.cycle
        ? Math.round((p.cycle.day / p.cycle.length) * 100)
        : null;
  return (
    <Link
      href={`/projects/${p.id}`}
      // flagged (has an active attention item) → accent border; paused → dimmed.
      className={`block rounded overflow-hidden border bg-bg transition-colors ${
        p.flagged ? 'border-[rgba(184,68,43,0.55)] hover:border-accent' : 'border-line hover:border-line-strong'
      } ${p.paused ? 'opacity-60' : ''}`}
    >
      <div className="h-[3px]" style={{ background: color }} />
      <div className="px-3.5 pt-3.5 pb-3">
        <div className="flex items-start justify-between gap-2.5 mb-2">
          <span className="inline-flex items-baseline gap-1.5 min-w-0">
            {p.flagged && <span className="w-1.5 h-1.5 rounded-full bg-accent shrink-0 translate-y-[-1px]" aria-hidden />}
            <span className="font-serif text-[16.5px] font-medium leading-[1.2] tracking-[-0.01em] text-ink">{p.name}</span>
          </span>
          <Pill state={p.urgency} />
        </div>
        <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3 mb-[11px] whitespace-nowrap overflow-hidden text-ellipsis">
          {p.kind === 'retainer'
            ? p.cycle ? `Retainer · day ${p.cycle.day}/${p.cycle.length}` : 'Retainer'
            : p.target ? `Target ${p.target.slice(5)}` : 'No target'}
          {p.paused && ' · paused'}
        </div>
        {pct != null && (
          <div className="h-1 rounded-full bg-surface-2 overflow-hidden">
            {/* target = ink-2 fill; retainer cycle = lighter ink-4 fill */}
            <div className="h-full rounded-full" style={{ width: `${pct}%`, background: p.kind === 'target' ? '#57524A' : '#B6AFA4' }} />
          </div>
        )}
        <div className="flex items-center justify-between mt-2.5">
          <span className="font-mono text-[11px] text-ink-3">
            {p.open} open
            {p.waiting > 0 && ` · ${p.waiting} waiting`}
            {p.overdue > 0 && <span className="text-accent"> · {p.overdue} overdue</span>}
          </span>
          <span className="font-mono text-[10.5px] text-ink-4">{p.recency}</span>
        </div>
        {p.waiting > 0 && p.waitOn && (
          <div className="mt-1 font-mono text-[10px] text-ink-3">
            waiting on {p.waitOn} <span className={ageClass(p.waitDays)}>{p.waitDays}d</span>
          </div>
        )}
      </div>
    </Link>
  );
}

function ContentRow({ c, color }: { c: WorkContentRow; color: string }) {
  const [pending, start] = useTransition();
  const withEditor = c.holder === 'editor';
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 border-b border-line last:border-b-0 hover:bg-surface transition-colors">
      {/* flagged content gets an accent ring on the domain swatch. */}
      <span
        className={`w-[9px] h-[9px] rounded-[2.5px] shrink-0 ${c.flagged ? 'ring-1 ring-offset-1 ring-accent ring-offset-bg' : ''}`}
        style={{ background: color }}
        aria-hidden
      />
      <div className="flex-1 min-w-0">
        <Link href={`/content/${c.id}`} className="block font-sans text-[14.5px] leading-[1.3] text-ink hover:text-accent transition-colors truncate">
          {c.title}
        </Link>
        <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3 mt-1">
          {CONTENT_TYPE_LABEL[c.type] ?? c.type}
          {withEditor
            ? <> · with editor <span className={ageClass(c.days)}>{c.days ?? 0}d</span></>
            : c.move ? <span className="text-ink-2"> · {c.move}</span> : ''}
        </div>
      </div>
      <Pill state={c.urgency} />
      <button
        type="button"
        disabled={pending}
        onClick={() => start(() => flipHolderAction(c.id, withEditor ? 'me' : 'editor'))}
        className="shrink-0 inline-flex items-center h-[26px] px-[9px] rounded border border-line-strong font-mono text-[9.5px] font-semibold uppercase tracking-[0.07em] text-ink-3 hover:border-ink-3 hover:text-ink transition-colors disabled:opacity-40"
        title={withEditor ? 'Take it back' : 'Send to editor'}
      >
        {withEditor ? '→ me' : '→ editor'}
      </button>
    </div>
  );
}

function WorkEmpty() {
  return (
    <div className="pt-16 text-center">
      <div className="font-serif text-[25px] font-medium tracking-[-0.015em] text-ink">Nothing needs attention.</div>
      <p className="mt-1.5 font-sans text-[14px] text-ink-2">Everything is on pace. Rare — worth noticing.</p>
    </div>
  );
}
