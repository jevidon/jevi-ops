import { ScreenHeader } from '@/components/ScreenHeader';
import { healthApi, ApiError, type Medication, type MedicationKind } from '@/lib/api';
import { HealthTabBar } from '../health-tab-bar';
import { MedForm } from './med-form';
import { toggleActiveAction, deleteMedAction } from './actions';

export default async function MedsPage() {
  let medications: Medication[] = [];
  let errorMessage: string | null = null;
  try {
    const res = await healthApi.medications.list();
    medications = res.medications;
  } catch (err) {
    errorMessage = err instanceof ApiError ? `API ${err.status}` : (err as Error).message;
  }

  const active = medications.filter((m) => m.active);
  const inactive = medications.filter((m) => !m.active);
  const byKind = (list: Medication[], kind: MedicationKind) =>
    list.filter((m) => m.kind === kind);

  return (
    <div>
      <ScreenHeader
        eyebrow="Personal record"
        title="What I'm taking"
        meta={`${active.length} active · ${inactive.length} past`}
      />
      <div className="hairline" />
      <HealthTabBar />

      <div className="px-5 lg:px-0">
        <MedForm />

        {errorMessage && (
          <div className="mt-4 font-sans text-[13px] text-accent">{errorMessage}</div>
        )}

        <div className="mt-8 space-y-8">
          <KindSection label="Prescriptions" meds={byKind(active, 'prescription')} />
          <KindSection label="Supplements" meds={byKind(active, 'supplement')} />
          <KindSection label="Vitamins" meds={byKind(active, 'vitamin')} />
          <KindSection label="OTC" meds={byKind(active, 'otc')} />
          {inactive.length > 0 && (
            <section>
              <details>
                <summary className="eyebrow pb-2 border-b border-line cursor-pointer list-none hover:text-ink-2 transition-colors">
                  Past ({inactive.length})
                </summary>
                <ul className="mt-2 divide-y divide-line/40">
                  {inactive.map((m) => <MedRow key={m.id} m={m} />)}
                </ul>
              </details>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

function KindSection({ label, meds }: { label: string; meds: Medication[] }) {
  if (meds.length === 0) return null;
  return (
    <section>
      <div className="eyebrow pb-2 border-b border-line mb-2">{label}</div>
      <ul className="divide-y divide-line/40">
        {meds.map((m) => <MedRow key={m.id} m={m} />)}
      </ul>
    </section>
  );
}

function MedRow({ m }: { m: Medication }) {
  return (
    <li className="py-2 flex items-start justify-between gap-3 group">
      <div className="flex-1 min-w-0">
        <div className="font-sans text-[14px] text-ink">
          {m.name}
          {m.dosage && <span className="font-mono text-[12px] text-ink-2 ml-2">{m.dosage}</span>}
        </div>
        <div className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-ink-3 flex flex-wrap gap-x-3">
          {m.frequency && <span>{m.frequency}</span>}
          {m.reason && <span>{m.reason}</span>}
          {m.prescribing_provider && <span>Rx: {m.prescribing_provider}</span>}
        </div>
        {m.notes && <p className="mt-1 font-sans text-[12px] text-ink-3 leading-snug">{m.notes}</p>}
      </div>
      <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
        <form action={toggleActiveAction}>
          <input type="hidden" name="id" value={m.id} />
          <input type="hidden" name="active" value={String(m.active)} />
          <button
            type="submit"
            className="font-mono text-[10px] uppercase tracking-wider text-ink-3 hover:text-ink-2 transition-colors"
          >
            {m.active ? 'Stop' : 'Restart'}
          </button>
        </form>
        <form action={deleteMedAction}>
          <input type="hidden" name="id" value={m.id} />
          <button
            type="submit"
            aria-label="Delete"
            className="font-mono text-[10px] uppercase tracking-wider text-ink-3 hover:text-accent transition-colors"
          >
            ✕
          </button>
        </form>
      </div>
    </li>
  );
}
