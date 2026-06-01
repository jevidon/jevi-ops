import Link from 'next/link';
import { ScreenHeader } from '@/components/ScreenHeader';
import { healthApi, ApiError, type HealthOverview } from '@/lib/api';
import { getAppTimezone } from '@/lib/app-settings';
import { HealthTabBar } from './health-tab-bar';

// /health — landing dashboard. Pulls the overview snapshot in one call
// (the API stitches the last-of-each into a single response) and lays
// out latest vitals + recent labs + upcoming visits + active meds +
// the most recent check-in.

export default async function HealthOverviewPage() {
  const tz = await getAppTimezone();
  let overview: HealthOverview | null = null;
  let errorMessage: string | null = null;
  try {
    overview = await healthApi.overview();
  } catch (err) {
    errorMessage = err instanceof ApiError ? `API ${err.status}` : (err as Error).message;
  }

  return (
    <div>
      <ScreenHeader eyebrow="Personal record" title="Health" meta="Overview" />
      <div className="hairline" />
      <HealthTabBar />

      {errorMessage && (
        <div className="px-5 lg:px-0 mt-4 font-sans text-[13px] text-accent">{errorMessage}</div>
      )}

      {overview && (
        <div className="px-5 lg:px-0 mt-6 grid grid-cols-1 lg:grid-cols-2 gap-x-12 gap-y-8">
          <VitalsCard overview={overview} tz={tz} />
          <CheckInCard overview={overview} tz={tz} />
          <LabsCard overview={overview} tz={tz} />
          <VisitsCard overview={overview} tz={tz} />
          <MedsCard overview={overview} />
        </div>
      )}

      {!overview && !errorMessage && (
        <div className="px-5 lg:px-0 mt-6 font-sans text-[13px] text-ink-3 italic">
          Loading your health snapshot…
        </div>
      )}
    </div>
  );
}

// Pull the most recent measurement of each metric out of the latest_vitals
// list. The endpoint returns the last 50 readings across known metrics;
// we group by metric and grab the freshest.
function latestByMetric(overview: HealthOverview): Record<string, HealthOverview['latest_vitals'][number]> {
  const out: Record<string, HealthOverview['latest_vitals'][number]> = {};
  for (const v of overview.latest_vitals) {
    if (!out[v.metric] || v.measured_at > out[v.metric]!.measured_at) {
      out[v.metric] = v;
    }
  }
  return out;
}

function VitalsCard({ overview, tz }: { overview: HealthOverview; tz: string }) {
  const latest = latestByMetric(overview);
  const items = [
    { key: 'weight', label: 'Weight' },
    { key: 'bp', label: 'Blood pressure' },
    { key: 'hr_resting', label: 'Resting HR' },
    { key: 'sleep_duration', label: 'Sleep' },
    { key: 'hrv_overnight', label: 'HRV' },
    { key: 'spo2_avg', label: 'SpO₂' },
  ];
  return (
    <section>
      <SectionHeading label="Latest vitals" href="/health/vitals" />
      <ul className="divide-y divide-line/40">
        {items.map((i) => {
          const v = latest[i.key];
          return (
            <li key={i.key} className="py-2.5 flex items-baseline justify-between gap-3">
              <span className="font-sans text-[13px] text-ink-2">{i.label}</span>
              {v ? (
                <span className="font-mono text-[12px] text-ink flex items-baseline gap-2">
                  <span>{formatMetricValue(i.key, v)}</span>
                  <span className="text-[10px] uppercase tracking-wider text-ink-3">
                    {sourceGlyph(v.source)} · {formatRelative(v.measured_at, tz)}
                  </span>
                </span>
              ) : (
                <span className="font-mono text-[10px] uppercase tracking-wider text-ink-3">none yet</span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function CheckInCard({ overview, tz }: { overview: HealthOverview; tz: string }) {
  const latest = overview.recent_check_ins[0];
  return (
    <section>
      <SectionHeading label="Recent check-ins" href="/health/check-ins" />
      {latest ? (
        <div>
          <div className="font-mono text-[10px] uppercase tracking-wider text-ink-3 mb-2">
            {formatRelative(latest.checked_in_at, tz)}
          </div>
          <div className="grid grid-cols-4 gap-3">
            <RatingBlock label="Mood" value={latest.mood} max={5} />
            <RatingBlock label="Energy" value={latest.energy} max={5} />
            <RatingBlock label="Sleep" value={latest.sleep_quality} max={5} />
            <RatingBlock label="Pain" value={latest.pain} max={10} />
          </div>
          {latest.notes && (
            <p className="mt-3 font-sans text-[13px] text-ink-2 leading-snug whitespace-pre-wrap">
              {latest.notes}
            </p>
          )}
        </div>
      ) : (
        <p className="font-sans text-[13px] text-ink-3 italic">
          No check-ins yet.{' '}
          <Link href="/health/check-ins" className="text-ink-2 underline hover:text-ink">
            Log one
          </Link>
          .
        </p>
      )}
    </section>
  );
}

function LabsCard({ overview, tz }: { overview: HealthOverview; tz: string }) {
  return (
    <section>
      <SectionHeading label="Recent labs" href="/health/labs" />
      {overview.recent_labs.length === 0 ? (
        <p className="font-sans text-[13px] text-ink-3 italic">No lab panels logged yet.</p>
      ) : (
        <ul className="divide-y divide-line/40">
          {overview.recent_labs.map((p) => {
            const flagged = p.results.filter((r) => r.flag).length;
            return (
              <li key={p.id} className="py-2.5">
                <Link href={`/health/labs/${p.id}`} className="block hover:opacity-80 transition-opacity">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-sans text-[14px] text-ink">{p.panel_name}</span>
                    <span className="font-mono text-[10px] uppercase tracking-wider text-ink-3">
                      {formatRelative(`${p.drawn_date}T12:00:00Z`, tz)}
                    </span>
                  </div>
                  <div className="font-mono text-[10px] uppercase tracking-wider text-ink-3 mt-0.5">
                    {p.results.length} result{p.results.length === 1 ? '' : 's'}
                    {flagged > 0 && (
                      <span className="text-accent"> · {flagged} flagged</span>
                    )}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function VisitsCard({ overview, tz }: { overview: HealthOverview; tz: string }) {
  return (
    <section>
      <SectionHeading label="Upcoming visits" href="/health/visits" />
      {overview.upcoming_visits.length === 0 ? (
        <p className="font-sans text-[13px] text-ink-3 italic">Nothing scheduled.</p>
      ) : (
        <ul className="divide-y divide-line/40">
          {overview.upcoming_visits.map((v) => (
            <li key={v.id} className="py-2.5">
              <Link href={`/health/visits/${v.id}`} className="block hover:opacity-80 transition-opacity">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-sans text-[14px] text-ink">
                    {v.provider_name ?? 'Visit'}
                  </span>
                  <span className="font-mono text-[10px] uppercase tracking-wider text-ink-3">
                    {formatRelative(`${v.visit_date}T12:00:00Z`, tz)}
                  </span>
                </div>
                {v.reason && (
                  <div className="font-mono text-[10px] uppercase tracking-wider text-ink-3 mt-0.5">
                    {v.reason}
                  </div>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function MedsCard({ overview }: { overview: HealthOverview }) {
  const byKind = new Map<string, typeof overview.active_medications>();
  for (const m of overview.active_medications) {
    const arr = byKind.get(m.kind) ?? [];
    arr.push(m);
    byKind.set(m.kind, arr);
  }
  const order = ['prescription', 'supplement', 'vitamin', 'otc'] as const;
  return (
    <section>
      <SectionHeading label="What I'm taking" href="/health/meds" />
      {overview.active_medications.length === 0 ? (
        <p className="font-sans text-[13px] text-ink-3 italic">Nothing logged yet.</p>
      ) : (
        <div className="space-y-3">
          {order.map((kind) => {
            const list = byKind.get(kind);
            if (!list || list.length === 0) return null;
            return (
              <div key={kind}>
                <div className="eyebrow mb-1">{kindLabel(kind)}</div>
                <ul className="divide-y divide-line/40">
                  {list.map((m) => (
                    <li key={m.id} className="py-2 flex items-baseline justify-between gap-3">
                      <span className="font-sans text-[13px] text-ink">{m.name}</span>
                      <span className="font-mono text-[10px] uppercase tracking-wider text-ink-3">
                        {[m.dosage, m.frequency].filter(Boolean).join(' · ')}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function SectionHeading({ label, href }: { label: string; href: string }) {
  return (
    <div className="eyebrow flex items-baseline justify-between border-b border-line pb-2 mb-3">
      <span>{label}</span>
      <Link href={href} className="font-mono text-[10px] uppercase tracking-wider text-ink-3 hover:text-ink-2 transition-colors">
        See all →
      </Link>
    </div>
  );
}

function RatingBlock({ label, value, max }: { label: string; value: number | null; max: number }) {
  if (value == null) {
    return (
      <div>
        <div className="font-serif text-[20px] text-ink-3 leading-none">—</div>
        <div className="font-mono text-[10px] uppercase tracking-wider text-ink-3 mt-1">{label}</div>
      </div>
    );
  }
  return (
    <div>
      <div className="font-serif text-[24px] text-ink leading-none">
        {value}<span className="text-[14px] text-ink-3"> / {max}</span>
      </div>
      <div className="font-mono text-[10px] uppercase tracking-wider text-ink-3 mt-1">{label}</div>
    </div>
  );
}

function formatMetricValue(metric: string, m: HealthOverview['latest_vitals'][number]): string {
  if (metric === 'bp' && m.value != null && m.value_secondary != null) {
    return `${m.value}/${m.value_secondary} ${m.unit ?? 'mmHg'}`;
  }
  if (metric === 'sleep_duration' && m.value != null) {
    const h = Math.floor(m.value / 60);
    const mn = Math.round(m.value % 60);
    return `${h}h ${mn}m`;
  }
  return m.value != null ? `${m.value}${m.unit ? ' ' + m.unit : ''}` : '—';
}

function sourceGlyph(source: HealthOverview['latest_vitals'][number]['source']): string {
  if (source === 'garmin') return '⌚ garmin';
  if (source === 'apple_health') return '🍎 apple';
  if (source === 'google_health') return 'google';
  if (source === 'whoop') return 'whoop';
  if (source === 'oura') return 'oura';
  return 'manual';
}

function kindLabel(kind: string): string {
  if (kind === 'prescription') return 'Prescription';
  if (kind === 'supplement') return 'Supplement';
  if (kind === 'vitamin') return 'Vitamin';
  if (kind === 'otc') return 'OTC';
  return kind;
}

function formatRelative(iso: string, tz: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  if (day === today) {
    return d.toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' });
  }
  const todayMs = new Date(today + 'T00:00:00Z').getTime();
  const dayMs = new Date(day + 'T00:00:00Z').getTime();
  const diffDays = Math.round((dayMs - todayMs) / 86_400_000);
  if (diffDays === -1) return 'yesterday';
  if (diffDays === 1) return 'tomorrow';
  if (diffDays > 1 && diffDays < 14) return `in ${diffDays}d`;
  if (diffDays < -1 && diffDays > -14) return `${Math.abs(diffDays)}d ago`;
  return d.toLocaleDateString('en-US', { timeZone: tz, month: 'short', day: 'numeric' });
}
