import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Pill } from '@/components/Pill';
import {
  DetailHeader, CrumbDot, ActionButton, StatStrip, Stat, DetailBody, DetailSection, RailBlock,
} from '@/components/detail/DetailShell';
import { EditDrawer } from '@/components/detail/EditDrawer';
import {
  companiesApi, domainsApi, ApiError,
  type CompanyDetail, type CompanyRelationshipType, type CompanyOpenTask, type Conversation,
} from '@/lib/api';
import { getAppTimezone } from '@/lib/app-settings';
import { todayIsoDate } from '@/lib/today';
import { urgencyFromCounts, type Urgency } from '@jevi-ops/shared';
import { silenceLabel } from '@/lib/silence';
import { ConversationTimeline } from '@/components/conversations/ConversationTimeline';
import { LogConversationForm } from '@/components/conversations/LogConversationForm';
import { CompanyForm } from '../company-form';

// /companies/[id] — company detail (Detail Pages v2, Addendum 10 §8). The page
// leads with a needs-response block (what's open between us), then the
// conversation timeline, the project portfolio, and an open-task rollup drawn
// from every project. Recency reads against the check-in cadence; config lives
// behind the Edit drawer. Designed sparse-first — empty reads intentional.

const REL_LABELS: Record<CompanyRelationshipType, string> = {
  active_client: 'Active client',
  past_client: 'Past client',
  prospect: 'Prospect',
  vendor: 'Vendor',
  partner: 'Partner',
  brand_deal: 'Brand deal',
  other: 'Other',
};
const STATUS_LABELS: Record<string, string> = { active: 'Active', paused: 'Paused', done: 'Done', archived: 'Archived' };
const DEFAULT_CADENCE = 30;

export default async function CompanyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tz = await getAppTimezone();
  const today = todayIsoDate(tz);

  let detail: CompanyDetail | null = null;
  let domains: { id: string; name: string }[] = [];
  let errorMessage: string | null = null;
  try {
    const [detailRes, domainsRes] = await Promise.all([
      companiesApi.get(id),
      domainsApi.list().catch(() => ({ domains: [] as { id: string; name: string; is_system: boolean }[] })),
    ]);
    detail = detailRes;
    domains = domainsRes.domains.filter((d) => !d.is_system).map((d) => ({ id: d.id, name: d.name }));
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    errorMessage = err instanceof ApiError ? `API ${err.status}` : (err as Error).message;
  }

  if (!detail) {
    return (
      <div className="px-5 lg:px-8 pt-8">
        <h1 className="font-serif text-[40px] font-medium tracking-[-0.022em] text-ink">—</h1>
        <p className="mt-4 font-sans text-[13px] text-ink-3">{errorMessage ?? 'Company not found.'}</p>
      </div>
    );
  }

  const { company, contacts, projects, conversations, open_tasks, open_tasks_count } = detail;
  const isActiveClient = company.relationship_type === 'active_client';
  const cadence = company.checkin_interval_days ?? DEFAULT_CADENCE;
  const plus7 = addDaysYmd(today, 7);

  // Contact recency vs cadence — only an active client past its cadence nags
  // (mirrors the company_silent rule). For everyone else recency is display.
  const daysSilent = company.last_interaction_at ? daysAgoFrom(company.last_interaction_at, tz, today) : null;
  const silencePast = isActiveClient && daysSilent != null && daysSilent > cadence;

  // Next review (a date column) — overdue is a loud state.
  const nextReviewYmd = company.next_review_at ? company.next_review_at.slice(0, 10) : null;
  const nextReviewOverdue = nextReviewYmd != null && nextReviewYmd < today;
  const nextReviewSoon = nextReviewYmd != null && !nextReviewOverdue && nextReviewYmd <= plus7;

  // Needs-response — conversations flagged requires_followup, passed sorted first.
  const followups = conversations.filter((c) => c.requires_followup);
  const passedFollowups = followups.filter((c) => c.followup_by != null && c.followup_by < today);
  const followupSoon = followups.some((c) => c.followup_by != null && c.followup_by >= today && c.followup_by <= plus7);
  const needsResponse = [...followups].sort(byFollowup);

  // Project portfolio + task rollup, grouped by project.
  const activeProjects = projects.filter((p) => p.status === 'active');
  const tasksByProject = new Map<string, CompanyOpenTask[]>();
  for (const t of open_tasks) {
    const arr = tasksByProject.get(t.project.id) ?? [];
    arr.push(t);
    tasksByProject.set(t.project.id, arr);
  }
  const overdueTasks = open_tasks.filter((t) => t.status !== 'waiting' && t.due_date != null && t.due_date < today);
  const dueTodayTasks = open_tasks.filter((t) => t.status !== 'waiting' && t.due_date === today);
  const waitingTasks = open_tasks.filter((t) => t.status === 'waiting');
  const rollupGroups = projects
    .map((p) => ({ project: p, tasks: sortRollup(tasksByProject.get(p.id) ?? []) }))
    .filter((g) => g.tasks.length > 0);

  // Company urgency, via the shared four-state helper. Problem-states escalate:
  // passed review / passed follow-up / overdue task / past-cadence silence.
  const urg: Urgency = urgencyFromCounts({
    overdue: (nextReviewOverdue ? 1 : 0) + passedFollowups.length + overdueTasks.length + (silencePast ? 1 : 0),
    dueToday: dueTodayTasks.length,
    targetNear: nextReviewSoon || followupSoon,
    open: open_tasks_count + followups.length + activeProjects.length,
    waiting: waitingTasks.length,
  });
  const chipLabel =
    silencePast ? `Silent · ${silenceLabel(daysSilent)}`
    : passedFollowups.length > 0 ? `${passedFollowups.length} follow-up${passedFollowups.length === 1 ? '' : 's'} passed`
    : nextReviewOverdue ? 'Review overdue'
    : overdueTasks.length > 0 ? `${overdueTasks.length} overdue`
    : urg === 'due' ? 'Due soon'
    : urg === 'ok' ? (isActiveClient ? 'Active' : 'On track')
    : 'Quiet';

  // A future-dated conversation (occurred_at ahead of now) makes last_interaction_at
  // a future instant, so daysSilent can be negative — read that as "today".
  const lastContactLabel = daysSilent == null ? 'none yet' : daysSilent <= 0 ? 'today' : `${daysSilent}d ago`;
  const websiteHost = company.website ? company.website.replace(/^https?:\/\//, '').replace(/\/$/, '') : null;

  return (
    <div>
      <DetailHeader
        crumb={
          <>
            <Link href="/companies" className="hover:text-ink-2 transition-colors">Companies</Link>
            {company.relationship_type && (<><CrumbDot /><span>{REL_LABELS[company.relationship_type]}</span></>)}
            {company.domain?.name && (<><CrumbDot /><span>{company.domain.name}</span></>)}
            {!company.active && (<><CrumbDot /><span>Inactive</span></>)}
          </>
        }
        name={company.name}
        state={<Pill state={urg}>{chipLabel}</Pill>}
        actions={
          <>
            <ActionButton href="#conversations">＋ Conversation</ActionButton>
            <EditDrawer title="Edit company">
              <CompanyForm
                domains={domains}
                initial={{
                  id: company.id,
                  name: company.name,
                  relationship_type: company.relationship_type ?? '',
                  domain_id: company.domain_id ?? '',
                  website: company.website ?? '',
                  primary_email: company.primary_email ?? '',
                  primary_phone: company.primary_phone ?? '',
                  first_engagement_at: company.first_engagement_at ?? '',
                  next_review_at: company.next_review_at ?? '',
                  checkin_interval_days: company.checkin_interval_days ?? null,
                  notes: company.notes ?? '',
                  active: company.active,
                }}
              />
            </EditDrawer>
          </>
        }
      />

      <StatStrip>
        <Stat
          label="Last contact"
          value={daysSilent == null ? '—' : daysSilent <= 0 ? 'Today' : `${daysSilent}`}
          unit={daysSilent != null && daysSilent > 0 ? (daysSilent === 1 ? 'day ago' : 'days ago') : undefined}
          tone={silencePast ? 'accent' : undefined}
          sub={daysSilent == null ? 'nothing logged' : silencePast ? `past ${cadence}d cadence` : isActiveClient ? `${cadence}d cadence` : 'no cadence'}
        />
        {nextReviewYmd ? (
          <Stat label="Next review" value={fmtShort(nextReviewYmd, tz)} tone={nextReviewOverdue ? 'accent' : undefined}
            sub={nextReviewOverdue ? `${Math.abs(daysAgoFrom(`${nextReviewYmd}T12:00:00Z`, tz, today))}d ago` : `in ${Math.abs(daysAgoFrom(`${nextReviewYmd}T12:00:00Z`, tz, today))}d`} />
        ) : (
          <Stat label="Next review" value="—" sub="none set" />
        )}
        <Stat label="Open follow-ups" value={followups.length} tone={passedFollowups.length > 0 ? 'accent' : undefined}
          sub={passedFollowups.length > 0 ? `${passedFollowups.length} passed` : followups.length ? 'awaiting reply' : 'none open'} />
        <Stat label="Active projects" value={activeProjects.length}
          sub={projects.length === 0 ? 'none linked' : projects.length === activeProjects.length ? 'all active' : `${projects.length} total`} />
      </StatStrip>

      <DetailBody
        main={
          <>
            {needsResponse.length > 0 && (
              <DetailSection label="Needs response" count={needsResponse.length} className="mt-0">
                <ul className="flex flex-col">
                  {needsResponse.map((c) => {
                    const passed = c.followup_by != null && c.followup_by < today;
                    return (
                      <li key={c.id} className={`py-3 border-b border-line/40 ${passed ? 'border-l-2 border-l-accent pl-3' : ''}`}>
                        <div className="flex items-baseline justify-between gap-3">
                          <div className="font-mono text-[10px] uppercase tracking-wider flex flex-wrap gap-x-2 items-baseline min-w-0">
                            <span className={passed ? 'text-accent font-semibold' : c.followup_by ? 'text-warn' : 'text-ink-3'}>
                              {c.followup_by ? (passed ? `Passed ${fmtShort(c.followup_by, tz)}` : `By ${fmtShort(c.followup_by, tz)}`) : 'Flagged'}
                            </span>
                            {c.person && <span className="text-ink-3">· <Link href={`/people/${c.person.id}`} className="hover:text-accent transition-colors">{c.person.name}</Link></span>}
                            {c.project && <span className="text-ink-3">· <Link href={`/projects/${c.project.id}`} className="hover:text-accent transition-colors">{c.project.name}</Link></span>}
                          </div>
                          <span className="font-mono text-[10px] uppercase tracking-wider text-ink-4 shrink-0">{fmtShort(c.occurred_at, tz)}</span>
                        </div>
                        {c.subject && <div className="mt-1 font-sans text-[14px] text-ink font-medium">{c.subject}</div>}
                        <p className="mt-0.5 font-sans text-[13.5px] text-ink-2 leading-relaxed line-clamp-2">{c.summary}</p>
                      </li>
                    );
                  })}
                </ul>
              </DetailSection>
            )}

            <section id="conversations" className={needsResponse.length > 0 ? 'mt-8' : ''}>
              <DetailSection label="Conversations" count={conversations.length > 0 ? conversations.length : undefined} className="mt-0">
                <ConversationTimeline conversations={conversations} tz={tz} revalidatePath={`/companies/${company.id}`} scope="company" />
                <LogConversationForm scope={{ company_id: company.id }} revalidatePath={`/companies/${company.id}`} />
              </DetailSection>
            </section>

            <DetailSection label="Projects" count={projects.length > 0 ? projects.length : undefined}>
              {projects.length === 0 ? (
                <p className="font-sans text-[13px] text-ink-3 italic py-1">
                  No projects linked. Set a project&rsquo;s company to {company.name}.
                </p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {projects.map((p) => {
                    const pt = tasksByProject.get(p.id) ?? [];
                    const pWaiting = pt.filter((t) => t.status === 'waiting').length;
                    const pOverdue = pt.filter((t) => t.status !== 'waiting' && t.due_date && t.due_date < today).length;
                    const pOpen = pt.length - pWaiting;
                    return (
                      <Link key={p.id} href={`/projects/${p.id}`} className="block border border-line rounded p-3 bg-surface hover:border-ink-3 transition-colors">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="flex items-center gap-2 min-w-0">
                            {p.color && <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: p.color }} />}
                            <span className="font-sans text-[14px] text-ink truncate font-medium">{p.name}</span>
                          </span>
                          <span className="font-mono text-[9px] uppercase tracking-wider text-ink-3 shrink-0">{STATUS_LABELS[p.status] ?? p.status}</span>
                        </div>
                        <div className="mt-2 font-mono text-[10px] uppercase tracking-wider flex flex-wrap gap-x-2 text-ink-3">
                          {pt.length === 0 ? (
                            <span className="text-ink-4">no open tasks</span>
                          ) : (
                            <>
                              <span>{pOpen} open</span>
                              {pOverdue > 0 && <span className="text-accent">· {pOverdue} overdue</span>}
                              {pWaiting > 0 && <span>· {pWaiting} waiting</span>}
                            </>
                          )}
                        </div>
                      </Link>
                    );
                  })}
                </div>
              )}
            </DetailSection>

            <DetailSection
              label="Open tasks"
              count={open_tasks_count > 0 ? open_tasks_count : undefined}
              className="mt-8"
            >
              {open_tasks_count === 0 ? (
                <p className="font-sans text-[13px] text-ink-3 italic py-1">
                  {projects.length === 0 ? 'No projects, so nothing open.' : 'Nothing open across this company’s projects.'}
                </p>
              ) : (
                <div className="flex flex-col gap-5">
                  {rollupGroups.map((g) => (
                    <div key={g.project.id}>
                      <div className="flex items-baseline gap-2 mb-1.5">
                        <Link href={`/projects/${g.project.id}`} className="font-sans text-[13.5px] font-semibold text-ink hover:text-accent transition-colors">{g.project.name}</Link>
                        <span className="font-mono text-[10px] text-ink-4">{g.tasks.length}</span>
                      </div>
                      <ul>
                        {g.tasks.map((t) => {
                          const st = taskState(t, today);
                          return (
                            <li key={t.id} className="flex items-baseline gap-3 py-1.5 border-b border-line/40">
                              <span className={`font-mono text-[9px] uppercase tracking-wider w-16 shrink-0 ${st.cls}`}>{st.label}</span>
                              <Link href={`/tasks/${t.id}`} className="flex-1 font-sans text-[13.5px] text-ink hover:text-accent transition-colors">{t.title}</Link>
                              {t.due_date && <span className="font-mono text-[10px] text-ink-4 shrink-0">{fmtShort(t.due_date, tz)}</span>}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ))}
                  {open_tasks_count > open_tasks.length && (
                    <p className="font-mono text-[10px] uppercase tracking-wider text-ink-4">Showing {open_tasks.length} of {open_tasks_count}.</p>
                  )}
                </div>
              )}
            </DetailSection>
          </>
        }
        rail={
          <>
            <RailBlock label="Contacts">
              {contacts.length === 0 ? (
                <p className="font-sans text-[13px] text-ink-3 italic">No contacts linked yet.</p>
              ) : (
                <ul className="flex flex-col">
                  {contacts.map((c) => (
                    <li key={c.id} className="py-1.5 border-b border-line/40 last:border-0">
                      <Link href={`/people/${c.id}`} className="flex items-baseline justify-between gap-2 hover:opacity-80 transition-opacity">
                        <span className="font-sans text-[13.5px] text-ink min-w-0 truncate">
                          {c.name}
                          {c.is_primary_contact && <span className="ml-1.5 font-mono text-[9px] uppercase tracking-wider text-accent">primary</span>}
                        </span>
                        <span className="font-mono text-[9px] uppercase tracking-wider text-ink-3 shrink-0 truncate max-w-[45%]">{c.role_at_company ?? c.email ?? ''}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </RailBlock>

            <RailBlock label="Details">
              {websiteHost && (
                <KV k="Website" v={<a href={company.website!} target="_blank" rel="noopener noreferrer" className="hover:text-accent transition-colors break-all">{websiteHost}</a>} />
              )}
              {company.primary_email && (
                <KV k="Email" v={<a href={`mailto:${company.primary_email}`} className="hover:text-accent transition-colors break-all">{company.primary_email}</a>} />
              )}
              {company.primary_phone && <KV k="Phone" v={company.primary_phone} />}
              {company.first_engagement_at && <KV k="Since" v={fmtShort(company.first_engagement_at, tz)} />}
              {isActiveClient && <KV k="Cadence" v={`every ${cadence}d`} />}
              {nextReviewYmd && <KV k="Next review" v={fmtShort(nextReviewYmd, tz)} tone={nextReviewOverdue ? 'accent' : undefined} />}
              <KV k="Last contact" v={lastContactLabel} />
            </RailBlock>

            {company.notes && (
              <RailBlock label="Notes">
                <p className="font-sans text-[13px] text-ink-2 leading-relaxed whitespace-pre-wrap">{company.notes}</p>
              </RailBlock>
            )}
          </>
        }
      />
    </div>
  );
}

function KV({ k, v, tone }: { k: string; v: React.ReactNode; tone?: 'accent' }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="font-mono text-[10px] uppercase tracking-[0.04em] text-ink-3 shrink-0">{k}</span>
      <span className={`font-sans text-[13.5px] text-right ${tone === 'accent' ? 'text-accent' : 'text-ink'}`}>{v}</span>
    </div>
  );
}

// Rollup task state → label + colour. waiting is muted; overdue accent; due warn.
function taskState(t: CompanyOpenTask, today: string): { label: string; cls: string } {
  if (t.status === 'waiting') return { label: 'waiting', cls: 'text-ink-4' };
  if (t.due_date && t.due_date < today) return { label: 'overdue', cls: 'text-accent' };
  if (t.due_date === today) return { label: 'due today', cls: 'text-warn' };
  return { label: 'open', cls: 'text-ink-3' };
}

// Needs-response order: earliest follow-up date first (so passed ones lead),
// dateless flagged ones last (by most-recent conversation).
function byFollowup(a: Conversation, b: Conversation): number {
  const ad = a.followup_by, bd = b.followup_by;
  if (ad == null && bd == null) return b.occurred_at.localeCompare(a.occurred_at);
  if (ad == null) return 1;
  if (bd == null) return -1;
  return ad.localeCompare(bd);
}

// Rollup within a project: waiting last, then by due date (undated last).
function sortRollup(list: CompanyOpenTask[]): CompanyOpenTask[] {
  return [...list].sort((a, b) => {
    const aw = a.status === 'waiting' ? 1 : 0;
    const bw = b.status === 'waiting' ? 1 : 0;
    if (aw !== bw) return aw - bw;
    return (a.due_date ?? '9999-99-99').localeCompare(b.due_date ?? '9999-99-99');
  });
}

// ─── date helpers (app-tz, no instant→UTC shift) ─────────────────────────────
function fmtShort(iso: string, tz: string): string {
  const d = iso.length === 10 ? new Date(`${iso}T12:00:00Z`) : new Date(iso);
  return d.toLocaleDateString('en-US', { timeZone: tz, month: 'short', day: 'numeric' });
}
function daysAgoFrom(iso: string, tz: string, todayYmd: string): number {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
  return Math.round((Date.parse(`${todayYmd}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / 86_400_000);
}
function addDaysYmd(ymd: string, n: number): string {
  return new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}
