import Link from 'next/link';
import { healthApi, type HealthOverview } from '@/lib/api';
import { PanelFrame, PanelLink } from '../PanelFrame';
import type { BriefingContext } from '../registry';

// Health — a compact snapshot from /api/health/overview (the endpoint built
// as a one-round-trip landing payload): latest key vitals, the next visit,
// flagged lab results, active medication count. Module-gated via the
// registry (health_module_enabled). Returns null when there's nothing to
// show, so a fresh install doesn't render an empty shell.

const VITAL_LABEL: Record<string, string> = {
  weight: 'Weight',
  bp: 'BP',
  hr_resting: 'Resting HR',
  hrv: 'HRV',
  spo2: 'SpO₂',
  sleep_duration: 'Sleep',
  sleep_score: 'Sleep score',
};

function vitalValue(v: HealthOverview['latest_vitals'][number]): string | null {
  if (v.value == null) return null;
  // BP carries systolic/diastolic as value/value_secondary.
  if (v.value_secondary != null) return `${v.value}/${v.value_secondary}${v.unit ? ` ${v.unit}` : ''}`;
  return `${v.value}${v.unit ? ` ${v.unit}` : ''}`;
}

export async function HealthPanel(_props: { ctx: BriefingContext }) {
  let overview: HealthOverview | null = null;
  try {
    overview = await healthApi.overview();
  } catch {
    /* panel degrades to nothing; the rest of the Briefing stands */
  }
  if (!overview) return null;

  const vitals = overview.latest_vitals
    .filter((v) => VITAL_LABEL[v.metric] && v.value != null)
    .slice(0, 4);
  const nextVisit = overview.upcoming_visits[0] ?? null;
  const flaggedLabs = overview.recent_labs
    .flatMap((p) => p.results.filter((r) => r.flag != null).map((r) => ({ panel: p, result: r })))
    .slice(0, 3);
  const medsCount = overview.active_medications.length;

  if (vitals.length === 0 && !nextVisit && flaggedLabs.length === 0 && medsCount === 0) return null;

  return (
    <PanelFrame eyebrow="Health" action={<PanelLink href="/health">Open →</PanelLink>}>
      {vitals.length > 0 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 pb-2 border-b border-line">
          {vitals.map((v) => (
            <Link key={v.id} href="/health/vitals" className="group inline-flex items-baseline gap-1.5">
              <span className="font-mono text-[10px] uppercase tracking-wider text-ink-3">{VITAL_LABEL[v.metric]}</span>
              <span className="font-mono text-[12px] text-ink tabular-nums group-hover:text-accent transition-colors">{vitalValue(v)}</span>
            </Link>
          ))}
        </div>
      )}
      {nextVisit && (
        <Link href={`/health/visits/${nextVisit.id}`} className="flex items-baseline gap-4 py-1.5 border-b border-line hover:opacity-80 transition-opacity">
          <span className="font-mono text-[11px] text-ink-3 tabular-nums shrink-0">{nextVisit.visit_date}</span>
          <span className="font-sans text-[13px] text-ink-2 truncate">
            {nextVisit.provider_name ?? 'Visit'}
            {nextVisit.reason && <span className="text-ink-3"> · {nextVisit.reason}</span>}
          </span>
        </Link>
      )}
      {flaggedLabs.map(({ panel, result }) => (
        <Link key={result.id} href={`/health/labs/${panel.id}`} className="flex items-baseline gap-4 py-1.5 border-b border-line hover:opacity-80 transition-opacity">
          <span className="font-mono text-[10px] uppercase tracking-wider text-warn shrink-0">{result.flag}</span>
          <span className="font-sans text-[13px] text-ink-2 truncate">{result.analyte} · {panel.panel_name}</span>
        </Link>
      ))}
      {medsCount > 0 && (
        <Link href="/health/meds" className="mt-2 inline-block font-mono text-[10px] uppercase tracking-wider text-ink-3 hover:text-accent transition-colors">
          {medsCount} active {medsCount === 1 ? 'medication' : 'medications'} →
        </Link>
      )}
    </PanelFrame>
  );
}
