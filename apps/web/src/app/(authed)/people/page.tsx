import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ScreenHeader } from '@/components/ScreenHeader';
import { peopleApi, ApiError, type Person, type RelationshipType } from '@/lib/api';
import { PrefsPersist } from '@/components/PrefsPersist';

const RELATIONSHIP_FILTERS: Array<{ value: RelationshipType | 'all'; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'client', label: 'Clients' },
  { value: 'family', label: 'Family' },
  { value: 'church', label: 'Church' },
  { value: 'friend', label: 'Friends' },
  { value: 'team', label: 'Team' },
  { value: 'vendor', label: 'Vendors' },
  { value: 'other', label: 'Other' },
];

const RELATIONSHIP_LABELS: Record<RelationshipType, string> = {
  client: 'Client',
  family: 'Family',
  church: 'Church',
  friend: 'Friend',
  team: 'Team',
  vendor: 'Vendor',
  other: 'Other',
};

export default async function PeoplePage({
  searchParams,
}: {
  searchParams: Promise<{ relationship_type?: string }>;
}) {
  const params = await searchParams;

  // Restore last filter from cookies if URL has no params. Same
  // PrefsPersist pattern as the library pages.
  if (params.relationship_type === undefined) {
    const jar = await cookies();
    const saved = jar.get('people_relationship_type')?.value;
    const valid = saved && RELATIONSHIP_FILTERS.find((f) => f.value === saved) ? saved : undefined;
    if (valid && valid !== 'all') redirect(`/people?relationship_type=${valid}`);
  }

  const filter = (
    params.relationship_type && RELATIONSHIP_FILTERS.find((f) => f.value === params.relationship_type)
      ? params.relationship_type
      : 'all'
  ) as RelationshipType | 'all';

  let people: Person[] = [];
  let errorMessage: string | null = null;
  try {
    const opts: { relationship_type?: RelationshipType } = {};
    if (filter !== 'all') opts.relationship_type = filter;
    people = (await peopleApi.list(opts)).people;
  } catch (err) {
    errorMessage = err instanceof ApiError ? `API ${err.status}` : (err as Error).message;
  }

  const buildHref = (rel: RelationshipType | 'all') =>
    rel === 'all' ? '/people' : `/people?relationship_type=${rel}`;

  return (
    <div>
      <PrefsPersist cookiePrefix="people" paramNames={['relationship_type']} />
      <ScreenHeader
        eyebrow="People"
        title="Relationships"
        meta={`${people.length} ${people.length === 1 ? 'person' : 'people'}`}
      />
      <div className="hairline" />

      {/* Filter chips + Add link */}
      <div className="px-5 lg:px-0 pt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="eyebrow">Relationship</span>
        <div className="flex flex-wrap gap-1.5">
          {RELATIONSHIP_FILTERS.map((f) => (
            <Link
              key={f.value}
              href={buildHref(f.value as RelationshipType | 'all')}
              className={`px-2.5 py-1 border font-mono text-[10px] uppercase tracking-wider transition-colors ${
                filter === f.value
                  ? 'bg-ink text-bg border-ink'
                  : 'border-line text-ink-2 hover:border-ink-2 hover:text-ink'
              }`}
            >
              {f.label}
            </Link>
          ))}
        </div>
        <Link
          href="/people/new"
          className="ml-auto font-mono text-[11px] uppercase tracking-wider text-ink-3 hover:text-accent transition-colors"
        >
          + Add person
        </Link>
      </div>

      {errorMessage ? (
        <div className="px-5 lg:px-0 mt-6 font-sans text-[13px] text-ink-3">Error: {errorMessage}</div>
      ) : people.length === 0 ? (
        <div className="px-5 lg:px-0 mt-6 font-sans text-[13px] text-ink-3 italic">
          {filter === 'all'
            ? 'No people yet. Tap + Add person to start your CRM.'
            : `No ${RELATIONSHIP_LABELS[filter as RelationshipType].toLowerCase()}s yet.`}
        </div>
      ) : (
        <ul className="px-5 lg:px-0 mt-4">
          {people.map((p) => (
            <li key={p.id} className="py-3 border-b border-line/40">
              <Link
                href={`/people/${p.id}`}
                className="flex items-baseline justify-between gap-3 hover:opacity-80 transition-opacity"
              >
                <div className="flex-1 min-w-0">
                  <div className="font-serif text-[16px] text-ink">{p.name}</div>
                  <div className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-ink-3 flex flex-wrap gap-x-2">
                    {p.relationship_type && <span>{RELATIONSHIP_LABELS[p.relationship_type]}</span>}
                    {p.company && <span>· {p.company}</span>}
                    {p.email && <span>· {p.email}</span>}
                  </div>
                </div>
                <div className="font-mono text-[10px] uppercase tracking-wider text-ink-3 shrink-0">
                  {p.interaction_count ? `${p.interaction_count} log` : ''}
                  {p.interaction_count && p.fact_count ? ' · ' : ''}
                  {p.fact_count ? `${p.fact_count} fact${p.fact_count === 1 ? '' : 's'}` : ''}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
