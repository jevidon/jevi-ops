'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import type { ContentItem } from '@/lib/api';
import { contentUrgency } from '@jevi-ops/shared';
import { Pill } from '@/components/Pill';
import { Icon } from '@/components/Icon';
import { FacetRail, FacetGroup, FacetRow, FacetTag, FacetTags, FacetSep } from '@/components/FacetRail';
import { domainColor } from '@/lib/domain-colors';
import { youtubeThumbnailUrl } from '@/lib/youtube';
import { todayIsoDate } from '@/lib/today';
import { flipHolderAction, keepIdeaAction, archiveIdeaAction } from './actions';

// Content — the pipeline (v2 redesign, Jul 2026). Left facet rail (Stage /
// Channel / Type / Holder) filters items grouped by stage under the same sticky
// colour-chip header Work uses. Urgency pills are derived (shared contentUrgency),
// the holder flip is preserved, and the Addendum-09 Keep/Archive idea controls
// ride on idea-stage rows.

// The seven content stages, in pipeline order, with identity colours. `id`
// stays a plain string so the filter Set is Set<string> (statuses are a subset).
const STAGES: { id: string; label: string; color: string }[] = [
  { id: 'idea', label: 'Idea', color: '#B6AFA4' },
  { id: 'outline', label: 'Outline', color: '#8A6A2F' },
  { id: 'filming', label: 'Filming', color: '#6B5B95' },
  { id: 'editing', label: 'Editing', color: '#2F5D8A' },
  { id: 'published', label: 'Published', color: '#3B6A52' },
  { id: 'derivatives_pending', label: 'Derivatives', color: '#4A6B70' },
  { id: 'done', label: 'Done', color: '#B6AFA4' },
];
const SHIPPED = new Set<string>(['published', 'done']);

const TYPE_LABEL: Record<string, string> = {
  video: 'Video', course: 'Course', article: 'Article',
  short_clip: 'Short', podcast_episode: 'Podcast', newsletter: 'Newsletter',
};

function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 86_400_000);
}
function ageClass(days: number | null): string {
  if (days == null) return 'text-ink-3';
  if (days >= 14) return 'text-accent';
  if (days >= 7) return 'text-accent/80';
  if (days >= 3) return 'text-ink-2';
  return 'text-ink-3';
}

// In-flight = everything not shipped. Lets a legacy ?status=in_progress link
// still preselect the active pipeline.
const IN_FLIGHT_STAGES = STAGES.filter((s) => !SHIPPED.has(s.id)).map((s) => s.id);

export function ContentView({
  items,
  today,
  tz,
  initialStage,
}: {
  items: ContentItem[];
  today: string;
  tz: string;
  // Preselect a stage from a ?status= deep link (e.g. Work's "Ideas" link).
  initialStage?: string;
}) {
  const [stages, setStages] = useState<Set<string>>(() => {
    if (initialStage && STAGES.some((s) => s.id === initialStage)) return new Set([initialStage]);
    if (initialStage === 'in_progress') return new Set(IN_FLIGHT_STAGES);
    return new Set();
  });
  const [types, setTypes] = useState<Set<string>>(new Set());
  const [chans, setChans] = useState<Set<string>>(new Set());
  const [holder, setHolder] = useState<'me' | 'editor' | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const toggle = <T,>(set: React.Dispatch<React.SetStateAction<Set<T>>>, v: T) =>
    set((s) => {
      const n = new Set(s);
      n.has(v) ? n.delete(v) : n.add(v);
      return n;
    });

  // Channel facet = the content's domain (the YouTube-channel-style domains).
  const channels = useMemo(() => {
    const m = new Map<string, { name: string; count: number }>();
    for (const c of items) {
      if (!c.domain_id) continue;
      const e = m.get(c.domain_id) ?? { name: c.domain?.name ?? '(channel)', count: 0 };
      e.count += 1;
      m.set(c.domain_id, e);
    }
    return [...m.entries()].map(([id, v]) => ({ id, ...v })).sort((a, b) => a.name.localeCompare(b.name));
  }, [items]);

  const typeFacets = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of items) m.set(c.type, (m.get(c.type) ?? 0) + 1);
    return [...m.entries()].map(([id, count]) => ({ id, count }));
  }, [items]);

  const visible = useMemo(
    () =>
      items.filter((c) => {
        if (stages.size && !stages.has(c.status)) return false;
        if (types.size && !types.has(c.type)) return false;
        if (chans.size && (!c.domain_id || !chans.has(c.domain_id))) return false;
        if (holder && c.holder !== holder) return false;
        return true;
      }),
    [items, stages, types, chans, holder],
  );

  const inFlight = items.filter((c) => !SHIPPED.has(c.status)).length;
  const shipped = items.filter((c) => SHIPPED.has(c.status)).length;
  const ideaCount = items.filter((c) => c.status === 'idea').length;
  const activeFilters = stages.size + types.size + chans.size + (holder ? 1 : 0);
  const reset = () => { setStages(new Set()); setTypes(new Set()); setChans(new Set()); setHolder(null); };

  return (
    <div className="lg:flex">
      {/* ─── Facet rail ─────────────────────────────────────────────── */}
      <FacetRail activeCount={activeFilters} onReset={reset}>
        <FacetGroup
          label="Stage"
          action={activeFilters > 0 ? <ClearBtn onClick={reset} label="Reset" /> : undefined}
        >
          {STAGES.map((s) => {
            const n = items.filter((c) => c.status === s.id).length;
            return n ? (
              <FacetRow key={s.id} on={stages.has(s.id)} onClick={() => toggle(setStages, s.id)} color={s.color} name={s.label} count={n} />
            ) : null;
          })}
        </FacetGroup>
        <FacetSep />

        {channels.length > 0 && (
          <>
            <FacetGroup label="Channel" action={chans.size ? <ClearBtn onClick={() => setChans(new Set())} /> : undefined}>
              {channels.map((c) => (
                <FacetRow key={c.id} on={chans.has(c.id)} onClick={() => toggle(setChans, c.id)} color={domainColor(c.name)} name={c.name} count={c.count} />
              ))}
            </FacetGroup>
            <FacetSep />
          </>
        )}

        <FacetGroup label="Type" action={types.size ? <ClearBtn onClick={() => setTypes(new Set())} /> : undefined}>
          <FacetTags>
            {typeFacets.map((t) => (
              <FacetTag key={t.id} on={types.has(t.id)} onClick={() => toggle(setTypes, t.id)} name={TYPE_LABEL[t.id] ?? t.id} count={t.count} />
            ))}
          </FacetTags>
        </FacetGroup>
        <FacetSep />

        <FacetGroup label="Holder" action={holder ? <ClearBtn onClick={() => setHolder(null)} /> : undefined}>
          <FacetRow on={holder === 'me'} onClick={() => setHolder(holder === 'me' ? null : 'me')} name="My move" count={items.filter((c) => c.holder === 'me').length} />
          <FacetRow on={holder === 'editor'} onClick={() => setHolder(holder === 'editor' ? null : 'editor')} name="With editor" count={items.filter((c) => c.holder === 'editor').length} />
        </FacetGroup>
      </FacetRail>

      {/* ─── Body ───────────────────────────────────────────────────── */}
      <div className="flex-1 min-w-0 px-5 lg:px-0 lg:pl-8 pt-6 pb-24">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4 mb-5">
          <div>
            <div className="eyebrow mb-2">Pipeline · {inFlight} in flight · {shipped} published</div>
            <h1 className="font-serif text-[40px] font-medium leading-[1.02] tracking-[-0.022em] text-ink">Content</h1>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Link href="/content?status=idea" className="inline-flex items-center h-[34px] px-3 rounded border border-line-strong font-mono text-[10px] uppercase tracking-[0.09em] text-ink-2 hover:border-ink-3 hover:text-ink transition-colors">
              Ideas · {ideaCount}
            </Link>
            <Link href="/content/new" className="inline-flex items-center gap-1.5 h-[34px] px-3 rounded bg-ink border border-ink font-mono text-[10px] uppercase tracking-[0.09em] text-bg hover:bg-ink-2 transition-colors">
              <Icon name="capture" size={14} /> Add item
            </Link>
          </div>
        </div>

        {STAGES.map((s) => {
          let rows = visible.filter((c) => c.status === s.id);
          if (!rows.length) return null;
          // Shipped stages read as a release log — newest published first.
          if (SHIPPED.has(s.id)) {
            rows = [...rows].sort((a, b) =>
              (b.published_at ?? b.updated_at).localeCompare(a.published_at ?? a.updated_at),
            );
          }
          const isCollapsed = collapsed.has(s.id);
          return (
            <section key={s.id} className="mb-8">
              <div className="sticky top-0 lg:top-[60px] z-20 flex items-center gap-3 py-3 bg-bg border-b-2 border-ink">
                <span className="w-[11px] h-[11px] rounded-[3px] shrink-0" style={{ background: s.color }} aria-hidden />
                <span className="font-serif text-[21px] font-medium leading-none tracking-[-0.015em] text-ink truncate shrink min-w-0">{s.label}</span>
                <span className="ml-auto font-mono text-[11px] font-medium text-ink-3 whitespace-nowrap">
                  {rows.length} item{rows.length === 1 ? '' : 's'}
                </span>
                <button
                  type="button"
                  onClick={() => toggle(setCollapsed, s.id)}
                  aria-label={isCollapsed ? 'Expand' : 'Collapse'}
                  className="grid place-items-center w-6 h-6 shrink-0 rounded text-ink-3 hover:bg-surface-2 hover:text-ink transition-colors"
                >
                  <Icon name="chev" size={15} style={{ transform: `rotate(${isCollapsed ? 0 : 90}deg)`, transition: 'transform .15s' }} />
                </button>
              </div>
              {!isCollapsed && (
                <div className="border border-line rounded mt-3.5">
                  {rows.map((c) => <ContentRow key={c.id} c={c} today={today} tz={tz} />)}
                </div>
              )}
            </section>
          );
        })}

        {visible.length === 0 && (
          <div className="pt-16 text-center">
            <div className="font-serif text-[25px] font-medium tracking-[-0.015em] text-ink">Nothing in this view.</div>
            <p className="mt-1.5 font-sans text-[14px] text-ink-3">Loosen a filter on the left, or reset them all.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function ContentRow({ c, today, tz }: { c: ContentItem; today: string; tz: string }) {
  const [pending, start] = useTransition();
  const withEditor = c.holder === 'editor';
  // Aging basis is the APP-TZ date of holder_since, so this matches the Work
  // page exactly (both derive from the Denver calendar day, not the UTC slice).
  const days = c.holder_since
    ? Math.max(0, daysBetween(todayIsoDate(tz, new Date(c.holder_since)), today))
    : null;
  const myMoveDue =
    c.holder === 'me' && c.target_publish_date != null && daysBetween(today, c.target_publish_date) <= 7;
  const urgency = contentUrgency({ holder: c.holder, target: c.target_publish_date, myMoveDue, days, today });
  const thumb = c.video_url ? youtubeThumbnailUrl(c.video_url, 'mq') : null;
  const channelName = c.domain?.name ?? null;
  const isIdea = c.status === 'idea';

  return (
    <div className="flex items-center gap-3 px-3 py-2.5 border-b border-line last:border-b-0 hover:bg-surface transition-colors">
      <div className="w-16 h-10 shrink-0 rounded-[3px] bg-surface-2 overflow-hidden grid place-items-center">
        {thumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumb} alt="" className="w-full h-full object-cover" loading="lazy" />
        ) : (
          <span className="font-mono text-[8.5px] font-semibold uppercase tracking-[0.09em] text-ink-4">
            {TYPE_LABEL[c.type] ?? c.type}
          </span>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <Link href={`/content/${c.id}`} className="block font-sans text-[14.5px] leading-[1.3] text-ink hover:text-accent transition-colors truncate">
          {c.title}
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-[10px] uppercase tracking-[0.06em] text-ink-3">
          {channelName && (
            <span className="inline-flex items-center gap-1.5">
              <span className="w-[7px] h-[7px] rounded-[2px] shrink-0" style={{ background: domainColor(channelName) }} aria-hidden />
              {channelName}
            </span>
          )}
          {withEditor
            ? <span>with editor <span className={ageClass(days)}>{days ?? 0}d</span></span>
            : days != null && <span>{days}d</span>}
          {/* Idea triage (Addendum 09) — Keep resets aging, Archive retires. */}
          {isIdea && (
            <>
              <IdeaBtn action={keepIdeaAction} id={c.id} label="Keep" />
              <IdeaBtn action={archiveIdeaAction} id={c.id} label="Archive" />
              {c.idea_reviewed_at && (
                <span className="text-ink-4">
                  kept {new Date(c.idea_reviewed_at).toLocaleDateString('en-US', { timeZone: tz, month: 'short', day: 'numeric' })}
                </span>
              )}
            </>
          )}
        </div>
      </div>

      <Pill state={urgency} />
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

function IdeaBtn({ action, id, label }: { action: (fd: FormData) => Promise<void>; id: string; label: string }) {
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <button type="submit" className="font-mono text-[10px] uppercase tracking-[0.06em] text-ink-3 hover:text-accent transition-colors">
        {label}
      </button>
    </form>
  );
}

function ClearBtn({ onClick, label = 'Clear' }: { onClick: () => void; label?: string }) {
  return (
    <button type="button" onClick={onClick} className="font-mono text-[9px] uppercase tracking-[0.09em] text-ink-3 hover:text-accent transition-colors">
      {label}
    </button>
  );
}
