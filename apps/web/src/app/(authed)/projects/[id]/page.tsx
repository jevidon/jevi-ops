import { WorkflowSettings } from '@/components/task-workflows/WorkflowSettings';
import { SaveTaskTemplate } from './save-task-template';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SetCrumbs } from '@/components/crumbs/crumbs';
import { TaskItem } from '@/components/TaskItem';
import { Pill } from '@/components/Pill';
import {
  DetailHeader, CrumbDot, ActionButton, StatStrip, Stat, WorkCounts,
  SplitStatBand, LedgerRow, DetailBody, DetailSection, RailBlock,
} from '@/components/detail/DetailShell';
import { EditDrawer } from '@/components/detail/EditDrawer';
import { PinButton } from '@/components/PinButton';
import { projectsApi, domainsApi, peopleApi, ApiError, type ProjectDetail } from '@/lib/api';
import { isToday, todayIsoDate } from '@/lib/today';
import { getAppTimezone } from '@/lib/app-settings';
import { ProjectTasksProvider, ProjectTaskList, ProjectCompletedTasks } from './project-tasks';
import { ProjectForm } from '../project-form';
import { MilestonesSection } from './milestones-section';
import { ChecklistSection } from './checklist-section';
import { LogTimeForm } from './log-time-form';
import { ActivityRow } from './activity-row';
import { ContactsSection } from './contacts-section';
import { ConversationTimeline } from '@/components/conversations/ConversationTimeline';
import { LogConversationForm } from '@/components/conversations/LogConversationForm';
import { QuickAddTask } from '@/components/QuickAddTask';
import { DocPanel } from '@/components/doc/DocPanel';
import { ActionForm } from '../../maintenance/action-form';
import { promoteIdeaAction } from '../actions';

// /projects/[id] — project detail (Detail Pages v2, Addendum 10 §6). Per-item
// dashboard: header band + action buttons, a computed stat strip, a two-column
// read layout (living material left, stable material right), and the config
// relocated into the Edit drawer. Retainer and target-date variants differ only
// in the stat strip and whether milestones show.

const STATUS_LABELS: Record<string, string> = { idea: 'Idea', active: 'Active', paused: 'Paused', done: 'Done', archived: 'Archived' };

export default async function ProjectDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ group?: string }>;
}) {
  const { id } = await params;
  const { group: groupParam } = await searchParams;
  const tz = await getAppTimezone();
  const today = todayIsoDate(tz);

  let detail: ProjectDetail | null = null;
  let domains: { id: string; name: string }[] = [];
  let people: { id: string; name: string; role_at_company: string | null }[] = [];
  let errorMessage: string | null = null;

  try {
    const [detailRes, domainsRes, peopleRes] = await Promise.all([
      projectsApi.get(id),
      domainsApi.list(),
      peopleApi.list().catch(() => ({ people: [] })),
    ]);
    detail = detailRes;
    domains = domainsRes.domains.map((d) => ({ id: d.id, name: d.name }));
    people = peopleRes.people.map((p) => ({ id: p.id, name: p.name, role_at_company: p.role_at_company }));
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    errorMessage = err instanceof ApiError ? `API ${err.status}` : (err as Error).message;
  }

  if (!detail) {
    return (
      <div className="px-5 lg:px-8 pt-8">
        <h1 className="font-serif text-[40px] font-medium tracking-[-0.022em] text-ink">—</h1>
        <p className="mt-4 font-sans text-[13px] text-ink-3">{errorMessage ?? 'Project not found.'}</p>
      </div>
    );
  }

  const { project, milestones, tasks, activity, checklist } = detail;
  const isArea = project.kind === 'area';
  const isRetainer = !isArea && project.engagement_type === 'retainer';
  const openTasks = tasks.filter((t) => t.status === 'open');
  const waitingTasks = tasks.filter((t) => t.status === 'waiting');
  const doneTasks = tasks
    .filter((t) => t.status === 'done')
    .sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? ''));
  const doneToday = doneTasks.filter((t) => isToday(tz, t.completed_at ?? null));

  const overdueCount = openTasks.filter((t) => t.due_date && t.due_date < today).length;
  const dueTodayCount = openTasks.filter((t) => t.due_date === today).length;

  const defaultMode: 'milestone' | 'due' = !isRetainer && !isArea && milestones.length > 0 ? 'milestone' : 'due';
  const groupMode: 'milestone' | 'due' =
    groupParam === 'milestone' ? 'milestone' : groupParam === 'due' ? 'due' : defaultMode;

  const hoursLogged = Number(project.hours_logged ?? 0);
  const quoted = project.quoted_hours != null ? Number(project.quoted_hours) : null;
  const hoursThisMonth = Number(detail.hours_this_month ?? 0);
  const hoursLastMonth = Number(detail.hours_last_month ?? 0);

  // Milestone-weighted progress (target-date projects).
  const totalWeight = milestones.reduce((s, m) => s + (m.weight ?? 0), 0);
  const doneWeight = milestones.filter((m) => m.status === 'done').reduce((s, m) => s + (m.weight ?? 0), 0);
  const pct = totalWeight > 0 ? Math.round((doneWeight / totalWeight) * 100) : null;

  const cycle = isRetainer && project.retainer_anchor_day != null
    ? retainerCycle(project.retainer_anchor_day, today)
    : null;

  const lastActivityDays = activity[0]?.logged_at ? daysAgoFrom(activity[0].logged_at, tz, today) : null;
  const activityStale = isRetainer && lastActivityDays != null && lastActivityDays >= (cycle?.length ?? 30);

  // Header state chip — computed, in the Work vocabulary.
  const state: { s: 'over' | 'due' | 'ok' | 'quiet'; label: string } =
    overdueCount > 0 ? { s: 'over', label: `${overdueCount} overdue` }
    : waitingTasks.length > 0 ? { s: 'due', label: `${waitingTasks.length} waiting` }
    : dueTodayCount > 0 ? { s: 'due', label: 'Due today' }
    : { s: 'quiet', label: 'Quiet' };

  return (
    <div>
      {/* Ancestors only — the header band below names the project itself.
          Work grouped under an asset (0049) trails Domain / Asset. */}
      <SetCrumbs
        trail={[
          ...(project.domain ? [{ label: project.domain.name, href: `/domains/${project.domain.id}` }] : []),
          ...(project.asset ? [{ label: project.asset.name, href: `/assets/${project.asset.id}` }] : []),
        ]}
      />
      <DetailHeader
        crumb={
          <>
            {/* Type label only — the domain already rides in the header
                trail (Topbar / MobileCrumbs), so repeating it here is noise.
                "Project"/"Area" stays: it names what kind of artifact this is. */}
            <Link href="/work" className="hover:text-ink-2 transition-colors">{isArea ? 'Area' : 'Project'}</Link>
            {isRetainer && (<><CrumbDot /><span>Retainer</span></>)}
            {project.status !== 'active' && (<><CrumbDot /><span>{STATUS_LABELS[project.status]}</span></>)}
          </>
        }
        name={project.name}
        color={project.color}
        state={<Pill state={state.s}>{state.label}</Pill>}
        actions={
          <>
            <PinButton targetType="project" targetId={project.id} path={`/projects/${project.id}`} />
            {project.status === 'idea' && (
              <ActionForm
                action={promoteIdeaAction}
                hidden={{ id: project.id, asset_id: project.asset?.id ?? '' }}
                submit="Promote to project"
                variant="ghost"
                pendingLabel="Promoting…"
              />
            )}
            <ActionButton href={`/tasks/new?project_id=${project.id}&from=/projects/${project.id}`}>＋ Task</ActionButton>
            <ActionButton href="#log-work">＋ Log work</ActionButton>
            <ActionButton href="#conversations">＋ Conversation</ActionButton>
            <EditDrawer title={`Edit ${isArea ? 'area' : 'project'}`}>
              <ProjectForm
                domains={domains}
                initial={{
                  id: project.id,
                  name: project.name,
                  description: project.description ?? '',
                  domain_id: project.domain_id ?? '',
                  type: (project.type as '' | 'client' | 'internal' | 'content') ?? '',
                  status: project.status as 'idea' | 'active' | 'paused' | 'done' | 'archived',
                  engagement_type: project.engagement_type ?? 'project',
                  kind: project.kind ?? 'project',
                  quoted_hours: project.quoted_hours != null ? String(project.quoted_hours) : '',
                  retainer_anchor_day: project.retainer_anchor_day != null ? String(project.retainer_anchor_day) : '',
                  start_date: project.start_date ?? '',
                  target_date: project.target_date ?? '',
                  color: project.color ?? '',
                }}
              />
            </EditDrawer>
          </>
        }
      />

      {/* With a description: split band — prose left, compact stat ledger in
          the narrow right column. Without one: the classic full-width strip
          (the empty state IS the old design). Same computed values either way. */}
      {project.description ? (
        <SplitStatBand text={project.description}>
          {isRetainer ? (
            <LedgerRow k="Hours · this month" v={`${hoursThisMonth.toFixed(1)} h`}
              meta={`${hoursLastMonth.toFixed(1)}h last${quoted != null ? ` · cap ${quoted.toFixed(1)}h` : ''}`} />
          ) : pct != null ? (
            <LedgerRow k="Progress" v={`${pct}%`} meta={`${doneWeight}/${totalWeight} weight done`} />
          ) : (
            <LedgerRow k="Hours · all-time" v={`${hoursLogged.toFixed(1)} h`}
              meta={quoted != null ? `of ${quoted.toFixed(1)}h quoted` : 'no quote set'} />
          )}

          <LedgerRow k="Work" v={`${openTasks.length} open`}
            meta={
              <>
                {overdueCount > 0 && <span className="text-accent">{overdueCount} overdue · </span>}
                {waitingTasks.length} waiting
              </>
            } />

          {isRetainer ? (
            <LedgerRow k="Retainer cycle" v={cycle ? `Day ${cycle.day} / ${cycle.length}` : '—'}
              meta={cycle ? 'billing cycle' : 'set anchor day in Edit'} />
          ) : project.target_date ? (
            <LedgerRow k="Target date" v={fmtShort(project.target_date, tz)}
              tone={project.target_date < today ? 'accent' : undefined}
              meta={project.target_date < today ? `passed ${Math.abs(daysAgoFrom(`${project.target_date}T12:00:00Z`, tz, today))}d`
                : `${Math.abs(daysAgoFrom(`${project.target_date}T12:00:00Z`, tz, today))}d out`} />
          ) : (
            <LedgerRow k="Milestones" v={milestones.length || '—'} meta={milestones.length ? 'defined' : 'none yet'} />
          )}

          <LedgerRow k="Last activity" tone={activityStale ? 'warn' : undefined}
            v={lastActivityDays != null ? `${lastActivityDays}d ago` : '—'}
            meta={lastActivityDays == null ? 'nothing logged' : activityStale ? 'check-in pending' : undefined} />
        </SplitStatBand>
      ) : (
      <StatStrip>
        {isRetainer ? (
          <Stat label="Hours · this month" value={hoursThisMonth.toFixed(1)} unit="h"
            sub={`${hoursLastMonth.toFixed(1)}h last · ${hoursLogged.toFixed(1)}h all-time${quoted != null ? ` · cap ${quoted.toFixed(1)}h` : ''}`} />
        ) : pct != null ? (
          <Stat label="Progress · milestone-weighted" value={pct} unit="%" sub={`${doneWeight}/${totalWeight} weight done`} />
        ) : (
          <Stat label="Hours · all-time" value={hoursLogged.toFixed(1)} unit="h"
            sub={quoted != null ? `of ${quoted.toFixed(1)}h quoted` : 'no quote set'} />
        )}

        <Stat label="Work"><WorkCounts open={openTasks.length} overdue={overdueCount} waiting={waitingTasks.length} /></Stat>

        {isRetainer ? (
          cycle ? <Stat label="Retainer cycle" value={`Day ${cycle.day}`} unit={`/ ${cycle.length}`} sub="billing cycle" />
                : <Stat label="Retainer cycle" value="—" sub="set anchor day in Edit" />
        ) : project.target_date ? (
          <Stat label="Target date" value={fmtShort(project.target_date, tz)}
            tone={project.target_date < today ? 'accent' : undefined}
            sub={project.target_date < today ? `passed ${Math.abs(daysAgoFrom(`${project.target_date}T12:00:00Z`, tz, today))}d`
              : `${Math.abs(daysAgoFrom(`${project.target_date}T12:00:00Z`, tz, today))}d out`} />
        ) : (
          <Stat label="Milestones" value={milestones.length || '—'} sub={milestones.length ? 'defined' : 'none yet'} />
        )}

        <Stat label="Last activity" tone={activityStale ? 'warn' : undefined}
          value={lastActivityDays != null ? lastActivityDays : '—'}
          unit={lastActivityDays != null ? (lastActivityDays === 1 ? 'day ago' : 'days ago') : undefined}
          sub={lastActivityDays == null ? 'nothing logged' : activityStale ? 'check-in pending' : undefined} />
      </StatStrip>
      )}

      <ProjectTasksProvider
        key={project.id}
        projectId={project.id}
        tasks={tasks}
        rows={Object.fromEntries(tasks.map(task => [task.id, <TaskItem key={task.id} task={task} showStar={false} showProject={false} />]))}
        milestones={milestones}
        today={today}
        doneTodayIds={doneToday.map(task => task.id)}
        groupMode={groupMode}
        hasWorkflow={Boolean(project.task_workflow)}
      >
      <DetailBody
        main={
          <>
            {/* The overview document (0050) — the living page under the
                blurb: specs, links, decisions, the story so far. */}
            <DetailSection label="Overview" className="mt-0">
              <DocPanel
                entity="project"
                id={project.id}
                body={project.doc_md ?? null}
                version={project.doc_version ?? 1}
                promote={{ projectId: project.id, source: `overview of ${project.name}`, revalidate: `/projects/${project.id}` }}
                emptyHint={
                  project.status === 'idea'
                    ? 'What is the idea, what would it take, why bother? Markdown — a checklist line can become a task once this is a project.'
                    : 'The living page for this project — scope, decisions, links, a parts list. Markdown; a checklist line can become a task with → task.'
                }
              />
            </DetailSection>

            <SaveTaskTemplate
              projectId={project.id} projectName={project.name}
              count={<>{openTasks.length} open{overdueCount > 0 && <span className="text-accent"> · {overdueCount} overdue</span>}{waitingTasks.length > 0 && <span> · {waitingTasks.length} waiting</span>}</>}
            >
              <WorkflowSettings scope="project" id={project.id} />
              {/* Quick capture (Wave 2 #2) — title-only add into this
                  project; the ＋ buttons above stay the full-editor path. */}
              <div className="mb-4">
                <QuickAddTask projectId={project.id} placeholder="Quick add a task — just a title…" />
              </div>
              <ProjectTaskList />
            </SaveTaskTemplate>

            <section id="log-work" className="mt-8">
              <DetailSection label="Activity" count={activity.length} className="mt-0">
                <LogTimeForm projectId={project.id} />
                {activity.length === 0 ? (
                  <p className="font-sans text-[13px] text-ink-3 italic py-1">No activity logged yet.</p>
                ) : (
                  <>
                    <ul className="mt-1">{activity.map((a) => (<ActivityRow key={a.id} entry={a} projectId={project.id} />))}</ul>
                    <div className="mt-2 font-mono text-[10px] uppercase tracking-wider text-ink-3 italic">Click any row to edit the entry, hours, or timestamp.</div>
                  </>
                )}
              </DetailSection>
            </section>

            <section id="conversations" className="mt-8">
              <DetailSection label="Conversations" count={detail.conversations.length > 0 ? detail.conversations.length : undefined} className="mt-0">
                <ConversationTimeline conversations={detail.conversations} tz={tz} revalidatePath={`/projects/${project.id}`} scope="project" />
                <LogConversationForm scope={{ project_id: project.id }} revalidatePath={`/projects/${project.id}`} />
              </DetailSection>
            </section>

            <ProjectCompletedTasks />
          </>
        }
        rail={
          <>
            <ContactsSection
              projectId={project.id}
              company={project.company ?? null}
              primaryContact={project.primary_contact ?? null}
              contacts={detail.contacts}
              people={people}
            />
            {!isRetainer && !isArea && <MilestonesSection projectId={project.id} milestones={milestones} />}
            <ChecklistSection projectId={project.id} items={checklist} />
            <RailBlock label="Details">
              <KV k="Engagement" v={isArea ? 'Area' : isRetainer ? 'Retainer' : 'Project'} />
              {project.asset && (
                <div className="flex items-baseline justify-between gap-3 py-1.5">
                  <span className="font-mono text-[10px] uppercase tracking-[0.04em] text-ink-3">Asset</span>
                  <Link href={`/assets/${project.asset.id}`} className="font-sans text-[13.5px] text-accent hover:text-ink transition-colors">
                    {project.asset.name}
                  </Link>
                </div>
              )}
              {!isRetainer && (
                <KV k="Hours" v={`${hoursLogged.toFixed(1)}h${quoted != null ? ` / ${quoted.toFixed(1)}h quoted` : ' logged'}`} />
              )}
              {isRetainer && <KV k="Anchor day" v={project.retainer_anchor_day != null ? String(project.retainer_anchor_day) : '—'} />}
              {project.target_date && <KV k="Target" v={fmtShort(project.target_date, tz)} tone={project.target_date < today ? 'accent' : undefined} />}
              <KV k="Status" v={STATUS_LABELS[project.status] ?? project.status} />
              {project.start_date && <KV k="Started" v={fmtShort(project.start_date, tz)} />}
            </RailBlock>
          </>
        }
      />
      </ProjectTasksProvider>
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

// ─── date + cycle helpers (app-tz, no instant→UTC shift) ─────────────────────

function fmtShort(iso: string, tz: string): string {
  const d = iso.length === 10 ? new Date(`${iso}T12:00:00Z`) : new Date(iso);
  return d.toLocaleDateString('en-US', { timeZone: tz, month: 'short', day: 'numeric' });
}

// Days between an instant (app-tz calendar day) and today (app-tz YYYY-MM-DD).
function daysAgoFrom(iso: string, tz: string, todayYmd: string): number {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
  return Math.round((Date.parse(`${todayYmd}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / 86_400_000);
}

function daysInMonth(y: number, m1: number): number { return new Date(Date.UTC(y, m1, 0)).getUTCDate(); }

// Retainer cycle position from an anchor day-of-month, clamped to month end
// (anchor 31 → Feb 28/29). Day 1 = the anchor date; length = anchor→next-anchor.
function retainerCycle(anchorDay: number, todayYmd: string): { day: number; length: number } {
  const [y, m, d] = todayYmd.split('-').map(Number);
  const clamp = (yy: number, mm1: number) => Math.min(anchorDay, daysInMonth(yy, mm1));
  let ay = y!, am = m!, aDay = clamp(y!, m!);
  if (d! < aDay) { am = m! - 1; if (am < 1) { am = 12; ay = y! - 1; } aDay = clamp(ay, am); }
  let ny = ay, nm = am + 1; if (nm > 12) { nm = 1; ny = ay + 1; }
  const nDay = clamp(ny, nm);
  const start = Date.UTC(ay, am - 1, aDay);
  const next = Date.UTC(ny, nm - 1, nDay);
  const todayUTC = Date.UTC(y!, m! - 1, d!);
  return { day: Math.floor((todayUTC - start) / 86_400_000) + 1, length: Math.round((next - start) / 86_400_000) };
}
