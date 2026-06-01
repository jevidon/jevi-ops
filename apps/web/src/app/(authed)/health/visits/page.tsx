import Link from 'next/link';
import { ScreenHeader } from '@/components/ScreenHeader';
import { healthApi, ApiError, type HealthVisit } from '@/lib/api';
import { getAppTimezone } from '@/lib/app-settings';
import { HealthTabBar } from '../health-tab-bar';

export default async function VisitsListPage() {
  const tz = await getAppTimezone();
  let visits: HealthVisit[] = [];
  let errorMessage: string | null = null;
  try {
    const res = await healthApi.visits.list();
    visits = res.visits;
  } catch (err) {
    errorMessage = err instanceof ApiError ? `API ${err.status}` : (err as Error).message;
  }

  const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const upcoming = visits.filter((v) => v.visit_date >= today);
  const past = visits.filter((v) => v.visit_date < today);

  return (
    <div>
      <ScreenHeader eyebrow="Personal record" title="Visits" meta={`${visits.length} total`} />
      <div className="hairline" />
      <HealthTabBar />

      <div className="px-5 lg:px-0 mt-4 flex justify-end">
        <Link
          href="/health/visits/new"
          className="font-mono text-[11px] uppercase tracking-wider text-ink-3 hover:text-accent transition-colors"
        >
          + Add visit
        </Link>
      </div>

      {errorMessage && (
        <div className="px-5 lg:px-0 mt-4 font-sans text-[13px] text-accent">{errorMessage}</div>
      )}

      <div className="px-5 lg:px-0 mt-4 space-y-8">
        {upcoming.length > 0 && (
          <Section label={`Upcoming · ${upcoming.length}`} visits={upcoming} tz={tz} />
        )}
        {past.length > 0 && (
          <Section label={`Past · ${past.length}`} visits={past} tz={tz} />
        )}
        {visits.length === 0 && !errorMessage && (
          <div className="font-sans text-[13px] text-ink-3 italic">No visits logged yet.</div>
        )}
      </div>
    </div>
  );
}

function Section({ label, visits, tz }: { label: string; visits: HealthVisit[]; tz: string }) {
  return (
    <section>
      <div className="eyebrow pb-2 border-b border-line">{label}</div>
      <ul className="divide-y divide-line/40">
        {visits.map((v) => (
          <li key={v.id} className="py-3">
            <Link href={`/health/visits/${v.id}`} className="block hover:opacity-80 transition-opacity">
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-sans text-[15px] text-ink">
                  {v.provider_name ?? '(no provider)'}
                  {v.visit_type && (
                    <span className="ml-2 font-mono text-[10px] uppercase tracking-wider text-ink-3">
                      {v.visit_type}
                    </span>
                  )}
                </span>
                <span className="font-mono text-[10px] uppercase tracking-wider text-ink-3">
                  {formatDate(v.visit_date, tz)}
                </span>
              </div>
              {(v.reason || v.assessment) && (
                <p className="mt-1 font-sans text-[13px] text-ink-2 line-clamp-2">
                  {v.reason || v.assessment}
                </p>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function formatDate(iso: string, tz: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', {
    timeZone: tz, weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
  });
}
