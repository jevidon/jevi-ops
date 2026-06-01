import { ScreenHeader } from '@/components/ScreenHeader';
import { healthApi, ApiError, type HealthHistory } from '@/lib/api';
import { HealthTabBar } from '../health-tab-bar';
import { NarrativeForm } from './narrative-form';
import { HistorySection } from './history-section';

export default async function HistoryPage() {
  let history: HealthHistory | null = null;
  let errorMessage: string | null = null;
  try {
    history = await healthApi.history.get();
  } catch (err) {
    errorMessage = err instanceof ApiError ? `API ${err.status}` : (err as Error).message;
  }

  return (
    <div>
      <ScreenHeader eyebrow="Personal record" title="History" meta="Past medical context" />
      <div className="hairline" />
      <HealthTabBar />

      <div className="px-5 lg:px-0 mt-4 max-w-3xl">
        {errorMessage && (
          <div className="font-sans text-[13px] text-accent mb-4">{errorMessage}</div>
        )}

        {history && (
          <div className="space-y-10">
            <section>
              <div className="eyebrow pb-2 border-b border-line mb-3">Narrative</div>
              <NarrativeForm initialNarrative={history.narrative ?? ''} />
            </section>

            <HistorySection section="conditions" label="Conditions" initialEntries={history.conditions ?? []} />
            <HistorySection section="surgeries" label="Surgeries + procedures" initialEntries={history.surgeries ?? []} />
            <HistorySection section="allergies" label="Allergies" initialEntries={history.allergies ?? []} />
            <HistorySection section="immunizations" label="Immunizations" initialEntries={history.immunizations ?? []} />
            <HistorySection section="family_history" label="Family history" initialEntries={history.family_history ?? []} />
          </div>
        )}
      </div>
    </div>
  );
}
