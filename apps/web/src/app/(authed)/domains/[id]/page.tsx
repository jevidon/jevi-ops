import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ScreenHeader } from '@/components/ScreenHeader';
import { domainsApi, ApiError } from '@/lib/api';
import type { Domain } from '@jerad-ops/shared';
import { EditDomainForm } from './edit-domain-form';

// /domains/[id] — domain detail + edit. Failure patterns are read-only here
// (advanced JSON editing belongs in a separate UI) but get shown so you can
// see what observations are watching for in this domain.

export default async function DomainDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let domain: Domain | null = null;
  let errorMessage: string | null = null;

  try {
    domain = await domainsApi.get(id);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    errorMessage = err instanceof ApiError ? `API ${err.status}` : (err as Error).message;
  }

  if (!domain) {
    return (
      <div>
        <ScreenHeader eyebrow="Domain" title="—" />
        <div className="hairline" />
        <div className="px-5 lg:px-0 mt-6 font-sans text-[13px] text-ink-3">
          {errorMessage ?? 'Domain not found.'}
        </div>
      </div>
    );
  }

  const patternCount = Array.isArray(domain.failure_patterns)
    ? domain.failure_patterns.length
    : 0;

  return (
    <div>
      <div className="px-5 lg:px-0 pt-4 pb-1 font-mono text-[10px] uppercase tracking-wider text-ink-3">
        <Link href="/domains" className="hover:text-ink-2 transition-colors">
          ← Domains
        </Link>
      </div>

      <ScreenHeader
        eyebrow={domain.active ? 'Domain' : 'Domain · inactive'}
        title={domain.name}
        meta={`${patternCount} failure ${patternCount === 1 ? 'pattern' : 'patterns'} watched`}
      />
      <div className="hairline mb-6" />

      <div className="px-5 lg:px-0 max-w-2xl">
        <EditDomainForm
          initial={{
            id: domain.id,
            name: domain.name,
            description: domain.description ?? '',
            fruit_definition: domain.fruit_definition ?? '',
            expected_cadence: domain.expected_cadence ?? '',
            active: domain.active,
          }}
        />

        {/* Read-only failure patterns view */}
        {patternCount > 0 && (
          <div className="mt-12 pt-6 border-t border-line">
            <div className="eyebrow mb-3">Failure patterns (read-only)</div>
            <p className="font-sans text-[12px] text-ink-3 mb-3 leading-relaxed">
              The observations cron evaluates these rules against this domain. Edit via SQL
              for now — a dedicated UI is on the roadmap.
            </p>
            <pre className="font-mono text-[11px] text-ink-2 bg-surface border border-line p-3 overflow-auto">
              {JSON.stringify(domain.failure_patterns, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
