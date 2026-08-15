import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  DetailHeader, CrumbDot, ActionButton, StatStrip, Stat, DetailBody, DetailSection, RailBlock,
} from '@/components/detail/DetailShell';
import { EditDrawer } from '@/components/detail/EditDrawer';
import {
  peopleApi, ApiError,
  type PersonDetail, type PersonFact, type PersonFactType, type PersonInteraction,
} from '@/lib/api';
import { getAppTimezone } from '@/lib/app-settings';
import { todayIsoDate } from '@/lib/today';
import { PersonForm } from '../person-form';
import { FactForm } from './fact-form';
import { deleteFactAction } from './fact-actions';
import { InteractionForm } from './interaction-form';
import { deleteInteractionAction } from './interaction-actions';

// /people/[id] — person detail (Detail Pages v2, Addendum 10 §9, adapted to
// this fork's model). Answers three questions warmly: when did we last
// connect · what's coming · what do I know about them. This fork logs
// person_interactions (type + notes + when) rather than upstream's CRM
// conversations, so there is no follow-up nag — recency is display only.
// Capture (+ Interaction / + Fact) stays on the page; configuration lives
// behind the Edit drawer.

const RELATIONSHIP_LABELS: Record<string, string> = {
  client: 'Client', family: 'Family', church: 'Church', friend: 'Friend', team: 'Team', vendor: 'Vendor', other: 'Other',
};
const FACT_LABELS: Record<PersonFactType, string> = {
  anniversary: 'Anniversary', birthday: 'Birthday', kid_name: 'Kid', shared: 'Shared', follow_up: 'Follow-up', other: 'Other',
};
const INTERACTION_LABELS: Record<string, string> = {
  email: 'Email', call: 'Call', in_person: 'In person', text: 'Text', meeting: 'Meeting', other: 'Other',
};
const UPCOMING_WINDOW = 30;
const IMMINENT_DAYS = 7; // within a week reads accent; further out stays calm

export default async function PersonDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tz = await getAppTimezone();
  const today = todayIsoDate(tz);

  let detail: PersonDetail | null = null;
  let errorMessage: string | null = null;
  try {
    detail = await peopleApi.get(id);
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

  const { person, facts, interactions, notes, projects } = detail;
  const firstName = person.name.split(' ')[0];

  // Recency — from the most recent interaction. Display only; never a nag.
  const sorted = [...interactions].sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
  const latest = sorted[0] ?? null;
  const daysSince = latest ? daysAgoFrom(latest.occurred_at, tz, today) : null;
  const sparse = interactions.length >= 1 && interactions.length <= 3;

  // Coming up — dated facts within a 30-day window, nearest first (birthday /
  // anniversary live in facts in this fork, recurring annually).
  const upcoming = buildUpcoming(facts, today, tz);
  const nextUp = upcoming[0] ?? null;

  return (
    <div>
      <DetailHeader
        crumb={
          <>
            <Link href="/people" className="hover:text-ink-2 transition-colors">People</Link>
            {person.relationship_type && (<><CrumbDot /><span>{RELATIONSHIP_LABELS[person.relationship_type]}</span></>)}
            {person.company && (<><CrumbDot /><span>{person.company}</span></>)}
          </>
        }
        name={person.name}
        actions={
          <>
            <ActionButton href="#interactions">＋ Interaction</ActionButton>
            <ActionButton href="#facts">＋ Fact</ActionButton>
            <EditDrawer title="Edit person">
              <PersonForm
                initial={{
                  id: person.id,
                  name: person.name,
                  relationship_type: person.relationship_type ?? '',
                  email: person.email ?? '',
                  phone: person.phone ?? '',
                  company: person.company ?? '',
                  notes: person.notes ?? '',
                }}
              />
            </EditDrawer>
          </>
        }
        below={
          <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] uppercase tracking-[0.05em] text-ink-3">
            <span>{latest ? `Last interaction · ${daysSince != null && daysSince <= 0 ? 'today' : `${daysSince}d ago`}` : 'No interactions yet'}</span>
            {nextUp && nextUp.days <= IMMINENT_DAYS && (
              <span className="text-accent">· {nextUp.label} {nextUp.days === 0 ? 'today' : `in ${nextUp.days}d`}</span>
            )}
          </div>
        }
      />

      <StatStrip>
        <Stat label="Last connected"
          value={daysSince == null ? '—' : daysSince <= 0 ? 'Today' : `${daysSince}`}
          unit={daysSince != null && daysSince > 0 ? (daysSince === 1 ? 'day ago' : 'days ago') : undefined}
          sub={daysSince == null ? 'no history yet' : `${interactions.length} logged`} />
        <Stat label="Coming up"
          value={nextUp ? (nextUp.days === 0 ? 'Today' : `${nextUp.days}`) : '—'}
          unit={nextUp && nextUp.days > 0 ? (nextUp.days === 1 ? 'day' : 'days') : undefined}
          sub={nextUp ? nextUp.label : 'nothing soon'} />
        <Stat label="Interactions" value={interactions.length} sub={interactions.length ? 'logged' : 'none yet'} />
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

            <section id="interactions" className={upcoming.length > 0 ? 'mt-8' : ''}>
              <DetailSection label="Interactions" count={interactions.length > 0 ? interactions.length : undefined} className="mt-0">
                {sparse && latest && (
                  <div className="mb-5 pb-5 border-b border-line">
                    <div className="font-mono text-[10px] uppercase tracking-wider text-ink-3 flex flex-wrap gap-x-2">
                      <span>{fmtShort(latest.occurred_at, tz)}</span>
                      <span>· {INTERACTION_LABELS[latest.interaction_type] ?? latest.interaction_type}</span>
                    </div>
                    {latest.notes && <p className="mt-2 font-serif text-[19px] leading-[1.5] text-ink-2 whitespace-pre-wrap">{latest.notes}</p>}
                  </div>
                )}
                <ul>
                  {(sparse && latest ? sorted.slice(1) : sorted).map((it) => (
                    <InteractionRow key={it.id} personId={person.id} interaction={it} tz={tz} />
                  ))}
                </ul>
                <InteractionForm personId={person.id} />
              </DetailSection>
            </section>

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
                <FactForm personId={person.id} />
              </RailBlock>
            </div>

            <RailBlock label="Details">
              {person.company && <KV k="Company" v={person.company} />}
              {person.email && <KV k="Email" v={<a href={`mailto:${person.email}`} className="hover:text-accent transition-colors break-all">{person.email}</a>} />}
              {person.phone && <KV k="Phone" v={<a href={`tel:${person.phone}`} className="hover:text-accent transition-colors">{person.phone}</a>} />}
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

function InteractionRow({ personId, interaction, tz }: { personId: string; interaction: PersonInteraction; tz: string }) {
  return (
    <li className="py-3 border-b border-line/40 group">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-mono text-[10px] uppercase tracking-wider text-ink-3">
          {fmtShort(interaction.occurred_at, tz)} · {INTERACTION_LABELS[interaction.interaction_type] ?? interaction.interaction_type}
        </span>
        <form action={deleteInteractionAction} className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          <input type="hidden" name="person_id" value={personId} />
          <input type="hidden" name="interaction_id" value={interaction.id} />
          <button type="submit" aria-label="Delete interaction" className="font-mono text-[9px] uppercase tracking-wider text-ink-3 hover:text-accent transition-colors">✕</button>
        </form>
      </div>
      {interaction.notes && (
        <p className="mt-0.5 font-sans text-[13.5px] text-ink-2 leading-relaxed whitespace-pre-wrap">{interaction.notes}</p>
      )}
    </li>
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

// ─── upcoming (dated facts within the window; recurring = annual) ─────────────
interface Upcoming { key: string; label: string; value: string; days: number; dateLabel: string }

function buildUpcoming(facts: PersonFact[], today: string, tz: string): Upcoming[] {
  const out: Upcoming[] = [];
  for (const f of facts) {
    if (!f.date_relevant) continue;
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

// ─── date helpers (app-tz, no instant→UTC shift) ─────────────────────────────
function fmtShort(iso: string, tz: string): string {
  const d = iso.length === 10 ? new Date(`${iso}T12:00:00Z`) : new Date(iso);
  return d.toLocaleDateString('en-US', { timeZone: tz, month: 'short', day: 'numeric' });
}
function daysAgoFrom(iso: string, tz: string, todayYmd: string): number {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
  return Math.round((Date.parse(`${todayYmd}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / 86_400_000);
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
