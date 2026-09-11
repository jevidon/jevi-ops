'use client';

import { useLayoutEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import type { WorkProjectCard, WorkContentRow, WorkAssetCard } from '@/lib/api';
import { proceduralIllustration } from '@jevi-ops/shared';
import { Pill } from '@/components/Pill';
import { Icon } from '@/components/Icon';
import { flipHolderAction } from './actions';

// Shared Work-map building blocks (extracted from work-view.tsx when the
// domain detail page adopted the same card grid). Everything renders straight
// off the server-computed payload — urgency and counts are never re-derived.

export const CONTENT_TYPE_LABEL: Record<string, string> = {
  video: 'Video', course: 'Course', article: 'Article',
  short_clip: 'Short', podcast_episode: 'Podcast', newsletter: 'Newsletter',
};

// Waiting/holder aging → the single accent, ramping in.
export function ageClass(days: number | null): string {
  if (days == null) return 'text-ink-3';
  if (days >= 14) return 'text-accent';
  if (days >= 7) return 'text-accent/80';
  if (days >= 3) return 'text-ink-2';
  return 'text-ink-3';
}

// Header art, fitted to its ink. Motifs frame themselves differently inside
// the 240×100 canvas (strokes typically live in y 20–80, x varies per
// drawing), so a fixed viewBox leaves arbitrary dead margins — the art
// looked detached from the title. This measures the rendered strokes
// (getBBox) and tightens the viewBox to the actual drawing, so every
// motif — procedural or committed — hugs the title and rests on the rule.
// First paint uses the contract band (0 14 240 72); the fit lands before
// the browser paints (useLayoutEffect), and the box has a fixed height so
// nothing shifts.
export function FittedArt({ name, svg, tone }: { name: string; svg?: string | null; tone: 'ink' | 'accent' }) {
  const gRef = useRef<SVGGElement>(null);
  const [viewBox, setViewBox] = useState('0 14 240 72');
  const inner = svg && svg.trim() ? svg : proceduralIllustration(name);

  useLayoutEffect(() => {
    const g = gRef.current;
    if (!g) return;
    try {
      const b = g.getBBox();
      if (b.width > 4 && b.height > 4) {
        const pad = 2.5;
        setViewBox(`${b.x - pad} ${b.y - pad} ${b.width + pad * 2} ${b.height + pad * 2}`);
      }
    } catch {
      /* detached/unsupported — keep the contract band */
    }
  }, [inner]);

  return (
    <svg
      viewBox={viewBox}
      preserveAspectRatio="xMinYMax meet"
      aria-hidden="true"
      className={`domain-ill h-full w-auto ${
        tone === 'accent' ? 'domain-ill-accent text-accent-slip/80' : 'text-ink-3'
      }`}
    >
      <g
        ref={gRef}
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
        dangerouslySetInnerHTML={{ __html: inner }}
      />
    </svg>
  );
}

export function ProjectCard({ p, color }: { p: WorkProjectCard; color: string }) {
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
        p.flagged ? 'border-[color:rgb(var(--accent)_/_0.55)] hover:border-accent' : 'border-line hover:border-line-strong'
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
          {/* The asset this work groups under (0049) — stays in the flat
              grid, chipped, rather than nesting under the asset card. */}
          {p.asset && ` · ${p.asset.name}`}
          {p.paused && ' · paused'}
        </div>
        {pct != null && (
          <div className="h-1 rounded-full bg-surface-2 overflow-hidden">
            {/* target = ink-2 fill; retainer cycle = lighter ink-4 fill */}
            <div className="h-full rounded-full" style={{ width: `${pct}%`, background: p.kind === 'target' ? 'rgb(var(--ink-2))' : 'rgb(var(--ink-4))' }} />
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

// The asset card (0049) — the ProjectCard shell (3px domain cap, serif
// name, mono meta, counts) for an asset assigned to the domain. Meta line is
// the meter; the foot is maintenance due counts and grouped projects. The
// pill is the server-derived urgency; "Due soon" overrides the label when
// the worst item is inside its lead window but not yet due. Data confidence
// (no baseline / no reading / stale) prints separately — an unknown meter
// axis is a question, never a calm card.
const DATA_NOTE: Record<WorkAssetCard['data'], string | null> = {
  complete: null,
  needs_baseline: 'needs a baseline reading',
  needs_reading: 'no reading yet',
  stale_reading: 'reading stale',
};

export function AssetCard({ a, color }: { a: WorkAssetCard; color: string }) {
  const m = a.maintenance;
  const due = m.overdue + m.due;
  const dataNote = DATA_NOTE[a.data];
  const meter =
    a.meter_unit == null
      ? null
      : a.latest_reading != null
        ? `${a.latest_reading.toLocaleString('en-US')} ${a.meter_unit}`
        : `no ${a.meter_unit} reading`;
  return (
    <Link
      href={`/assets/${a.id}`}
      className={`block rounded overflow-hidden border bg-bg transition-colors ${
        a.flagged ? 'border-[color:rgb(var(--accent)_/_0.55)] hover:border-accent' : 'border-line hover:border-line-strong'
      }`}
    >
      <div className="h-[3px]" style={{ background: color }} />
      <div className="px-3.5 pt-3.5 pb-3">
        <div className="flex items-center justify-between gap-2.5 mb-2">
          <span className="inline-flex items-center gap-2.5 min-w-0">
            {a.hero ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={a.hero} alt="" className="w-10 h-10 rounded object-cover shrink-0 border border-line" />
            ) : (
              <span className="w-10 h-10 rounded bg-surface-2 border border-line shrink-0 grid place-items-center text-ink-3" aria-hidden>
                <Icon name="maintenance" size={18} />
              </span>
            )}
            <span className="inline-flex items-baseline gap-1.5 min-w-0">
              {a.flagged && <span className="w-1.5 h-1.5 rounded-full bg-accent shrink-0 translate-y-[-1px]" aria-hidden />}
              <span className="font-serif text-[16.5px] font-medium leading-[1.2] tracking-[-0.01em] text-ink truncate">{a.name}</span>
            </span>
          </span>
          <Pill state={a.urgency}>{a.worst === 'due_soon' ? 'Due soon' : undefined}</Pill>
        </div>
        <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3 mb-[11px] whitespace-nowrap overflow-hidden text-ellipsis">
          {a.kind}
          {meter && ` · ${meter}`}
          {a.latest_reading_days_ago != null && a.latest_reading_days_ago > 0 && ` · ${a.latest_reading_days_ago}d ago`}
        </div>
        <div className="flex items-center justify-between mt-2.5">
          <span className="font-mono text-[11px] text-ink-3">
            {due > 0 && <span className="text-accent">{due} due · </span>}
            {m.due_soon > 0 && `${m.due_soon} soon · `}
            {m.total} item{m.total === 1 ? '' : 's'}
          </span>
          <span className="font-mono text-[10.5px] text-ink-4">
            {a.projects} project{a.projects === 1 ? '' : 's'}
          </span>
        </div>
        {dataNote && <div className="mt-1 font-mono text-[10px] text-ink-3">{dataNote}</div>}
      </div>
    </Link>
  );
}

export function ContentRow({ c, color }: { c: WorkContentRow; color: string }) {
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
