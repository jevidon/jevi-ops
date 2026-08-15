import { Fragment } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Pill } from '@/components/Pill';
import {
  DetailHeader, CrumbDot, ActionButton, StatStrip, Stat, DetailBody, DetailSection, RailBlock,
} from '@/components/detail/DetailShell';
import { EditDrawer } from '@/components/detail/EditDrawer';
import { contentApi, domainsApi, tasksApi, ApiError, type ContentItem, type ContentItemStatus } from '@/lib/api';
import { contentUrgency, moveVerb, type Urgency } from '@jerad-ops/shared';
import type { Task } from '@jerad-ops/shared';
import { getAppTimezone } from '@/lib/app-settings';
import { todayIsoDate } from '@/lib/today';
import { ContentForm } from '../content-form';
import { ChecklistSection } from '../checklist-section';
import { advanceStatusAction, flipHolderAction } from '../actions';
import { youtubeEmbedUrl } from '@/lib/youtube';

// /content/[id] — content detail (Detail Pages v2, Addendum 10 §7). The page's
// job is ONE verb: the computed my-move primary button. Header carries the
// pipeline (computed, not draggable) + holder/days line; config lives behind
// Edit. Course = one container — its curriculum is the checklist.

const PIPE = ['idea', 'outline', 'filming', 'editing', 'derivatives_pending'] as const;
const PIPE_LABEL: Record<string, string> = { idea: 'Idea', outline: 'Outline', filming: 'Filming', editing: 'Editing', derivatives_pending: 'Derivatives' };
const NEXT: Record<string, ContentItemStatus | null> = {
  idea: 'outline', outline: 'filming', filming: 'editing', editing: 'published', published: null, derivatives_pending: 'done', done: null,
};
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export default async function ContentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tz = await getAppTimezone();
  const today = todayIsoDate(tz);

  let item: ContentItem | null = null;
  let domains: { id: string; name: string }[] = [];
  let linkedTasks: Task[] = [];
  let allItems: ContentItem[] = [];
  let errorMessage: string | null = null;

  try {
    const [itemRes, domainsRes, tasksRes, listRes] = await Promise.all([
      contentApi.get(id),
      domainsApi.list(),
      tasksApi.list({ content_item_id: id }),
      contentApi.list().catch(() => ({ items: [] as ContentItem[] })),
    ]);
    item = itemRes;
    domains = domainsRes.domains.map((d) => ({ id: d.id, name: d.name }));
    linkedTasks = tasksRes.tasks;
    allItems = listRes.items;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    errorMessage = err instanceof ApiError ? `API ${err.status}` : (err as Error).message;
  }

  if (!item) {
    return (
      <div className="px-5 lg:px-8 pt-8">
        <h1 className="font-serif text-[40px] font-medium tracking-[-0.022em] text-ink">—</h1>
        <p className="mt-4 font-sans text-[13px] text-ink-3">{errorMessage ?? 'Content item not found.'}</p>
      </div>
    );
  }

  const holder: 'me' | 'editor' = item.holder === 'editor' ? 'editor' : 'me';
  const isCourse = item.type === 'course';
  // Published/done is terminal: it publishes AFTER its target, so a past target
  // is expected, not a miss — never let it read "over"/"Target passed".
  const isDone = item.status === 'published' || item.status === 'done';
  const daysInStatus = item.holder_since ? daysAgo(item.holder_since, tz, today) : null;
  const target = item.target_publish_date ?? null;
  const targetPassed = !isDone && target != null && target < today;
  const checklist = item.checklist ?? [];
  const ckDone = checklist.filter((c) => c.done).length;
  const openTasks = linkedTasks.filter((t) => t.status === 'open').length;
  const children = allItems.filter((c) => c.parent_id === item!.id);
  const unpublishedShorts = children.filter((c) => c.type === 'short_clip' && c.status !== 'published' && c.status !== 'done').length;

  const plus7 = addDaysYmd(today, 7);
  const myMoveDue = !isDone && holder === 'me' && target != null && target <= plus7;
  const urg: Urgency = isDone ? 'quiet' : contentUrgency({ holder, target, myMoveDue, days: daysInStatus, today });

  // Target-tile sub copy: past reads "ago" (neutral) unless it's an unmet target
  // (then "passed", accent); future reads "out"; today reads "today".
  const tDays = target ? daysAgo(`${target}T12:00:00Z`, tz, today) : 0; // >0 past · <0 future
  const targetSub = target == null ? 'no target set'
    : targetPassed ? `passed ${tDays}d`
    : tDays === 0 ? 'today'
    : tDays > 0 ? `${tDays}d ago`
    : `${Math.abs(tDays)}d out`;

  // Header state chip — descriptive, computed.
  const chipLabel = isDone ? cap(item.status)
    : targetPassed ? 'Target passed'
    : holder === 'editor' ? `With editor${daysInStatus != null ? ` · ${daysInStatus}d` : ''}`
    : myMoveDue ? 'My move'
    : 'On track';

  // The one primary button — the computed my-move verb.
  let primary: React.ReactNode = null;
  if (holder === 'editor') {
    primary = (
      <form action={flipHolderAction.bind(null, item.id, 'me')}>
        <PrimaryButton>Rough cut is back</PrimaryButton>
      </form>
    );
  } else {
    const verb = moveVerb(item.status, item.type, unpublishedShorts) ?? (item.status === 'idea' ? 'outline it' : null);
    const next = NEXT[item.status];
    if (verb && next) {
      primary = (
        <form action={advanceStatusAction}>
          <input type="hidden" name="id" value={item.id} />
          <input type="hidden" name="next" value={next} />
          <PrimaryButton>{cap(verb)} →</PrimaryButton>
        </form>
      );
    }
  }

  const publishedDate = item.published_at ? item.published_at.slice(0, 10) : '';

  return (
    <div>
      <DetailHeader
        titleClass="text-[32px]"
        crumb={
          <>
            <Link href="/content" className="hover:text-ink-2 transition-colors">Content</Link>
            <CrumbDot /><span>{item.type.replace('_', ' ')}</span>
            {item.domain?.name && (<><CrumbDot /><span>{item.domain.name}</span></>)}
          </>
        }
        name={item.title}
        state={<Pill state={urg}>{chipLabel}</Pill>}
        actions={
          <>
            {primary}
            <ActionButton href={`/tasks/new?content_item_id=${item.id}`}>＋ Task</ActionButton>
            <EditDrawer title="Edit content">
              <ContentForm
                domains={domains}
                initial={{
                  id: item.id, title: item.title, domain_id: item.domain_id ?? '', type: item.type,
                  status: item.status, outline_md: item.outline_md ?? '', video_url: item.video_url ?? '',
                  article_url: item.article_url ?? '', canonical_url: item.canonical_url ?? '',
                  body_rich: item.body_rich ?? '', published_at: publishedDate, produced_on: item.produced_on ?? '',
                  target_publish_date: item.target_publish_date ?? '', platforms: item.platforms ?? [], meta: item.meta ?? {},
                }}
              />
            </EditDrawer>
          </>
        }
        below={<Pipeline status={item.status} holder={holder} days={daysInStatus} />}
      />

      <StatStrip>
        <Stat label="Days in status" value={daysInStatus ?? '—'} unit={daysInStatus != null ? (daysInStatus === 1 ? 'day' : 'days') : undefined} sub={holder === 'editor' ? 'with editor' : 'with me'} />
        {target ? (
          <Stat label="Target publish" value={fmtShort(target, tz)} tone={targetPassed ? 'accent' : undefined} sub={targetSub} />
        ) : (
          <Stat label="Target publish" value="—" sub="no target set" />
        )}
        <Stat label={isCourse ? 'Curriculum' : 'Checklist'} value={checklist.length ? `${ckDone}/${checklist.length}` : '—'} sub={checklist.length ? (ckDone === checklist.length ? 'complete' : 'in progress') : 'none yet'} />
        <Stat label="Linked tasks" value={openTasks} unit="open" sub={`${linkedTasks.length} linked`} />
      </StatStrip>

      <DetailBody
        main={
          <>
            {item.video_url && youtubeEmbedUrl(item.video_url) && (
              <div className="mb-1 aspect-video bg-surface-2 border border-line rounded overflow-hidden">
                {/* eslint-disable-next-line jsx-a11y/iframe-has-title */}
                <iframe src={youtubeEmbedUrl(item.video_url)!} title={item.title} className="w-full h-full"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowFullScreen />
              </div>
            )}

            <ChecklistSection contentId={item.id} items={checklist} />

            <DetailSection
              label="Linked tasks"
              count={linkedTasks.length > 0 ? `${openTasks} open` : undefined}
              action={<Link href={`/tasks/new?content_item_id=${item.id}`} className="font-mono text-[10px] uppercase tracking-wider text-ink-3 hover:text-accent transition-colors">＋ Add task</Link>}
            >
              {linkedTasks.length === 0 ? (
                <p className="font-sans text-[13px] text-ink-3 italic py-1">No tasks linked to this content.</p>
              ) : (
                <ul>
                  {linkedTasks.map((t) => (
                    <li key={t.id} className="flex items-baseline gap-3 py-2 border-b border-line/50">
                      <span className={`font-mono text-[9px] uppercase tracking-wider w-11 shrink-0 ${t.status === 'done' ? 'text-ink-4' : t.due_date && t.due_date < today ? 'text-accent' : 'text-ink-3'}`}>{t.status === 'done' ? '✓ done' : 'open'}</span>
                      <Link href={`/tasks/${t.id}`} className={`flex-1 font-sans text-[14px] hover:text-accent transition-colors ${t.status === 'done' ? 'text-ink-3 line-through' : 'text-ink'}`}>{t.title}</Link>
                      {t.due_date && <span className="font-mono text-[10px] text-ink-4 shrink-0">{t.due_date}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </DetailSection>

            {children.length > 0 && (
              <DetailSection label="Derivatives" count={children.length}>
                <ul>
                  {children.map((c) => (
                    <li key={c.id} className="flex items-baseline gap-3 py-2 border-b border-line/50">
                      <span className="font-mono text-[9px] uppercase tracking-wider text-ink-4 w-16 shrink-0">{c.type.replace('_', ' ')}</span>
                      <Link href={`/content/${c.id}`} className="flex-1 font-sans text-[14px] text-ink hover:text-accent transition-colors truncate">{c.title}</Link>
                      <span className="font-mono text-[9px] uppercase tracking-wider text-ink-3 shrink-0">{c.status.replace('_', ' ')}</span>
                    </li>
                  ))}
                </ul>
              </DetailSection>
            )}
          </>
        }
        rail={
          <>
            <RailBlock label="Dates">
              {item.produced_on && <KV k={isCourse ? 'Started' : 'Produced'} v={fmtShort(item.produced_on, tz)} />}
              <KV k="Target" v={target ? fmtShort(target, tz) : '—'} tone={targetPassed ? 'accent' : undefined} />
              <KV k="Published" v={item.published_at ? fmtShort(item.published_at.slice(0, 10), tz) : '—'} />
            </RailBlock>

            <RailBlock label="Holder">
              <form action={holder === 'me' ? flipHolderAction.bind(null, item.id, 'editor') : flipHolderAction.bind(null, item.id, 'me')}>
                <div className="flex items-center justify-between gap-3">
                  <span className="font-sans text-[13.5px] text-ink">{holder === 'me' ? 'With me' : 'With editor'}{daysInStatus != null ? ` · ${daysInStatus}d` : ''}</span>
                  <button type="submit" className="font-mono text-[9px] uppercase tracking-[0.07em] text-ink-3 border border-line-strong rounded px-2.5 py-1.5 hover:border-ink-3 hover:text-ink transition-colors whitespace-nowrap">
                    {holder === 'me' ? 'Hand to editor' : 'Take it back'}
                  </button>
                </div>
              </form>
            </RailBlock>

            {item.canonical_url && (
              <RailBlock label="Links">
                <a href={item.canonical_url} target="_blank" rel="noopener noreferrer" className="font-sans text-[13.5px] text-ink hover:text-accent transition-colors break-all">
                  {isCourse ? 'Course home ↗' : 'Canonical ↗'}
                </a>
              </RailBlock>
            )}
          </>
        }
      />
    </div>
  );
}

function PrimaryButton({ children }: { children: React.ReactNode }) {
  return (
    <button type="submit" className="inline-flex items-center gap-1.5 h-[34px] px-4 rounded border border-accent bg-accent text-bg font-mono text-[10px] font-semibold uppercase tracking-[0.07em] hover:bg-accent-ink transition-colors shrink-0">
      {children}
    </button>
  );
}

function KV({ k, v, tone }: { k: string; v: string; tone?: 'accent' }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="font-mono text-[10px] uppercase tracking-[0.04em] text-ink-3">{k}</span>
      <span className={`font-sans text-[13.5px] ${tone === 'accent' ? 'text-accent' : 'text-ink'}`}>{v}</span>
    </div>
  );
}

// Computed pipeline (idea → outline → filming → editing → derivatives). Current
// stage from status; published/done reads all-done with a terminal marker.
function Pipeline({ status, holder, days }: { status: string; holder: 'me' | 'editor'; days: number | null }) {
  const isPost = status === 'published' || status === 'done';
  const curIdx = PIPE.indexOf(status as (typeof PIPE)[number]);
  return (
    <div className="mt-3.5">
      <div className="flex items-center flex-wrap gap-y-2">
        {PIPE.map((s, i) => {
          const st = isPost || (curIdx >= 0 && i < curIdx) ? 'done' : i === curIdx ? 'cur' : 'future';
          return (
            <Fragment key={s}>
              {i > 0 && <span className="w-5 h-px bg-line-strong mx-1.5" aria-hidden />}
              <span className="flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full ${st === 'cur' ? 'bg-accent ring-[3px] ring-accent-soft' : st === 'done' ? 'bg-ink-3' : 'bg-line-strongest'}`} />
                <span className={`font-mono text-[9px] uppercase tracking-[0.05em] ${st === 'cur' ? 'text-accent font-semibold' : st === 'done' ? 'text-ink-3' : 'text-ink-4'}`}>{PIPE_LABEL[s]}</span>
              </span>
            </Fragment>
          );
        })}
        {isPost && <span className="ml-3 font-mono text-[9px] uppercase tracking-[0.06em] text-good">✓ {status}</span>}
      </div>
      {!isPost && (
        <div className="mt-2.5 font-mono text-[10px] tracking-[0.02em] text-ink-3">
          {cap(status.replace('_', ' '))} · {holder === 'editor' ? 'with editor' : 'with me'}{days != null ? ` · ${days}d` : ''}
        </div>
      )}
    </div>
  );
}

// ─── helpers (app-tz) ────────────────────────────────────────────────────────
function fmtShort(iso: string, tz: string): string {
  const d = iso.length === 10 ? new Date(`${iso}T12:00:00Z`) : new Date(iso);
  return d.toLocaleDateString('en-US', { timeZone: tz, month: 'short', day: 'numeric' });
}
function daysAgo(iso: string, tz: string, todayYmd: string): number {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
  return Math.round((Date.parse(`${todayYmd}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / 86_400_000);
}
function addDaysYmd(ymd: string, n: number): string {
  return new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}
