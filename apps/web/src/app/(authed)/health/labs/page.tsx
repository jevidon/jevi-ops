import Link from 'next/link';
import { ScreenHeader } from '@/components/ScreenHeader';
import { healthApi, ApiError, type LabPanel } from '@/lib/api';
import { getAppTimezone } from '@/lib/app-settings';
import { HealthTabBar } from '../health-tab-bar';

export default async function LabsListPage() {
  const tz = await getAppTimezone();
  let panels: LabPanel[] = [];
  let errorMessage: string | null = null;
  try {
    const res = await healthApi.labs.listPanels();
    panels = res.panels;
  } catch (err) {
    errorMessage = err instanceof ApiError ? `API ${err.status}` : (err as Error).message;
  }

  return (
    <div>
      <ScreenHeader eyebrow="Personal record" title="Labs" meta={`${panels.length} panels`} />
      <div className="hairline" />
      <HealthTabBar />

      <div className="px-5 lg:px-0 mt-4 flex justify-end">
        <Link
          href="/health/labs/new"
          className="font-mono text-[11px] uppercase tracking-wider text-ink-3 hover:text-accent transition-colors"
        >
          + Add panel
        </Link>
      </div>

      {errorMessage && (
        <div className="px-5 lg:px-0 mt-4 font-sans text-[13px] text-accent">{errorMessage}</div>
      )}

      <div className="px-5 lg:px-0 mt-4">
        {panels.length === 0 ? (
          <div className="font-sans text-[13px] text-ink-3 italic">
            No lab panels yet. Add a panel, then add individual analytes inside it.
          </div>
        ) : (
          <ul className="divide-y divide-line/40">
            {panels.map((p) => {
              const flagged = (p.results ?? []).filter((r) => r.flag).length;
              return (
                <li key={p.id} className="py-3">
                  <Link href={`/health/labs/${p.id}`} className="block hover:opacity-80 transition-opacity">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="font-sans text-[15px] text-ink">{p.panel_name}</span>
                      <span className="font-mono text-[10px] uppercase tracking-wider text-ink-3">
                        {formatDate(p.drawn_date, tz)}
                      </span>
                    </div>
                    <div className="mt-1 font-mono text-[10px] uppercase tracking-wider text-ink-3">
                      {(p.results ?? []).length} result{(p.results ?? []).length === 1 ? '' : 's'}
                      {flagged > 0 && <span className="text-accent"> · {flagged} flagged</span>}
                      {p.lab_facility && <span> · {p.lab_facility}</span>}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function formatDate(iso: string, tz: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', {
    timeZone: tz, month: 'short', day: 'numeric', year: 'numeric',
  });
}
