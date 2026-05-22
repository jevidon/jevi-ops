import { ScreenHeader } from '@/components/ScreenHeader';
import { EmptyState } from '@/components/EmptyState';
import { domainsApi, ApiError } from '@/lib/api';
import type { Domain } from '@jerad-ops/shared';

// Server component — pulls the six seeded domains from the Fastify API
// (which talks to Supabase with RLS scoped to the signed-in user).

export default async function DomainsPage() {
  let domains: Domain[] = [];
  let errorMessage: string | null = null;

  try {
    const res = await domainsApi.list();
    domains = res.domains;
  } catch (err) {
    if (err instanceof ApiError) {
      errorMessage = `API error (${err.status})`;
    } else {
      errorMessage = (err as Error).message;
    }
  }

  return (
    <div>
      <ScreenHeader
        eyebrow="Six areas"
        title="Domains"
        meta="Higher-level groupings above projects"
      />
      <div className="hairline" />

      {errorMessage ? (
        <EmptyState
          title="Couldn't load domains"
          body={errorMessage}
        />
      ) : domains.length === 0 ? (
        <EmptyState
          title="No domains yet"
          body="Run the 0002_seed_domains.sql migration to add the six functional domains."
        />
      ) : (
        <ul>
          {domains.map((d) => (
            <DomainRow key={d.id} domain={d} />
          ))}
        </ul>
      )}
    </div>
  );
}

function DomainRow({ domain }: { domain: Domain }) {
  const patternCount = Array.isArray(domain.failure_patterns)
    ? domain.failure_patterns.length
    : 0;

  return (
    <li className="px-5 py-5 border-b border-line">
      <div className="font-serif text-[20px] text-ink leading-tight">{domain.name}</div>

      {domain.fruit_definition && (
        <div className="mt-1 font-sans text-[13px] text-ink-2 leading-relaxed">
          {domain.fruit_definition}
        </div>
      )}

      {domain.expected_cadence && (
        <div className="mt-2 font-mono text-[10px] uppercase tracking-wider text-ink-3">
          Cadence · {domain.expected_cadence}
        </div>
      )}

      <div className="mt-1 font-mono text-[10px] uppercase tracking-wider text-ink-3">
        {patternCount} failure {patternCount === 1 ? 'pattern' : 'patterns'} watched
      </div>
    </li>
  );
}
