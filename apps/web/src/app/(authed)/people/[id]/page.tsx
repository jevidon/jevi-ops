import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ScreenHeader } from '@/components/ScreenHeader';
import {
  peopleApi,
  ApiError,
  type PersonDetail,
  type PersonFact,
  type PersonFactType,
  type PersonInteraction,
  type PersonInteractionType,
} from '@/lib/api';
import { PersonForm } from '../person-form';
import { FactForm } from './fact-form';
import { InteractionForm } from './interaction-form';
import { deleteFactAction } from './fact-actions';
import { deleteInteractionAction } from './interaction-actions';
import { getAppTimezone } from '@/lib/app-settings';

// /people/[id] — person detail. Layout mirrors content/project detail:
//   Header (name + relationship + contact)
//   Facts (birthday, kids, anniversaries, follow-ups)
//   Interactions (chronological log)
//   Related notes (notes.related_person_id)
//   Related projects (projects.client_id)
//   Edit form (collapsed by default; danger zone for delete)

const RELATIONSHIP_LABELS: Record<string, string> = {
  client: 'Client',
  family: 'Family',
  church: 'Church',
  friend: 'Friend',
  team: 'Team',
  vendor: 'Vendor',
  other: 'Other',
};

const FACT_LABELS: Record<PersonFactType, string> = {
  anniversary: 'Anniversary',
  birthday: 'Birthday',
  kid_name: 'Kid',
  shared: 'Shared',
  follow_up: 'Follow-up',
  other: 'Other',
};

const INTERACTION_LABELS: Record<PersonInteractionType, string> = {
  email: 'Email',
  call: 'Call',
  in_person: 'In person',
  text: 'Text',
  meeting: 'Meeting',
  other: 'Other',
};

export default async function PersonDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const tz = await getAppTimezone();

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
      <div>
        <ScreenHeader eyebrow="Person" title="—" />
        <div className="hairline" />
        <div className="px-5 lg:px-0 mt-6 font-sans text-[13px] text-ink-3">
          {errorMessage ?? 'Person not found.'}
        </div>
      </div>
    );
  }

  const { person, facts, interactions, notes, projects } = detail;
  const metaBits = [
    person.relationship_type ? RELATIONSHIP_LABELS[person.relationship_type] : null,
    person.company,
  ].filter(Boolean);

  return (
    <div>
      <div className="px-5 lg:px-0 pt-4 pb-1 font-mono text-[10px] uppercase tracking-wider text-ink-3">
        <Link href="/people" className="hover:text-ink-2 transition-colors">
          ← People
        </Link>
      </div>

      <ScreenHeader
        eyebrow={metaBits.join(' · ') || 'Person'}
        title={person.name}
      />
      <div className="hairline" />

      {/* Contact strip */}
      {(person.email || person.phone) && (
        <div className="px-5 lg:px-0 pt-4 flex flex-wrap gap-x-5 gap-y-2 font-mono text-[10px] uppercase tracking-wider text-ink-3">
          {person.email && (
            <a href={`mailto:${person.email}`} className="hover:text-accent transition-colors">
              ↗ {person.email}
            </a>
          )}
          {person.phone && (
            <a href={`tel:${person.phone}`} className="hover:text-accent transition-colors">
              ☎ {person.phone}
            </a>
          )}
        </div>
      )}

      {person.notes && (
        <div className="px-5 lg:px-0 mt-4 max-w-2xl">
          <div className="font-sans text-[14px] text-ink-2 leading-relaxed whitespace-pre-wrap">
            {person.notes}
          </div>
        </div>
      )}

      <div className="px-5 lg:px-0 max-w-2xl">
        {/* ── Facts ─────────────────────────────────────────────────── */}
        <Section label={`Facts · ${facts.length}`}>
          {facts.length === 0 ? (
            <p className="font-sans text-[13px] text-ink-3 italic py-1">
              No facts yet. Add birthdays, kids' names, follow-ups — the kind of
              thing you'd otherwise forget.
            </p>
          ) : (
            <ul>
              {facts.map((f) => (
                <FactRow key={f.id} personId={person.id} fact={f} tz={tz} />
              ))}
            </ul>
          )}
          <FactForm personId={person.id} />
        </Section>

        {/* ── Interactions ──────────────────────────────────────────── */}
        <Section label={`Interactions · ${interactions.length}`}>
          {interactions.length === 0 ? (
            <p className="font-sans text-[13px] text-ink-3 italic py-1">
              No interactions logged. Use the form below or say{' '}
              <span className="font-mono">log a call with {person.name} about…</span>
            </p>
          ) : (
            <ul>
              {interactions.map((i) => (
                <InteractionRow key={i.id} personId={person.id} interaction={i} tz={tz} />
              ))}
            </ul>
          )}
          <InteractionForm personId={person.id} />
        </Section>

        {/* ── Related notes ─────────────────────────────────────────── */}
        {notes.length > 0 && (
          <Section label={`Notes mentioning ${person.name.split(' ')[0]} · ${notes.length}`}>
            <ul>
              {notes.map((n) => (
                <li key={n.id} className="py-2 border-b border-line/40">
                  <Link href={`/library/notes/${n.id}`} className="block hover:opacity-80 transition-opacity">
                    {n.title && (
                      <div className="font-serif text-[15px] text-ink leading-tight">{n.title}</div>
                    )}
                    <div className="font-sans text-[13px] text-ink-2 leading-snug line-clamp-2">
                      {n.body}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* ── Related projects (client_id) ──────────────────────────── */}
        {projects.length > 0 && (
          <Section label={`Projects · ${projects.length}`}>
            <ul className="space-y-1">
              {projects.map((p) => (
                <li key={p.id}>
                  <Link
                    href={`/projects/${p.id}`}
                    className="flex items-baseline gap-3 py-1.5 hover:opacity-80 transition-opacity"
                  >
                    {p.color && (
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: p.color }} aria-hidden />
                    )}
                    <span className="font-sans text-[14px] text-ink">{p.name}</span>
                    <span className="font-mono text-[10px] uppercase tracking-wider text-ink-3">
                      {p.status}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* ── Edit (collapsed) + delete ─────────────────────────────── */}
        <section className="mt-12">
          <details className="border border-line">
            <summary className="cursor-pointer px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-ink-3 hover:text-ink-2 transition-colors list-none">
              Edit person ▾
            </summary>
            <div className="px-4 pb-4 pt-3 border-t border-line">
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
            </div>
          </details>
        </section>
      </div>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="pt-6">
      <div className="eyebrow pb-2 border-b border-line mb-3">{label}</div>
      {children}
    </section>
  );
}

function FactRow({ personId, fact, tz }: { personId: string; fact: PersonFact; tz: string }) {
  const dateLabel = fact.date_relevant
    ? new Date(fact.date_relevant + 'T12:00:00Z').toLocaleDateString('en-US', {
        timeZone: tz,
        month: 'short',
        day: 'numeric',
        ...(fact.recurring ? {} : { year: 'numeric' }),
      })
    : null;
  return (
    <li className="flex items-baseline gap-3 py-1.5 border-b border-line/40 last:border-b-0 group">
      <span className="font-mono text-[10px] uppercase tracking-wider text-ink-3 w-20 shrink-0">
        {FACT_LABELS[fact.fact_type]}
      </span>
      <span className="flex-1 font-sans text-[14px] text-ink">{fact.fact_value}</span>
      {dateLabel && (
        <span className="font-mono text-[10px] uppercase tracking-wider text-ink-3 shrink-0">
          {dateLabel}
          {fact.recurring && ' · recurs'}
        </span>
      )}
      <form
        action={deleteFactAction}
        className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <input type="hidden" name="person_id" value={personId} />
        <input type="hidden" name="fact_id" value={fact.id} />
        <button
          type="submit"
          aria-label="Delete fact"
          className="font-mono text-[10px] uppercase tracking-wider text-ink-3 hover:text-accent transition-colors"
        >
          ✕
        </button>
      </form>
    </li>
  );
}

function InteractionRow({
  personId,
  interaction,
  tz,
}: {
  personId: string;
  interaction: PersonInteraction;
  tz: string;
}) {
  const when = new Date(interaction.occurred_at).toLocaleString('en-US', {
    timeZone: tz,
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
  return (
    <li className="flex items-start gap-4 py-2.5 border-b border-line/40 last:border-b-0 group">
      <span className="font-mono text-[10px] uppercase tracking-wider text-ink-3 w-24 pt-1 shrink-0">
        {when}
      </span>
      <div className="flex-1 min-w-0">
        <div className="font-mono text-[10px] uppercase tracking-wider text-accent mb-0.5">
          {INTERACTION_LABELS[interaction.interaction_type]}
        </div>
        {interaction.notes && (
          <div className="font-sans text-[13px] text-ink leading-snug whitespace-pre-wrap">
            {interaction.notes}
          </div>
        )}
      </div>
      <form
        action={deleteInteractionAction}
        className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <input type="hidden" name="person_id" value={personId} />
        <input type="hidden" name="interaction_id" value={interaction.id} />
        <button
          type="submit"
          aria-label="Delete entry"
          className="font-mono text-[10px] uppercase tracking-wider text-ink-3 hover:text-accent transition-colors pt-1"
        >
          ✕
        </button>
      </form>
    </li>
  );
}
