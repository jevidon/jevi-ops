import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Pill } from '@/components/Pill';
import {
  DetailHeader, CrumbDot, ActionButton, StatStrip, Stat, DetailBody, DetailSection, RailBlock,
} from '@/components/detail/DetailShell';
import { EditDrawer } from '@/components/detail/EditDrawer';
import {
  peopleApi, companiesApi, ApiError,
  type PersonDetail, type Person, type PersonFact, type PersonFactType, type Conversation,
} from '@/lib/api';
import { getAppTimezone } from '@/lib/app-settings';
import { todayIsoDate } from '@/lib/today';
import { urgencyFromCounts, type Urgency } from '@jevi-ops/shared';
import { PersonForm } from '../person-form';
import { FactForm } from './fact-form';
import { deleteFactAction } from './fact-actions';
import { ConversationTimeline } from '@/components/conversations/ConversationTimeline';
import { LogConversationForm } from '@/components/conversations/LogConversationForm';

// /people/[id] — person detail (Detail Pages v2, Addendum 10 §9). Answers three
// questions warmly: when did we last connect · what's coming · what's open
// between us. Designed sparse-first (one conversation, zero facts reads
// intentional). Recency is display, never a nag — the only loud state is a
// follow-up you owe. Capture (+ Conversation / + Fact) stays on the page;
// configuration lives behind the Edit drawer.

const RELATIONSHIP_LABELS: Record<string, string> = {
  client: 'Client', family: 'Family', church: 'Church', friend: 'Friend', team: 'Team', vendor: 'Vendor', other: 'Other',
};
const FACT_LABELS: Record<PersonFactType, string> = {
  anniversary: 'Anniversary', birthday: 'Birthday', kid_name: 'Kid', shared: 'Shared', follow_up: 'Follow-up', other: 'Other',
};
const UPCOMING_WINDOW = 30;
const IMMINENT_DAYS = 7; // within a week reads accent; further out stays calm

export default async function PersonDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tz = await getAppTimezone();
  const today = todayIsoDate(tz);

  let detail: PersonDetail | null = null;
  let companies: { id: string; name: string }[] = [];
  let errorMessage: string | null = null;
  try {
    const [detailRes, companiesRes] = await Promise.all([
      peopleApi.get(id),
      companiesApi.list().catch(() => ({ companies: [] as { id: string; name: string }[] })),
    ]);
    detail = detailRes;
    companies = companiesRes.companies.map((c) => ({ id: c.id, name: c.name }));
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    errorMessage = err instanceof ApiError ? `API ${err.status}` : (err as Error).message;
  }

  if (!detail) {
    return (
      <div className="px-5 lg:px-8 pt-8">
        <h1 className="font-serif text-[40px] font-medium tracking-[-0.022em] text-ink">—</h1>
        <p className="mt-4 font-sans text-[13px] text-ink-3">{errorMessage ?? 'Person not found.'}</p>
      </div>
    );
  }

  const { person, facts, conversations, notes, projects } = detail;
  const firstName = person.name.split(' ')[0];
  const plus7 = addDaysYmd(today, 7);

  // Recency — from the most recent conversation (people has no last_interaction
  // column on the detail payload). Display only; never drives an alarm.
  const sorted = [...conversations].sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
  const latest = sorted[0] ?? null;
  const daysSince = latest ? daysAgoFrom(latest.occurred_at, tz, today) : null;
  const sparse = conversations.length >= 1 && conversations.length <= 3;

  // Coming up — birthday / anniversary (recurring annual) + dated facts, within
  // a 30-day window, nearest first.
  const upcoming = buildUpcoming(person, facts, today, tz);
  const nextUp = upcoming[0] ?? null;
  const bdayDays = person.birthday ? daysUntilAnnual(person.birthday, today) : null;
  const bdaySoon = bdayDays != null && bdayDays <= UPCOMING_WINDOW;
  const bdayImminent = bdayDays != null && bdayDays <= IMMINENT_DAYS;

  // Open between us — conversations flagged requires_followup (the only nag).
  const followups = conversations.filter((c) => c.requires_followup);
  const passed = followups.filter((c) => c.followup_by != null && c.followup_by < today);
  const soon = followups.filter((c) => c.followup_by != null && c.followup_by >= today && c.followup_by <= plus7);
  const needsReply = [...followups].sort(byFollowup);
  const openUrg: Urgency = urgencyFromCounts({
    overdue: passed.length, dueToday: 0, targetNear: soon.length > 0, open: followups.length, waiting: 0,
  });

  const hasLegacyDateFact = facts.some((f) => f.fact_type === 'birthday' || f.fact_type === 'anniversary');
  const companyRef = person.company_ref ?? null;

  return (
    <div>
      <DetailHeader
        crumb={
          <>
            <Link href="/people" className="hover:text-ink-2 transition-colors">People</Link>
            {person.relationship_type && (<><CrumbDot /><span>{RELATIONSHIP_LABELS[person.relationship_type]}</span></>)}
            {companyRef ? (
              <><CrumbDot /><Link href={`/companies/${companyRef.id}`} className="hover:text-ink-2 transition-colors">{companyRef.name}</Link></>
            ) : person.company ? (
              <><CrumbDot /><span>{person.company}</span></>
            ) : null}
          </>
        }
        name={person.name}
        state={
          followups.length === 0 ? undefined : (
            <Pill state={openUrg}>
              {openUrg === 'over' ? `${passed.length} to reply` : openUrg === 'due' ? 'Reply soon' : `${followups.length} open`}
            </Pill>
          )
        }
        actions={
          <>
            <ActionButton href="#conversations">＋ Conversation</ActionButton>
            <ActionButton href="#facts">＋ Fact</ActionButton>
            <EditDrawer title="Edit person">
              <PersonForm
                companies={companies}
                initial={{
                  id: person.id,
                  name: person.name,
                  relationship_type: person.relationship_type ?? '',
                  email: person.email ?? '',
                  phone: person.phone ?? '',
                  company_id: person.company_id ?? '',
                  role_at_company: person.role_at_company ?? '',
                  is_primary_contact: person.is_primary_contact ?? false,
                  birthday: person.birthday ?? '',
                  anniversary: person.anniversary ?? '',
                  notes: person.notes ?? '',
                }}
              />
            </EditDrawer>
          </>
        }
        below={
          <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] uppercase tracking-[0.05em] text-ink-3">
            <span>{latest ? `Last conversation · ${daysSince != null && daysSince <= 0 ? 'today' : `${daysSince}d ago`}` : 'No conversations yet'}</span>
            {bdaySoon && <span className={bdayImminent ? 'text-accent' : undefined}>· Birthday {bdayDays === 0 ? 'today' : `in ${bdayDays}d`}</span>}
          </div>
        }
      />

      <StatStrip>
        <Stat label="Last connected"
          value={daysSince == null ? '—' : daysSince <= 0 ? 'Today' : `${daysSince}`}
          unit={daysSince != null && daysSince > 0 ? (daysSince === 1 ? 'day ago' : 'days ago') : undefined}
          sub={daysSince == null ? 'no history yet' : `${conversations.length} logged`} />
        <Stat label="Coming up"
          value={nextUp ? (nextUp.days === 0 ? 'Today' : `${nextUp.days}`) : '—'}
          unit={nextUp && nextUp.days > 0 ? (nextUp.days === 1 ? 'day' : 'days') : undefined}
          sub={nextUp ? nextUp.label : 'nothing soon'} />
        <Stat label="Open between us" value={followups.length} tone={passed.length > 0 ? 'accent' : undefined}
          sub={passed.length > 0 ? `${passed.length} to reply` : followups.length ? 'awaiting you' : 'nothing open'} />
        <Stat label="Facts" value={facts.length} sub={facts.length ? 'remembered' : 'none yet'} />
      </StatStrip>

      <DetailBody
        main={
          <>
            {upcoming.length > 0 && (
              <DetailSection label="Upcoming" count={upcoming.length} className="mt-0">
                <ul className="flex flex-col">
                  {upcoming.map((u) => (
                    <li key={u.key} className="flex items-baseline justify-between gap-3 py-2 border-b border-line/40">
                      <span className="flex items-baseline gap-2.5 min-w-0">
                        <span className="font-mono text-[9px] uppercase tracking-wider text-ink-3 w-16 shrink-0">{u.label}</span>
                        <span className="font-sans text-[14px] text-ink truncate">{u.value}</span>
                      </span>
                      <span className={`font-mono text-[10px] uppercase tracking-wider shrink-0 whitespace-nowrap ${u.days <= IMMINENT_DAYS ? 'text-accent' : 'text-ink-3'}`}>
                        {u.days === 0 ? 'today' : `in ${u.days}d`} · {u.dateLabel}
                      </span>
                    </li>
                  ))}
                </ul>
              </DetailSection>
            )}

            <section id="conversations" className={upcoming.length > 0 ? 'mt-8' : ''}>
              <DetailSection label="Conversations" count={conversations.length > 0 ? conversations.length : undefined} className="mt-0">
                {sparse && latest && (
                  <div className="mb-5 pb-5 border-b border-line">
                    <div className="font-mono text-[10px] uppercase tracking-wider text-ink-3 flex flex-wrap gap-x-2">
                      <span>{fmtShort(latest.occurred_at, tz)}</span>
                      <span>· {latest.interaction_type.replace('_', ' ')}</span>
                      <span>· {latest.direction}</span>
                      {latest.requires_followup && <span className="text-accent">· follow up{latest.followup_by ? ` by ${fmtShort(latest.followup_by, tz)}` : ''}</span>}
                    </div>
                    {latest.subject && <div className="mt-2 font-serif text-[17px] text-ink leading-tight">{latest.subject}</div>}
                    <p className="mt-2 font-serif text-[19px] leading-[1.5] text-ink-2 whitespace-pre-wrap">{latest.summary}</p>
                  </div>
                )}
                {sparse && latest ? (
                  sorted.length > 1 && <ConversationTimeline conversations={sorted.slice(1)} tz={tz} revalidatePath={`/people/${person.id}`} scope="person" />
                ) : (
                  <ConversationTimeline conversations={sorted} tz={tz} revalidatePath={`/people/${person.id}`} scope="person" />
                )}
                <LogConversationForm scope={{ person_id: person.id }} revalidatePath={`/people/${person.id}`} />
              </DetailSection>
            </section>

            {needsReply.length > 0 && (
              <DetailSection label="Needs a reply" count={needsReply.length}>
                <ul className="flex flex-col">
                  {needsReply.map((c) => {
                    const isPast = c.followup_by != null && c.followup_by < today;
                    return (
                      <li key={c.id} className={`py-3 border-b border-line/40 ${isPast ? 'border-l-2 border-l-accent pl-3' : ''}`}>
                        <div className="flex items-baseline justify-between gap-3">
                          <span className={`font-mono text-[10px] uppercase tracking-wider ${isPast ? 'text-accent font-semibold' : c.followup_by ? 'text-warn' : 'text-ink-3'}`}>
                            {c.followup_by ? (isPast ? `Passed ${fmtShort(c.followup_by, tz)}` : `By ${fmtShort(c.followup_by, tz)}`) : 'Flagged'}
                            {c.project && <span className="text-ink-3"> · {c.project.name}</span>}
                          </span>
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

            {notes.length > 0 && (
              <DetailSection label={`Notes mentioning ${firstName}`} count={notes.length}>
                <ul>
                  {notes.map((n) => (
                    <li key={n.id} className="py-2 border-b border-line/40">
                      <Link href={`/library/notes/${n.id}`} className="block hover:opacity-80 transition-opacity">
                        {n.title && <div className="font-serif text-[15px] text-ink leading-tight">{n.title}</div>}
                        <div className="font-sans text-[13px] text-ink-2 leading-snug line-clamp-2">{n.body}</div>
                      </Link>
                    </li>
                  ))}
                </ul>
              </DetailSection>
            )}

            {projects.length > 0 && (
              <DetailSection label="Projects" count={projects.length}>
                <ul>
                  {projects.map((p) => (
                    <li key={p.id} className="py-2 border-b border-line/40">
                      <Link href={`/projects/${p.id}`} className="flex items-baseline gap-3 hover:opacity-80 transition-opacity">
                        {p.color && <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: p.color }} aria-hidden />}
                        <span className="flex-1 font-sans text-[14px] text-ink truncate">{p.name}</span>
                        <span className="font-mono text-[9px] uppercase tracking-wider text-ink-3 shrink-0">{p.status}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </DetailSection>
            )}
          </>
        }
        rail={
          <>
            <div id="facts">
              <RailBlock label="Facts">
                {facts.length === 0 ? (
                  <p className="font-sans text-[13px] text-ink-3 italic">
                    No facts yet — kids&rsquo; names, shared interests, the things you&rsquo;d otherwise forget.
                  </p>
                ) : (
                  <ul>{facts.map((f) => <FactRailRow key={f.id} personId={person.id} fact={f} tz={tz} />)}</ul>
                )}
                {hasLegacyDateFact && (
                  <p className="mt-2 font-sans text-[11.5px] text-ink-3 leading-relaxed">
                    A birthday/anniversary fact is also on the person record (used for reminders). Safe to delete the duplicate — add new ones via Edit.
                  </p>
                )}
                <FactForm personId={person.id} />
              </RailBlock>
            </div>

            <RailBlock label="Details">
              {companyRef ? (
                <KV k="Company" v={<Link href={`/companies/${companyRef.id}`} className="hover:text-accent transition-colors">{companyRef.name}</Link>} />
              ) : person.company ? (
                <KV k="Company" v={person.company} />
              ) : null}
              {person.role_at_company && <KV k="Role" v={person.is_primary_contact ? `${person.role_at_company} · primary` : person.role_at_company} />}
              {person.email && <KV k="Email" v={<a href={`mailto:${person.email}`} className="hover:text-accent transition-colors break-all">{person.email}</a>} />}
              {person.phone && <KV k="Phone" v={<a href={`tel:${person.phone}`} className="hover:text-accent transition-colors">{person.phone}</a>} />}
              {person.birthday && <KV k="Birthday" v={fmtShort(person.birthday, tz)} />}
              {person.anniversary && <KV k="Anniversary" v={fmtShort(person.anniversary, tz)} />}
            </RailBlock>

            {person.notes && (
              <RailBlock label="Notes">
                <p className="font-sans text-[13px] text-ink-2 leading-relaxed whitespace-pre-wrap">{person.notes}</p>
              </RailBlock>
            )}
          </>
        }
      />
    </div>
  );
}

function KV({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="font-mono text-[10px] uppercase tracking-[0.04em] text-ink-3 shrink-0">{k}</span>
      <span className="font-sans text-[13.5px] text-ink text-right min-w-0">{v}</span>
    </div>
  );
}

function FactRailRow({ personId, fact, tz }: { personId: string; fact: PersonFact; tz: string }) {
  const dateLabel = fact.date_relevant
    ? new Date(`${fact.date_relevant}T12:00:00Z`).toLocaleDateString('en-US', {
        timeZone: tz, month: 'short', day: 'numeric', ...(fact.recurring ? {} : { year: 'numeric' }),
      })
    : null;
  return (
    <li className="py-1.5 border-b border-line/40 last:border-0 group">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-mono text-[9px] uppercase tracking-wider text-ink-3 shrink-0">{FACT_LABELS[fact.fact_type]}</span>
        <form action={deleteFactAction} className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          <input type="hidden" name="person_id" value={personId} />
          <input type="hidden" name="fact_id" value={fact.id} />
          <button type="submit" aria-label="Delete fact" className="font-mono text-[9px] uppercase tracking-wider text-ink-3 hover:text-accent transition-colors">✕</button>
        </form>
      </div>
      <div className="font-sans text-[13.5px] text-ink mt-0.5">{fact.fact_value}</div>
      {dateLabel && <div className="font-mono text-[9px] uppercase tracking-wider text-ink-4 mt-0.5">{dateLabel}{fact.recurring && ' · recurs'}</div>}
    </li>
  );
}

// ─── upcoming (birthday/anniversary + dated facts, within the window) ─────────
interface Upcoming { key: string; label: string; value: string; days: number; dateLabel: string }

function buildUpcoming(person: Person, facts: PersonFact[], today: string, tz: string): Upcoming[] {
  const out: Upcoming[] = [];
  const firstName = person.name.split(' ')[0];
  if (person.birthday) {
    const d = daysUntilAnnual(person.birthday, today);
    if (d <= UPCOMING_WINDOW) out.push({ key: 'bday', label: 'Birthday', value: `${firstName}’s birthday`, days: d, dateLabel: fmtShort(person.birthday, tz) });
  }
  if (person.anniversary) {
    const d = daysUntilAnnual(person.anniversary, today);
    if (d <= UPCOMING_WINDOW) out.push({ key: 'anniv', label: 'Anniversary', value: 'Anniversary', days: d, dateLabel: fmtShort(person.anniversary, tz) });
  }
  for (const f of facts) {
    if (!f.date_relevant) continue;
    // birthday/anniversary now live on the person columns (Addendum 05); a
    // legacy fact of either type would double the row already added above.
    if (f.fact_type === 'birthday' || f.fact_type === 'anniversary') continue;
    if (f.recurring) {
      const d = daysUntilAnnual(f.date_relevant, today);
      if (d <= UPCOMING_WINDOW) out.push({ key: f.id, label: FACT_LABELS[f.fact_type], value: f.fact_value, days: d, dateLabel: fmtShort(f.date_relevant, tz) });
    } else {
      const d = daysUntilYmd(f.date_relevant, today);
      if (d >= 0 && d <= UPCOMING_WINDOW) out.push({ key: f.id, label: FACT_LABELS[f.fact_type], value: f.fact_value, days: d, dateLabel: fmtShort(f.date_relevant, tz) });
    }
  }
  return out.sort((a, b) => a.days - b.days);
}

// Needs-reply order: earliest follow-up date first (passed lead), dateless last.
function byFollowup(a: Conversation, b: Conversation): number {
  const ad = a.followup_by, bd = b.followup_by;
  if (ad == null && bd == null) return b.occurred_at.localeCompare(a.occurred_at);
  if (ad == null) return 1;
  if (bd == null) return -1;
  return ad.localeCompare(bd);
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
// Signed days from today to a fixed YYYY-MM-DD (negative = past).
function daysUntilYmd(ymd: string, todayYmd: string): number {
  return Math.round((Date.parse(`${ymd}T00:00:00Z`) - Date.parse(`${todayYmd}T00:00:00Z`)) / 86_400_000);
}
// Days until the next annual recurrence of a date's month/day (0 = today).
function daysUntilAnnual(ymd: string, todayYmd: string): number {
  const [, mm, dd] = ymd.split('-').map(Number);
  const [ty] = todayYmd.split('-').map(Number);
  const todayMs = Date.parse(`${todayYmd}T00:00:00Z`);
  let cand = Date.UTC(ty!, mm! - 1, dd!);
  if (cand < todayMs) cand = Date.UTC(ty! + 1, mm! - 1, dd!);
  return Math.round((cand - todayMs) / 86_400_000);
}
