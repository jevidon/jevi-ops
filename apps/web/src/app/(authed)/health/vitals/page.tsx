import { ScreenHeader } from '@/components/ScreenHeader';
import { healthApi, ApiError, type HealthMetric } from '@/lib/api';
import { getAppTimezone } from '@/lib/app-settings';
import { HealthTabBar } from '../health-tab-bar';
import { VitalForm } from './vital-form';
import { deleteMetricAction } from './actions';

export default async function VitalsPage() {
  const tz = await getAppTimezone();
  let metrics: HealthMetric[] = [];
  let errorMessage: string | null = null;
  try {
    const res = await healthApi.metrics.list({ limit: 500 });
    metrics = res.metrics;
  } catch (err) {
    errorMessage = err instanceof ApiError ? `API ${err.status}` : (err as Error).message;
  }

  // Group by metric so each metric's history is together — sorted by
  // measured_at descending (newest first) within each group.
  const grouped = new Map<string, HealthMetric[]>();
  for (const m of metrics) {
    const arr = grouped.get(m.metric) ?? [];
    arr.push(m);
    grouped.set(m.metric, arr);
  }
  const order = Array.from(grouped.keys()).sort();

  return (
    <div>
      <ScreenHeader eyebrow="Personal record" title="Vitals" meta={`${metrics.length} readings`} />
      <div className="hairline" />
      <HealthTabBar />

      <div className="px-5 lg:px-0">
        <VitalForm />

        {errorMessage && (
          <div className="mt-4 font-sans text-[13px] text-accent">{errorMessage}</div>
        )}

        {metrics.length === 0 ? (
          <div className="mt-8 font-sans text-[13px] text-ink-3 italic">No readings logged yet.</div>
        ) : (
          <div className="mt-8 space-y-8">
            {order.map((m) => (
              <MetricGroup key={m} metric={m} readings={grouped.get(m)!} tz={tz} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function MetricGroup({ metric, readings, tz }: { metric: string; readings: HealthMetric[]; tz: string }) {
  return (
    <section>
      <div className="eyebrow pb-2 border-b border-line mb-2 flex items-baseline justify-between">
        <span>{prettyMetric(metric)}</span>
        <span className="font-mono text-[10px] uppercase tracking-wider text-ink-3">
          {readings.length} reading{readings.length === 1 ? '' : 's'}
        </span>
      </div>
      <ul className="divide-y divide-line/40">
        {readings.slice(0, 20).map((r) => (
          <li key={r.id} className="py-2 flex items-baseline justify-between gap-3 group">
            <div className="flex items-baseline gap-3 min-w-0">
              <span className="font-serif text-[16px] text-ink tabular-nums">
                {formatValue(metric, r)}
              </span>
              {r.notes && (
                <span className="font-sans text-[12px] text-ink-3 truncate">{r.notes}</span>
              )}
            </div>
            <div className="flex items-baseline gap-2 shrink-0">
              <span className="font-mono text-[10px] uppercase tracking-wider text-ink-3">
                {sourceLabel(r.source)} · {formatDate(r.measured_at, tz)}
              </span>
              <form action={deleteMetricAction} className="opacity-0 group-hover:opacity-100 transition-opacity">
                <input type="hidden" name="id" value={r.id} />
                <button
                  type="submit"
                  aria-label="Delete reading"
                  className="font-mono text-[10px] uppercase tracking-wider text-ink-3 hover:text-accent transition-colors"
                >
                  ✕
                </button>
              </form>
            </div>
          </li>
        ))}
        {readings.length > 20 && (
          <li className="py-2 font-mono text-[10px] uppercase tracking-wider text-ink-3">
            + {readings.length - 20} older readings (charts in Session 2)
          </li>
        )}
      </ul>
    </section>
  );
}

function prettyMetric(m: string): string {
  const map: Record<string, string> = {
    weight: 'Weight',
    bp: 'Blood pressure',
    hr_resting: 'Resting heart rate',
    hr_avg: 'Average heart rate',
    hr_max: 'Max heart rate',
    sleep_duration: 'Sleep duration',
    sleep_score: 'Sleep score',
    stress_avg: 'Stress (avg)',
    body_battery_low: 'Body battery (low)',
    body_battery_high: 'Body battery (high)',
    spo2_avg: 'SpO₂ (avg)',
    respiration_rate: 'Respiration rate',
    hrv_overnight: 'HRV (overnight)',
    vo2_max: 'VO₂ max',
    steps: 'Steps',
    calories_burned: 'Calories burned',
    intensity_minutes: 'Intensity minutes',
    temperature: 'Temperature',
    glucose: 'Glucose',
  };
  return map[m] ?? m;
}

function formatValue(metric: string, r: HealthMetric): string {
  if (metric === 'bp' && r.value != null && r.value_secondary != null) {
    return `${r.value}/${r.value_secondary} ${r.unit ?? 'mmHg'}`;
  }
  if (metric === 'sleep_duration' && r.value != null) {
    const h = Math.floor(r.value / 60);
    const mn = Math.round(r.value % 60);
    return `${h}h ${mn}m`;
  }
  return r.value != null ? `${r.value}${r.unit ? ' ' + r.unit : ''}` : (r.notes ? '—' : '');
}

function sourceLabel(s: string): string {
  if (s === 'manual') return 'manual';
  if (s === 'garmin') return '⌚ garmin';
  return s;
}

function formatDate(iso: string, tz: string): string {
  return new Date(iso).toLocaleString('en-US', {
    timeZone: tz, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}
