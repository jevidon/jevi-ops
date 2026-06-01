import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ScreenHeader } from '@/components/ScreenHeader';
import { healthApi, ApiError, type LabPanel } from '@/lib/api';
import { getAppTimezone } from '@/lib/app-settings';
import { HealthTabBar } from '../../health-tab-bar';
import { ResultForm } from './result-form';
import { deleteResultAction, deletePanelAction } from '../actions';

export default async function PanelDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tz = await getAppTimezone();

  let panel: LabPanel | null = null;
  let errorMessage: string | null = null;
  try {
    panel = await healthApi.labs.getPanel(id);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    errorMessage = err instanceof ApiError ? `API ${err.status}` : (err as Error).message;
  }

  if (!panel) {
    return (
      <div>
        <ScreenHeader eyebrow="Lab panel" title="—" />
        <div className="hairline" />
        <div className="px-5 lg:px-0 mt-6 font-sans text-[13px] text-ink-3">
          {errorMessage ?? 'Panel not found.'}
        </div>
      </div>
    );
  }

  const drawnLabel = new Date(`${panel.drawn_date}T12:00:00Z`).toLocaleDateString('en-US', {
    timeZone: tz, weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
  });
  const results = panel.results ?? [];

  return (
    <div>
      <div className="px-5 lg:px-0 pt-4 pb-1 font-mono text-[10px] uppercase tracking-wider text-ink-3">
        <Link href="/health/labs" className="hover:text-ink-2 transition-colors">
          ← Labs
        </Link>
      </div>
      <ScreenHeader
        eyebrow="Lab panel"
        title={panel.panel_name}
        meta={`${drawnLabel}${panel.lab_facility ? ' · ' + panel.lab_facility : ''}`}
      />
      <div className="hairline" />
      <HealthTabBar />

      <div className="px-5 lg:px-0 mt-4 max-w-3xl">
        <div className="eyebrow pb-2 border-b border-line mb-2">
          Results · {results.length}
        </div>

        {results.length === 0 ? (
          <div className="font-sans text-[13px] text-ink-3 italic">
            No analytes added yet. Use the form below to add them one at a time.
          </div>
        ) : (
          <ul className="divide-y divide-line/40">
            {results.map((r) => (
              <li key={r.id} className="py-2 flex items-baseline justify-between gap-3 group">
                <div className="flex items-baseline gap-3 min-w-0">
                  <span className="font-sans text-[14px] text-ink min-w-[8rem]">{r.analyte}</span>
                  <span className={`font-mono text-[13px] tabular-nums ${r.flag ? 'text-accent' : 'text-ink-2'}`}>
                    {r.value != null ? r.value : r.value_text ?? '—'}
                    {r.unit && <span className="text-ink-3"> {r.unit}</span>}
                  </span>
                  {(r.reference_range_low != null || r.reference_range_high != null) && (
                    <span className="font-mono text-[10px] uppercase tracking-wider text-ink-3">
                      ref {r.reference_range_low ?? '–'}–{r.reference_range_high ?? '–'}
                    </span>
                  )}
                  {r.flag && (
                    <span className="font-mono text-[10px] uppercase tracking-wider text-accent">⚠ {r.flag}</span>
                  )}
                </div>
                <form action={deleteResultAction} className="opacity-0 group-hover:opacity-100 transition-opacity">
                  <input type="hidden" name="id" value={r.id} />
                  <input type="hidden" name="panel_id" value={panel.id} />
                  <button
                    type="submit"
                    aria-label="Delete result"
                    className="font-mono text-[10px] uppercase tracking-wider text-ink-3 hover:text-accent transition-colors"
                  >
                    ✕
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}

        <ResultForm panelId={panel.id} />

        {panel.notes && (
          <div className="mt-6">
            <div className="eyebrow mb-1">Notes</div>
            <p className="font-sans text-[13px] text-ink-2 whitespace-pre-wrap">{panel.notes}</p>
          </div>
        )}

        <form
          action={deletePanelAction}
          onSubmit={(e) => {
            if (!confirm('Delete this panel? All results inside it will also be removed.')) {
              e.preventDefault();
            }
          }}
          className="mt-10 pt-4 border-t border-line"
        >
          <input type="hidden" name="id" value={panel.id} />
          <button
            type="submit"
            className="font-mono text-[10px] uppercase tracking-wider text-ink-3 hover:text-accent transition-colors"
          >
            Delete panel
          </button>
        </form>
      </div>
    </div>
  );
}
