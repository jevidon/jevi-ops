'use client';

import { createClientId } from '../../../lib/client-id';
import { useEffect, useState } from 'react';
import { factValue, type OnboardingJson, type OnboardingModuleDefinition, type OnboardingSession, type VehicleTrackingDraft } from '@jevi-ops/shared';
import { OnboardingShell, type OnboardingStepProps } from '@/components/onboarding/OnboardingShell';
import { SourcePanel } from '@/components/sources/SourcePanel';
import { loadSourcesAction } from '@/components/sources/actions';
import { ManualKnowledgeFields, newManualKnowledgeDraft } from '@/components/knowledge/ManualKnowledgeFields';
import { loadVehicleOptionsAction } from './vehicle-actions';

const input = 'block w-full rounded border border-line bg-transparent px-3 py-2 text-sm';
const button = 'rounded border border-line px-3 py-2 text-sm disabled:opacity-50';
const num = (value: string) => value === '' ? null : Number(value);
type Values = Record<string, OnboardingJson>;
const string = (value: unknown) => typeof value === 'string' ? value : '';

function Text({ label, value, change, type = 'text', placeholder, max, min, disabled, list }: {
  label: string; value: unknown; change(value: string): void; type?: string; placeholder?: string;
  max?: string | number; min?: string | number; disabled?: boolean; list?: string;
}) { return <label className="block text-sm">{label}<input className={input} type={type} value={value == null ? '' : String(value)} onChange={(e) => change(e.target.value)}
  placeholder={placeholder} max={max} min={min} step={type === 'number' ? 'any' : undefined} disabled={disabled} list={list} /></label>; }
function Select({ label, value, options, change }: { label: string; value: unknown; options: [string, string][]; change(value: string): void }) {
  return <label className="block text-sm">{label}<select className={input} value={string(value)} onChange={(e) => change(e.target.value)}><option value="">Not sure yet</option>{options.map(([key, title]) => <option key={key} value={key}>{title}</option>)}</select></label>;
}
function Notes({ label, value, change, rows = 3 }: { label: string; value: unknown; change(value: string): void; rows?: number }) {
  return <label className="block text-sm">{label}<textarea className={input} rows={rows} value={string(value)} onChange={(e) => change(e.target.value)} /></label>;
}
const clean = (value: unknown): OnboardingJson => JSON.parse(JSON.stringify(value)) as OnboardingJson;

export function VehicleOnboardingScreen({ initialSession, module }: { initialSession: OnboardingSession; module: OnboardingModuleDefinition }) {
  return <OnboardingShell initialSession={initialSession} module={module} exitHref={initialSession.subject_id ? `/assets/${initialSession.subject_id}` : '/onboarding'}
    notice={<p className="text-sm text-ink-3">Only year, make and model are required. You can leave optional facts unknown and return later. Saving this record does not establish its maintenance or legal status.</p>}
    renderStep={(props) => <VehicleStep {...props} />} />;
}
function VehicleStep({ step, values, onChange, session, blockNavigation, setUnsavedChanges }: OnboardingStepProps) {
  const update = (patch: Values) => onChange({ ...values, ...patch });
  const set = (key: string, value: OnboardingJson) => update({ [key]: value });
  const drop = (key: string) => { const next = { ...values }; delete next[key]; onChange(next); };
  const choose = (key: string) => (value: string) => value ? set(key, value) : drop(key);
  const baseline = session.draft.review?.baseline as Record<string, OnboardingJson> | undefined;
  const today = string(baseline?.today);
  const unit = string(session.draft.identity?.meter_unit);
  const [options, setOptions] = useState<{ domains: { id: string; name: string }[] }>({ domains: [] });
  useEffect(() => { if (step.id === 'plans') void loadVehicleOptionsAction().then((result) => { if (result.ok) setOptions(result.value); }); }, [step.id]);
  if (step.id === 'preferences') {
    const goals = (values.goals ?? []) as string[];
    return <div className="space-y-5"><fieldset><legend className="text-sm font-semibold">What would you like help with?</legend><div className="grid gap-2 sm:grid-cols-2 mt-2">{[
      ['service_reminders', 'Keep on top of servicing'], ['maintain_records', 'Maintain records'], ['learn_maintenance', 'Understand maintenance'], ['plan_improvements', 'Plan improvements'],
    ].map(([key, title]) => <label key={key} className="text-sm"><input type="checkbox" checked={goals.includes(key!)} onChange={(e) => set('goals', e.target.checked ? [...goals, key!] : goals.filter((goal) => goal !== key))} /> {title}</label>)}</div></fieldset>
      <div className="grid gap-4 sm:grid-cols-2"><Select label="Practical involvement" value={values.practical_involvement} change={choose('practical_involvement')} options={[
        ['service_provider', 'Use a service provider'], ['simple_checks', 'Do simple checks'], ['some_diy', 'Do some work myself'], ['mostly_diy', 'Do most work myself'],
      ]} /><Select label="Confidence with maintenance" value={values.confidence} change={choose('confidence')} options={[['new', 'New to this'], ['basics', 'Comfortable with basics'], ['experienced', 'Experienced']]} />
      <Select label="Preferred detail" value={values.detail} change={choose('detail')} options={[['essentials', 'Essentials'], ['balanced', 'Balanced'], ['detailed', 'Detailed']]} />
      <Select label="Interest in improvements" value={values.improvement_interest} change={choose('improvement_interest')} options={[['none_now', 'None now'], ['maybe_later', 'Maybe later'], ['actively_planning', 'Actively planning']]} /></div>
      <p className="text-sm text-ink-3">These choices help organise this vehicle’s information. They do not grant an agent permission to act.</p></div>;
  }
  if (step.id === 'identity') return <div className="space-y-5">
    <div className="grid gap-4 sm:grid-cols-2"><Text label="Year (required)" type="number" min={1886} max={2200} value={values.year} change={(v) => set('year', num(v))} />
      <Select label="What does this year describe?" value={values.year_basis} change={choose('year_basis')} options={[['model_year', 'Model year'], ['manufacture_year', 'Manufacture year'], ['first_registration_year', 'First registration year']]} />
      <Text label="Make (required)" value={values.make} change={(v) => set('make', v)} list="vehicle-makes" /><datalist id="vehicle-makes">{['Toyota', 'Ford', 'Honda', 'Hyundai', 'Kia', 'Mazda', 'Mitsubishi', 'Nissan', 'Subaru', 'Suzuki', 'Volkswagen'].map((make) => <option key={make} value={make} />)}</datalist>
      <Text label="Model (required)" value={values.model} change={(v) => set('model', v)} /><Text label="Trim / variant" value={values.variant} placeholder="Leave blank if not sure" change={(v) => set('variant', v)} />
      <Text label="Nickname / display name" value={values.nickname} placeholder="Defaults to the supplied vehicle identity" change={(v) => set('nickname', v)} /></div>
    <details><summary className="cursor-pointer text-sm">Add optional identifiers</summary><div className="grid gap-4 sm:grid-cols-2 mt-3">{[['vin', 'VIN'], ['chassis_id', 'Chassis / frame identifier'], ['model_code', 'Model code'], ['plate', 'Registration plate']].map(([key, label]) => <Text key={key} label={label!} value={values[key!]} change={(v) => set(key!, v)} />)}</div><p className="text-sm text-ink-3 mt-2">Identifiers are separate text fields. Keep leading zeroes. Private identifiers are withheld from default research context.</p></details>
    <fieldset className="space-y-3"><legend className="text-sm font-semibold">Optional odometer observation</legend><p className="text-sm text-ink-3">An odometer observation records distance, not servicing. Leave the reading blank if unknown.</p>
      <div className="grid gap-4 sm:grid-cols-3"><Text label="Reading" value={values.reading} type="number" min={0} change={(v) => set('reading', num(v))} />
      <label className="text-sm">Unit<select className={input} value={string(values.meter_unit)} disabled={baseline?.meter_unit_locked === true} onChange={(e) => set('meter_unit', e.target.value || null)}><option value="">Not supplied</option><option value="km">Kilometres (km)</option><option value="mi">Miles (mi)</option></select></label>
      <Text label="Reading date" type="date" max={today} value={values.recorded_on} change={(v) => set('recorded_on', v || null)} /></div>
      <p className="text-xs text-ink-3">Date default: {today} in {string(baseline?.timezone)}. {baseline?.meter_unit_locked === true ? 'The unit is fixed because this vehicle already has readings.' : 'Choose the unit written on the odometer; country does not change it.'}</p></fieldset></div>;
  if (step.id === 'jurisdiction') return <div className="space-y-4"><p className="text-sm text-ink-3">Location helps identify relevant questions. No legal rule or expiry is inferred from these answers.</p>
    <div className="grid gap-4 sm:grid-cols-2"><Text label="Normally based: country code" value={values.based_country} placeholder="For example NZ, AU, US or GB" change={(v) => set('based_country', v.toUpperCase().slice(0, 2))} />
      <Text label="Based region / state / province" value={values.based_region} change={(v) => set('based_region', v)} /></div>
    <button type="button" className={button} onClick={() => update({ registration_country: values.based_country ?? '', registration_region: values.based_region ?? '' })}>Registered in the same place</button>
    <div className="grid gap-4 sm:grid-cols-2"><Text label="Registered: country code" value={values.registration_country} placeholder="For example NZ" change={(v) => set('registration_country', v.toUpperCase().slice(0, 2))} />
      <Text label="Registration region / state / province" value={values.registration_region} change={(v) => set('registration_region', v)} /></div><p className="text-sm text-ink-3">Leave unknown places blank. Changing known jurisdictions flags dependent assessments for review.</p></div>;
  if (step.id === 'state') {
    const ownership = (values.ownership ?? {}) as Values;
    const purchaseDate = (ownership.purchase_date ?? { precision: 'unknown' }) as Values;
    const purchaseReading = (ownership.purchase_reading ?? {}) as Values;
    return <div className="space-y-5"><Select label="Vehicle lifecycle" value={values.lifecycle} change={choose('lifecycle')} options={[['active', 'Active'], ['stored', 'Stored'], ['sold', 'Sold'], ['archived', 'Archived']]} />
      <Notes label="General condition / relevant uncertainty" value={values.condition} change={(v) => set('condition', v)} />
      <Select label="Known configuration" value={values.configuration} change={choose('configuration')} options={[['standard', 'Standard as far as I know'], ['modified', 'Has installed modifications'], ['unknown', 'Unknown']]} />
      <details><summary className="cursor-pointer text-sm">Ownership and purchase evidence</summary><div className="space-y-3 mt-3"><Select label="Purchase date precision" value={purchaseDate.precision} options={[['day', 'Exact date'], ['month', 'Month'], ['year', 'Year'], ['unknown', 'Unknown']]} change={(v) => set('ownership', { ...ownership, purchase_date: { precision: v || 'unknown' } })} />
      {purchaseDate.precision !== 'unknown' && <Text label="Purchase date as known" type={purchaseDate.precision === 'day' ? 'date' : purchaseDate.precision === 'month' ? 'month' : 'text'} value={purchaseDate.value} change={(v) => set('ownership', { ...ownership, purchase_date: { ...purchaseDate, value: v } })} />}
      <div className="grid gap-4 sm:grid-cols-2"><Text label="Purchase reading (evidence only)" type="number" min={0} value={purchaseReading.amount} change={(v) => { const next = { ...ownership }; if (v === '') delete next.purchase_reading; else next.purchase_reading = { amount: Number(v), unit: purchaseReading.unit || null }; set('ownership', next); }} />
      {ownership.purchase_reading && <Select label="Original purchase reading unit" value={purchaseReading.unit} options={[['km', 'Kilometres'], ['mi', 'Miles']]} change={(v) => set('ownership', { ...ownership, purchase_reading: { ...purchaseReading, unit: v || null } })} />}</div><p className="text-xs text-ink-3">Approximate dates and original units stay as evidence. They do not become exact-date ledger entries.</p></div></details>
      <details><summary className="cursor-pointer text-sm">Optional specification</summary><div className="grid gap-4 sm:grid-cols-2 mt-3">{[['fuel_powertrain', 'Fuel / powertrain'], ['engine', 'Engine / variant'], ['registration_class', 'Registration / vehicle class'], ['import_origin', 'Import origin']].map(([key, label]) => <Text key={key} label={label!} value={values[key!]} change={(v) => set(key!, v)} />)}</div></details>
      <details><summary className="cursor-pointer text-sm">Installed equipment and known issues</summary><div className="space-y-3 mt-3"><EvidenceLines label="Installed equipment (one item per line)" entries={(values.installed_equipment ?? []) as Values[]} field="name" change={(next) => set('installed_equipment', next)} />
      <EvidenceLines label="Known issues (one issue per line)" entries={(values.known_issues ?? []) as Values[]} field="description" change={(next) => set('known_issues', next)} />
      <p className="text-xs text-ink-3">Only list equipment already installed. Capture future purchases on the next plans screen.</p></div></details></div>;
  }
  if (step.id === 'history') return <div className="space-y-5"><Select label="How much service history do you have?" value={values.coverage} change={choose('coverage')} options={[['none', 'No records'], ['partial', 'Some records'], ['extensive', 'Detailed records'], ['unknown', 'Add later / unknown']]} />
    <Notes label="History coverage and known gaps" value={values.notes} change={(v) => set('notes', v)} /><p className="text-sm text-ink-3">Originals and candidates are retained with this draft, then attached to the saved vehicle. Record confirmed historical work from its Sources panel after saving. No record means no claim that a service was completed.</p>
    <SourcePanel subject={{ session_id: session.id }} meterUnit={unit || null} today={today} onDirtyChange={setUnsavedChanges} onBusyChange={blockNavigation} /></div>;
  if (step.id === 'plans') {
    const entries = (values.projects ?? []) as Values[];
    return <div className="space-y-4"><Notes label="How do you use this vehicle?" value={values.usage} change={(v) => set('usage', v)} /><Text label="Estimated usage, if useful" value={values.estimated_usage} placeholder="For example about 1,000 km per month (estimate)" change={(v) => set('estimated_usage', v)} />
      <label className="text-sm block">Optional domain<select className={input} value={string(values.domain_id)} onChange={(e) => set('domain_id', e.target.value || null)}><option value="">Unassigned</option>{options.domains.map((domain) => <option key={domain.id} value={domain.id}>{domain.name}</option>)}</select></label>
      <details open={entries.length > 0 || session.draft.preferences?.improvement_interest === 'actively_planning'}><summary className="cursor-pointer text-sm">Future ideas, orders and approved projects</summary><div className="space-y-4 mt-3">{entries.map((entry, i) => {
        const change = (patch: Values) => set('projects', entries.map((old, j) => i === j ? { ...old, ...patch } : old));
        return <fieldset key={string(entry.key)} className="border border-line p-3 space-y-3"><legend className="text-sm">Plan {i + 1}</legend><Text label="Name" value={entry.name} change={(v) => change({ name: v })} /><Select label="Current state" value={entry.state} change={(v) => change({ state: v || 'idea' })} options={[['idea', 'An idea'], ['ordered', 'Ordered, not installed'], ['approved', 'Approved project']]} />
          <Notes label="Description / order details" value={entry.description} change={(v) => change({ description: v })} /><button className={button} type="button" onClick={() => set('projects', entries.filter((_, j) => j !== i))}>Remove draft plan</button></fieldset>;
      })}<button className={button} type="button" onClick={() => set('projects', [...entries, { key: createClientId(), name: '', state: 'idea' }])}>Add a plan</button><p className="text-sm text-ink-3">Ideas and orders are saved as idea projects. Approved plans become active projects. None changes the installed equipment list.</p></div></details></div>;
  }
  if (step.id === 'tracking') return <TrackingStep values={values} onChange={onChange} unit={unit} sessionId={session.id} />;
  const metadata = (baseline?.asset as Values | null)?.metadata as Values | undefined;
  const identity = session.draft.identity ?? {};
  return <div className="space-y-5"><dl className="grid gap-2 text-sm"><div><dt className="font-semibold">Vehicle</dt><dd>{[identity.year, identity.make, identity.model, identity.variant].filter(Boolean).join(' ')}</dd></div>
    <div><dt className="font-semibold">Odometer observation to add</dt><dd>{identity.reading == null ? 'Not supplied' : `${Number(identity.reading).toLocaleString()} ${identity.meter_unit} on ${identity.recorded_on}`}</dd></div>
    <div><dt className="font-semibold">Jurisdictions</dt><dd>Based: {string(session.draft.jurisdiction?.based_country) || 'unknown'}. Registered: {string(session.draft.jurisdiction?.registration_country) || 'unknown'}.</dd></div>
    <div><dt className="font-semibold">History</dt><dd>{string(session.draft.history?.coverage) || String(factValue(metadata?.history_coverage) ?? 'Unknown')}. Candidate imports remain awaiting review.</dd></div></dl>
    {Object.entries(session.step_states).some(([, state]) => state === 'skipped') && <p className="text-sm text-ink-3">Skipped sections stay in this saved setup draft and will not change the vehicle: {Object.entries(session.step_states).filter(([, state]) => state === 'skipped').map(([key]) => key).join(', ')}. Retained source originals will still be attached for later review.</p>}
    <p className="text-sm text-ink-3">The next review shows the records and schedules that saving will change. Unknown history and legal responsibilities remain unknown.</p>
    <details><summary className="cursor-pointer text-sm">Authored vehicle overview (Markdown)</summary><div className="mt-3 space-y-2"><p className="text-sm text-ink-3">Existing text is preserved unless you edit it. For a new vehicle, leave this untouched to create a short starter overview. Facts, evidence and history remain separate records.</p>
      <Notes label="Overview" value={values.doc_md} rows={10} change={(v) => set('doc_md', v)} /></div></details></div>;
}

function TrackingStep({ values, onChange, unit, sessionId }: { values: Values; onChange(values: Values): void; unit: string; sessionId: string }) {
  const entries = (values.items ?? []) as unknown as VehicleTrackingDraft[];
  const set = (next: VehicleTrackingDraft[]) => onChange({ ...values, items: clean(next) });
  const [sources, setSources] = useState<{ id: string; label: string }[]>([]);
  useEffect(() => { void loadSourcesAction({ session_id: sessionId }).then((result) => {
    if (result.sources) setSources(result.sources.map((source) => ({ id: source.source_id, label: source.label })));
  }); }, [sessionId]);
  return <div className="space-y-5"><p className="text-sm text-ink-3">Enter dates, thresholds or responsibilities you already know. Personal reminders can be useful while legal applicability remains unknown. Research is optional.</p>
    {entries.map((entry, index) => <div key={entry.key} className="space-y-3 border border-line p-4">
      <ManualKnowledgeFields value={entry} meterUnit={unit || null} sources={sources} onChange={(updated) => set(entries.map((old, i) => i === index ? updated : old))} />
      <button type="button" className={button} onClick={() => set(entries.filter((_, i) => i !== index))}>Remove draft responsibility</button>
    </div>)}
    <button type="button" className={button} onClick={() => set([...entries, newManualKnowledgeDraft()])}>Add a known date or responsibility</button>
  </div>;
}

function EvidenceLines({ label, entries, field, change }: { label: string; entries: Values[]; field: 'name' | 'description'; change(entries: Values[]): void }) {
  const [text, setText] = useState(() => entries.map((entry) => entry[field]).join('\n'));
  return <Notes label={label} value={text} change={(next) => {
    setText(next);
    const remaining = [...entries];
    change(next.split('\n').map((line) => line.trim()).filter(Boolean).map((value) => {
      const index = remaining.findIndex((entry) => entry[field] === value);
      // Editing one line must not discard dates or provenance on other lines.
      return index >= 0 ? remaining.splice(index, 1)[0]! : { [field]: value };
    }));
  }} />;
}
