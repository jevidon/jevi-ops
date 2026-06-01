import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ScreenHeader } from '@/components/ScreenHeader';
import { healthApi, ApiError, type HealthVisit, type HealthMetric, type LabPanel } from '@/lib/api';
import { getAppTimezone } from '@/lib/app-settings';
import { HealthTabBar } from '../../health-tab-bar';
import { VisitForm } from '../visit-form';

export default async function VisitDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tz = await getAppTimezone();

  let visit: HealthVisit | null = null;
  let metrics: HealthMetric[] = [];
  let panels: LabPanel[] = [];
  let errorMessage: string | null = null;

  try {
    const detail = await healthApi.visits.get(id);
    visit = detail.visit;
    metrics = detail.metrics;
    panels = detail.panels;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    errorMessage = err instanceof ApiError ? `API ${err.status}` : (err as Error).message;
  }

  if (!visit) {
    return (
      <div>
        <ScreenHeader eyebrow="Visit" title="—" />
        <div className="hairline" />
        <div className="px-5 lg:px-0 mt-6 font-sans text-[13px] text-ink-3">
          {errorMessage ?? 'Visit not found.'}
        </div>
      </div>
    );
  }

  const dateLabel = new Date(`${visit.visit_date}T12:00:00Z`).toLocaleDateString('en-US', {
    timeZone: tz, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });

  return (
    <div>
      <div className="px-5 lg:px-0 pt-4 pb-1 font-mono text-[10px] uppercase tracking-wider text-ink-3">
        <Link href="/health/visits" className="hover:text-ink-2 transition-colors">
          ← Visits
        </Link>
      </div>
      <ScreenHeader
        eyebrow={visit.visit_type ?? 'Visit'}
        title={visit.provider_name ?? '(no provider)'}
        meta={dateLabel}
      />
      <div className="hairline" />
      <HealthTabBar />

      <div className="px-5 lg:px-0 mt-4 space-y-6 max-w-3xl">
        {visit.reason && <Block label="Reason" body={visit.reason} />}
        {visit.assessment && <Block label="Assessment" body={visit.assessment} />}
        {visit.plan && <Block label="Plan" body={visit.plan} />}
        {visit.notes && <Block label="Notes" body={visit.notes} />}

        {metrics.length > 0 && (
          <section>
            <div className="eyebrow pb-2 border-b border-line mb-2">Vitals taken at this visit</div>
            <ul className="divide-y divide-line/40">
              {metrics.map((m) => (
                <li key={m.id} className="py-2 flex items-baseline justify-between gap-3">
                  <span className="font-sans text-[14px] text-ink">{m.metric}</span>
                  <span className="font-mono text-[12px] text-ink-2">
                    {m.value}{m.value_secondary != null ? `/${m.value_secondary}` : ''}{m.unit ? ` ${m.unit}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {panels.length > 0 && (
          <section>
            <div className="eyebrow pb-2 border-b border-line mb-2">Labs from this visit</div>
            <ul className="divide-y divide-line/40">
              {panels.map((p) => (
                <li key={p.id} className="py-2">
                  <Link
                    href={`/health/labs/${p.id}`}
                    className="font-sans text-[14px] text-ink-2 hover:text-ink transition-colors"
                  >
                    {p.panel_name}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="mt-8">
          <details className="border border-line">
            <summary className="cursor-pointer px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-ink-3 hover:text-ink-2 transition-colors list-none">
              Edit visit ▾
            </summary>
            <div className="px-4 pb-4 pt-3 border-t border-line">
              <VisitForm
                initial={{
                  id: visit.id,
                  visit_date: visit.visit_date,
                  provider_name: visit.provider_name ?? '',
                  provider_specialty: visit.provider_specialty ?? '',
                  visit_type: visit.visit_type ?? '',
                  reason: visit.reason ?? '',
                  assessment: visit.assessment ?? '',
                  plan: visit.plan ?? '',
                  notes: visit.notes ?? '',
                  follow_up_date: visit.follow_up_date ?? '',
                }}
              />
            </div>
          </details>
        </section>
      </div>
    </div>
  );
}

function Block({ label, body }: { label: string; body: string }) {
  return (
    <section>
      <div className="eyebrow mb-1">{label}</div>
      <p className="font-sans text-[14px] text-ink leading-relaxed whitespace-pre-wrap">{body}</p>
    </section>
  );
}
