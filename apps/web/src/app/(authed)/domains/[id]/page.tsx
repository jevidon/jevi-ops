import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Pill } from '@/components/Pill';
import {
  DetailHeader, CrumbDot, ActionButton, StatStrip, Stat, WorkCounts,
  DetailBody, DetailSection, RailBlock,
} from '@/components/detail/DetailShell';
import { EditDrawer } from '@/components/detail/EditDrawer';
import { domainsApi, tasksApi, workApi, ApiError, type WorkDomain } from '@/lib/api';
import type { Domain, Task } from '@jevi-ops/shared';
import { domainColor } from '@/lib/domain-colors';
import { EditDomainForm } from './edit-domain-form';
import { CadenceEditor } from './cadence-editor';
import { MarkShipped } from './mark-shipped';
import { IllustrationControls } from './illustration-controls';
import { ProjectQuickCreate } from './quick-create';
import { QuickAddTask } from '@/components/QuickAddTask';
import { DomainIllustration } from '../domain-illustration';
import { ProjectCard, ContentRow, FittedArt } from '../../work/cards';
import { PRIMARY_CADENCE_RULES, type CadenceRuleType } from './cadence-rules';
import { getAppTimezone } from '@/lib/app-settings';
import { todayIsoDate } from '@/lib/today';

// Pull the primary cadence rule (one of days_since_journal /
// days_since_publish / no_activity_days) out of failure_patterns so the
// editor opens with the current setting pre-selected.
function extractCadenceRule(patterns: unknown): { rule: CadenceRuleType; value: number | null } {
  if (!Array.isArray(patterns)) return { rule: 'none', value: null };
  for (const raw of patterns) {
    if (!raw || typeof raw !== 'object') continue;
    const p = raw as { rule?: string; value?: unknown };
    if (typeof p.rule === 'string' && PRIMARY_CADENCE_RULES.has(p.rule)) {
      const v = typeof p.value === 'number' ? p.value : null;
      return { rule: p.rule as CadenceRuleType, value: v };
    }
  }
  return { rule: 'none', value: null };
}

// Provenance line under an illustration panel: who drew it and when.
// Null = nothing stored yet, so headers show the name-seeded library motif.
function illustrationMeta(
  ill: { source: 'llm' | 'procedural'; generated_at: string } | null,
  tz: string,
): string {
  if (!ill) return 'library motif · not yet drawn';
  const when = new Date(ill.generated_at).toLocaleString('en-US', {
    timeZone: tz,
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
  return `${ill.source === 'llm' ? 'drawn by the model' : 'library motif'} · ${when}`;
}

function advancedPatterns(patterns: unknown): unknown[] {
  if (!Array.isArray(patterns)) return [];
  return patterns.filter((p) => {
    if (!p || typeof p !== 'object') return false;
    const rule = (p as { rule?: string }).rule;
    return typeof rule === 'string' && !PRIMARY_CADENCE_RULES.has(rule);
  });
}

const CADENCE_RULE_SHORT: Record<string, string> = {
  days_since_journal: 'days since journal',
  days_since_publish: 'days since publish',
  no_activity_days: 'days since activity',
};

// /domains/[id] — domain detail (Detail Pages v2 adoption, Aug 2026). Same
// anatomy as the project page: header band (surface bg, actions at right,
// config behind the Edit drawer) → computed stat strip → two-column read
// layout. The main column opens with the Work page's domain-section view —
// project cards + content rows off the same server-computed /work payload —
// then direct + project-grouped tasks.
//
// System domains (Inbox) render a streamlined triage-oriented view: no
// edit drawer (the API rejects identity changes on system domains anyway),
// no cadence/illustration config, no project creation.

export default async function DomainDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const tz = await getAppTimezone();
  const today = todayIsoDate(tz);

  let domain: Domain | null = null;
  let openTasks: Task[] = [];
  let waitingTasks: Task[] = [];
  let work: WorkDomain | null = null;
  let errorMessage: string | null = null;

  const [domainRes, tasksRes, waitingRes, workRes] = await Promise.allSettled([
    domainsApi.get(id),
    tasksApi.list({ domain_id: id, status: 'open' }),
    tasksApi.list({ domain_id: id, status: 'waiting' }),
    workApi.get(),
  ]);

  if (domainRes.status === 'fulfilled') {
    domain = domainRes.value;
  } else if (domainRes.reason instanceof ApiError && domainRes.reason.status === 404) {
    notFound();
  } else {
    const err = domainRes.reason;
    errorMessage = err instanceof ApiError ? `API ${err.status}` : (err as Error).message;
  }

  if (tasksRes.status === 'fulfilled') {
    openTasks = tasksRes.value.tasks;
  }
  if (waitingRes.status === 'fulfilled') {
    // Oldest block first — mirrors /tasks. Blocked-on-someone work parked
    // under the domain so it doesn't vanish while it's not "open".
    waitingTasks = [...waitingRes.value.tasks].sort((a, b) =>
      (a.waiting_since ?? a.created_at).localeCompare(b.waiting_since ?? b.created_at),
    );
  }
  if (workRes.status === 'fulfilled') {
    // The same server-computed section the Work page renders — cards, content
    // rows, rollup, urgency. Parked (inactive) domains live in the second list.
    work =
      workRes.value.domains.find((d) => d.id === id) ??
      workRes.value.parked.find((d) => d.id === id) ??
      null;
  }

  if (!domain) {
    return (
      <div className="px-5 lg:px-8 pt-8">
        <h1 className="font-serif text-[40px] font-medium tracking-[-0.022em] text-ink">—</h1>
        <p className="mt-4 font-sans text-[13px] text-ink-3">{errorMessage ?? 'Domain not found.'}</p>
      </div>
    );
  }

  // Split tasks into direct (no project) and project-grouped. The two
  // sections render with the same row shape — the only difference is the
  // group header above each subset.
  // Subtasks fold under their parent (fork): children whose parent is also
  // in this domain's open list stay off the flat rows — the parent carries a
  // "▸ n subtasks" chip and the children live on its detail page. Children
  // of an absent parent (done, other domain) stay visible.
  const kidCounts = new Map<string, number>();
  for (const t of [...openTasks, ...waitingTasks]) {
    if (!t.parent_task_id) continue;
    kidCounts.set(t.parent_task_id, (kidCounts.get(t.parent_task_id) ?? 0) + 1);
  }
  const openIds = new Set(openTasks.map((t) => t.id));
  const folded = (t: Task) => t.parent_task_id != null && openIds.has(t.parent_task_id);
  const badgeFor = (t: Task): string | null => {
    const n = kidCounts.get(t.id);
    return n ? `▸ ${n} subtask${n === 1 ? '' : 's'}` : null;
  };

  const directTasks = openTasks.filter((t) => !t.project_id && !folded(t));
  const projectTasks = openTasks.filter((t) => t.project_id && !folded(t));
  const projectGroups = new Map<string, { name: string; tasks: Task[] }>();
  for (const t of projectTasks) {
    const projectId = t.project_id!;
    const projectName = t.project?.name ?? '(unnamed project)';
    const existing = projectGroups.get(projectId);
    if (existing) existing.tasks.push(t);
    else projectGroups.set(projectId, { name: projectName, tasks: [t] });
  }
  const orderedProjectGroups = Array.from(projectGroups.entries())
    .map(([id, group]) => ({ id, ...group }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const isInbox = domain.is_system === true;
  const color = domainColor(domain.name);

  // Rollup + urgency from the work payload when the domain rides in it;
  // recomputed from the fetched tasks otherwise (Inbox, payload hiccup).
  const overdueCount = openTasks.filter((t) => t.due_date && t.due_date < today).length;
  const rollup = work?.rollup ?? {
    open: openTasks.length,
    overdue: overdueCount,
    waiting: waitingTasks.length,
    attention: 0,
  };
  const urgency = work?.urgency ?? (overdueCount > 0 ? 'over' : openTasks.length > 0 ? 'ok' : 'quiet');

  const cadence = extractCadenceRule(domain.failure_patterns);
  const advanced = advancedPatterns(domain.failure_patterns);

  const taskCount = (
    <>
      {openTasks.length} open
      {rollup.overdue > 0 && <span className="text-accent"> · {rollup.overdue} overdue</span>}
      {waitingTasks.length > 0 && <span> · {waitingTasks.length} waiting</span>}
    </>
  );

  return (
    <div>
      <DetailHeader
        crumb={
          <>
            <Link href="/work" className="hover:text-ink-2 transition-colors">{isInbox ? 'Inbox' : 'Domain'}</Link>
            {!isInbox && !domain.active && (<><CrumbDot /><span>Inactive</span></>)}
          </>
        }
        name={domain.name}
        color={color}
        art={!isInbox && (
          <FittedArt
            name={domain.name}
            svg={domain.illustration?.svg}
            tone={urgency === 'over' ? 'accent' : 'ink'}
          />
        )}
        state={<Pill state={urgency} />}
        actions={
          isInbox ? (
            openTasks.length > 0
              ? <ActionButton href="/today#inbox-triage">Triage all →</ActionButton>
              : undefined
          ) : (
            <>
              <ActionButton href={`/projects/new?domain_id=${domain.id}`}>＋ Project</ActionButton>
              <ActionButton href={`/tasks/new?domain_id=${domain.id}&from=/domains/${domain.id}`}>＋ Task</ActionButton>
              <EditDrawer title="Edit domain">
                <DomainDrawerBody domain={domain} cadence={cadence} advanced={advanced} tz={tz} />
              </EditDrawer>
            </>
          )
        }
      />

      <StatStrip>
        <Stat label="Work">
          <WorkCounts open={rollup.open} overdue={rollup.overdue} waiting={rollup.waiting} />
        </Stat>
        {isInbox ? (
          <Stat label="Triage" value={openTasks.length} unit={openTasks.length === 1 ? 'task' : 'tasks'} sub="awaiting a home" />
        ) : (
          <Stat
            label="Projects"
            value={work ? work.projects.length : '—'}
            sub={work && work.content.length > 0 ? `${work.content.length} content in motion` : undefined}
          />
        )}
        <Stat
          label="Cadence"
          value={isInbox ? '—' : cadence.rule !== 'none' && cadence.value != null ? cadence.value : '—'}
          unit={cadence.rule !== 'none' && cadence.value != null ? CADENCE_RULE_SHORT[cadence.rule] : undefined}
          sub={isInbox ? 'exempt from observations' : cadence.rule === 'none' ? 'no cadence rule' : undefined}
        />
        <Stat
          label="Attention"
          value={rollup.attention}
          tone={rollup.attention > 0 ? 'accent' : undefined}
          sub={rollup.attention > 0 ? 'active flags' : 'nothing flagged'}
        />
      </StatStrip>

      <DetailBody
        main={
          <>
            {isInbox ? (
              <div className="border border-line bg-surface p-4 mb-8">
                <p className="font-sans text-[13px] text-ink-2 leading-relaxed">
                  Tasks here are waiting for a home. Move them to a domain or project
                  when you triage — frictionless capture in, intentional placement
                  out. Inbox is exempt from slippage detection, so tasks won&rsquo;t
                  be flagged for sitting here.
                </p>
              </div>
            ) : (
              <DetailSection
                label="Projects & content"
                count={work ? work.projects.length + work.content.length : undefined}
                className="mt-0"
              >
                {work && work.projects.length > 0 && (
                  <div
                    className="grid gap-3.5 mb-3"
                    style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(258px, 1fr))' }}
                  >
                    {work.projects.map((p) => <ProjectCard key={p.id} p={p} color={color} />)}
                  </div>
                )}
                {work && work.content.length > 0 && (
                  <div className="border border-line rounded mb-3">
                    {work.content.map((c) => <ContentRow key={c.id} c={c} color={color} />)}
                  </div>
                )}
                {(!work || (work.projects.length === 0 && work.content.length === 0)) && (
                  <p className="font-sans text-[13px] text-ink-3 italic py-1 mb-3">
                    {work ? 'No projects or content in motion.' : 'Work rollup unavailable.'}
                  </p>
                )}
                {/* Quick create — name + kind straight into this domain; the
                    action redirects to the new project's page. */}
                <div className="mt-4 pt-3 border-t border-line/40 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex-1 min-w-[240px]">
                    <ProjectQuickCreate domainId={domain.id} />
                  </div>
                  <Link
                    href={`/projects/new?domain_id=${domain.id}`}
                    className="font-mono text-[10px] uppercase tracking-wider text-accent hover:text-ink transition-colors shrink-0"
                  >
                    Full editor →
                  </Link>
                </div>
              </DetailSection>
            )}

            <DetailSection
              label="Tasks"
              count={taskCount}
              className={isInbox ? 'mt-0' : ''}
              action={
                !isInbox ? (
                  <Link
                    href={`/tasks/new?domain_id=${domain.id}&from=/domains/${domain.id}`}
                    className="font-mono text-[10px] uppercase tracking-wider text-accent hover:text-ink transition-colors shrink-0"
                  >
                    Full editor →
                  </Link>
                ) : undefined
              }
            >
              {/* Title-only quick capture straight into this domain; due
                  dates, priority, and project routing live in the full
                  editor linked above. */}
              {!isInbox && (
                <div className="mb-4">
                  <QuickAddTask domainId={domain.id} placeholder="Add a task to this domain…" />
                </div>
              )}
              {openTasks.length === 0 ? (
                <p className="font-sans text-[13px] text-ink-3 italic py-1">No open tasks here.</p>
              ) : (
                <>
                  {directTasks.length > 0 && (
                    <div className="mb-6">
                      <div className="font-mono text-[10px] uppercase tracking-wider text-ink-3 mb-2">
                        Direct tasks · {directTasks.length}
                      </div>
                      <ul className="border-t border-line/40">
                        {directTasks.map((t) => (
                          <TaskRow key={t.id} task={t} tz={tz} today={today} badge={badgeFor(t)} />
                        ))}
                      </ul>
                    </div>
                  )}

                  {orderedProjectGroups.map((group) => (
                    <div key={group.id} className="mb-6">
                      <Link
                        href={`/projects/${group.id}`}
                        className="font-mono text-[10px] uppercase tracking-wider text-ink-3 hover:text-ink mb-2 inline-block"
                      >
                        {group.name} · {group.tasks.length}
                      </Link>
                      <ul className="border-t border-line/40">
                        {group.tasks.map((t) => (
                          <TaskRow key={t.id} task={t} tz={tz} today={today} badge={badgeFor(t)} />
                        ))}
                      </ul>
                    </div>
                  ))}
                </>
              )}

              {/* Waiting on someone else (Addendum 08). */}
              {waitingTasks.length > 0 && (
                <div className="mt-8">
                  <div className="font-mono text-[10px] uppercase tracking-wider text-ink-3 mb-2">
                    Waiting · {waitingTasks.length}
                  </div>
                  <ul className="border-t border-line/40">
                    {waitingTasks.map((t) => (
                      <TaskRow key={t.id} task={t} tz={tz} today={today} badge={badgeFor(t)} />
                    ))}
                  </ul>
                </div>
              )}
            </DetailSection>
          </>
        }
        rail={
          <>
            {(domain.description || domain.fruit_definition) && (
              <RailBlock label="About">
                {domain.description && (
                  <p className="font-sans text-[13px] text-ink-2 leading-relaxed">{domain.description}</p>
                )}
                {domain.fruit_definition && (
                  <div className={domain.description ? 'mt-3' : ''}>
                    <div className="font-mono text-[9px] uppercase tracking-[0.08em] text-ink-4 mb-1">Fruit</div>
                    <p className="font-sans text-[13px] text-ink-2 leading-relaxed">{domain.fruit_definition}</p>
                  </div>
                )}
              </RailBlock>
            )}
            <RailBlock label="Details">
              <KV k="Status" v={isInbox ? 'System' : domain.active ? 'Active' : 'Inactive'} />
              {!isInbox && (
                <KV
                  k="Cadence"
                  v={cadence.rule !== 'none' && cadence.value != null
                    ? `${cadence.value} ${CADENCE_RULE_SHORT[cadence.rule] ?? cadence.rule}`
                    : 'No rule'}
                />
              )}
              {!isInbox && (
                <KV k="Stale flag" v={domain.stale_enabled === false ? 'Off' : `${domain.stale_days ?? 21}d`} />
              )}
              {domain.last_shipped_at && (
                <KV k="Last shipped" v={fmtShort(domain.last_shipped_at, tz)} />
              )}
            </RailBlock>
          </>
        }
      />
    </div>
  );
}

// Everything configurable about the domain, relocated off the read surface
// into the header's Edit drawer: identity form, cadence rule, illustration
// management, and the read-only advanced patterns.
function DomainDrawerBody({
  domain,
  cadence,
  advanced,
  tz,
}: {
  domain: Domain;
  cadence: { rule: CadenceRuleType; value: number | null };
  advanced: unknown[];
  tz: string;
}) {
  return (
    <div>
      <EditDomainForm
        initial={{
          id: domain.id,
          name: domain.name,
          description: domain.description ?? '',
          fruit_definition: domain.fruit_definition ?? '',
          active: domain.active,
          stale_enabled: domain.stale_enabled ?? true,
          stale_days: domain.stale_days ?? null,
          cadence_tracked: cadence.rule !== 'none',
        }}
      />

      {/* Cadence rule. The briefing's "In brief" only reads `days_since_*`
          and `no_activity_days` rules; this editor owns that one entry.
          Advanced rule types still live in failure_patterns but get edited
          via SQL — the action preserves them across saves. */}
      <div className="mt-8 pt-6 border-t border-line">
        <div className="eyebrow mb-3">Cadence rule</div>
        <CadenceEditor
          domainId={domain.id}
          currentRule={cadence.rule}
          currentValue={cadence.value}
        />
        {/* Mark-shipped button — only useful for days_since_publish rules.
            For days_since_journal we read from journal_entries directly;
            for no_activity_days we read activity_log. */}
        {cadence.rule === 'days_since_publish' && (
          <div className="mt-5 pt-5 border-t border-line/40">
            <div className="eyebrow mb-2">Off-dashboard publishes</div>
            <p className="font-sans text-[12px] text-ink-3 mb-3 leading-relaxed">
              If you publish for this domain outside the dashboard (Substack,
              social, etc.) and don&rsquo;t plan to log every piece as a
              content item, tap below to record the publish manually. The
              cadence reads whichever&rsquo;s more recent.
            </p>
            <MarkShipped
              domainId={domain.id}
              lastShippedAt={domain.last_shipped_at ?? null}
              tz={tz}
            />
          </div>
        )}
      </div>

      {/* Domain illustration — drawing a candidate never overwrites the
          saved art: the render lands in illustration_draft (migration 0033)
          and appears here as Candidate until it's kept or discarded. */}
      <div className="mt-8 pt-6 border-t border-line">
        <div className="eyebrow mb-3">Domain illustration</div>
        <div className="flex flex-wrap gap-5 mb-3">
          <figure className="m-0">
            <div className="font-mono text-[9px] uppercase tracking-[0.06em] text-ink-3 mb-1.5">
              Current
            </div>
            <div className="border border-line w-[260px] max-w-full">
              <div className="h-[96px] overflow-hidden">
                <DomainIllustration name={domain.name} svg={domain.illustration?.svg} />
              </div>
            </div>
            <figcaption className="mt-1.5 font-mono text-[9px] uppercase tracking-[0.06em] text-ink-4">
              {illustrationMeta(domain.illustration ?? null, tz)}
            </figcaption>
          </figure>
          {domain.illustration_draft && (
            <figure className="m-0">
              <div className="font-mono text-[9px] uppercase tracking-[0.06em] text-accent mb-1.5">
                Candidate
              </div>
              <div className="border border-accent/40 w-[260px] max-w-full">
                <div className="h-[96px] overflow-hidden">
                  <DomainIllustration name={domain.name} svg={domain.illustration_draft.svg} />
                </div>
              </div>
              <figcaption className="mt-1.5 font-mono text-[9px] uppercase tracking-[0.06em] text-ink-4">
                {illustrationMeta(domain.illustration_draft, tz)}
              </figcaption>
            </figure>
          )}
        </div>
        <p className="font-sans text-[12px] text-ink-3 mb-3 leading-relaxed">
          Shown as header art here and on the Work page. Drawing a candidate
          asks the model for a fresh engraving (the built-in library stands in
          if the model isn&rsquo;t reachable) — the current art stays until
          you keep the candidate.
        </p>
        <IllustrationControls
          domainId={domain.id}
          hasDraft={Boolean(domain.illustration_draft)}
        />
      </div>

      {/* Advanced failure patterns — read-only view of the non-cadence rules
          still managed via SQL, so what's set stays visible. */}
      {advanced.length > 0 && (
        <div className="mt-8 pt-6 border-t border-line">
          <div className="eyebrow mb-3">Advanced patterns (read-only)</div>
          <p className="font-sans text-[12px] text-ink-3 mb-3 leading-relaxed">
            Advanced rule types (deadline windows, hours-over-quote,
            shoot-checklist windows, etc.) take more parameters than the
            cadence editor handles. Edit via SQL for now.
          </p>
          <pre className="font-mono text-[11px] text-ink-2 bg-surface border border-line p-3 overflow-auto">
            {JSON.stringify(advanced, null, 2)}
          </pre>
        </div>
      )}
    </div>
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

function fmtShort(iso: string, tz: string): string {
  const d = iso.length === 10 ? new Date(`${iso}T12:00:00Z`) : new Date(iso);
  return d.toLocaleDateString('en-US', { timeZone: tz, month: 'short', day: 'numeric' });
}

function TaskRow({ task, tz, today, badge }: { task: Task; tz: string; today: string; badge?: string | null }) {
  const isWaiting = task.status === 'waiting';
  const waitDays = isWaiting && task.waiting_since
    ? Math.max(0, Math.round((Date.parse(today) - Date.parse(task.waiting_since)) / 86_400_000))
    : null;
  const waitStale = waitDays != null && waitDays >= 7;
  return (
    <li className="py-2 border-b border-line/40">
      <Link
        href={`/tasks/${task.id}`}
        className="flex items-baseline justify-between gap-3 hover:opacity-80 transition-opacity"
      >
        <span className={`font-sans text-[14px] truncate ${isWaiting ? 'text-ink-2' : 'text-ink'}`}>
          {task.title}
          {badge && (
            <span className="ml-2.5 font-mono text-[10px] tracking-wider text-ink-3 bg-surface-2 px-1.5 py-0.5">{badge}</span>
          )}
        </span>
        {isWaiting ? (
          <span
            className={`font-mono text-[10px] uppercase tracking-wider shrink-0 ${
              waitStale ? 'text-accent' : 'text-ink-3'
            }`}
          >
            ⏸{task.waiting_on ? ` ${task.waiting_on}` : ''}
            {waitDays != null ? ` · ${waitDays}d` : ''}
          </span>
        ) : (
          task.due_date && (
            <span className="font-mono text-[10px] uppercase tracking-wider text-ink-3 shrink-0">
              {new Date(task.due_date + 'T12:00:00Z').toLocaleDateString('en-US', {
                timeZone: tz,
                month: 'short',
                day: 'numeric',
              })}
            </span>
          )
        )}
      </Link>
    </li>
  );
}
