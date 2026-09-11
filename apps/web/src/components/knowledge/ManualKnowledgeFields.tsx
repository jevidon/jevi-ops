'use client';

import { createClientId } from '../../lib/client-id';
import { useId } from 'react';
import type { VehicleTrackingDraft } from '@jevi-ops/shared/schemas';

const input = 'block w-full rounded border border-line bg-transparent px-3 py-2 text-sm';
export function newManualKnowledgeDraft(): VehicleTrackingDraft {
  return { key: createClientId(), name: '', kind: 'user_reminder', applicability: 'unknown', evidence_basis: 'user_reported', source_ids: [], source_note: '', policy: 'expiry', lead_days: 0, track: false };
}
/** Shared by vehicle onboarding and the ordinary asset responsibility editor. */
export function ManualKnowledgeFields({ value, onChange, meterUnit, sources = [], showReference = true, showSchedule = true, disabled = false }: {
  value: VehicleTrackingDraft; onChange(value: VehicleTrackingDraft): void; meterUnit?: string | null;
  sources?: { id: string; label: string }[]; showReference?: boolean; showSchedule?: boolean; disabled?: boolean;
}) {
  const id = useId();
  const set = <K extends keyof VehicleTrackingDraft>(key: K, next: VehicleTrackingDraft[K]) => onChange({ ...value, [key]: next });
  const number = (text: string) => text.trim() === '' ? null : Number(text);
  return <fieldset disabled={disabled} className="space-y-3">
    <legend className="sr-only">Manual responsibility details</legend>
    <label className="block" htmlFor={`${id}-name`}>Responsibility or reminder name<input id={`${id}-name`} className={input} value={value.name} onChange={(event) => set('name', event.target.value)} /></label>
    {showReference && <label className="block" htmlFor={`${id}-kind`}>Kind<select id={`${id}-kind`} className={input} value={value.kind} onChange={(event) => set('kind', event.target.value as VehicleTrackingDraft['kind'])}>
      <option value="user_reminder">My reminder</option><option value="service_recommendation">Service recommendation</option><option value="regulatory">Regulatory reference</option>
    </select></label>}
    <label className="block" htmlFor={`${id}-applicability`}>Applicability to this vehicle<select id={`${id}-applicability`} className={input} value={value.applicability} onChange={(event) => set('applicability', event.target.value as VehicleTrackingDraft['applicability'])}>
      <option value="unknown">Unknown — not established</option><option value="applicable">Applies</option><option value="not_applicable">Does not apply, based on this assessment</option>
    </select></label>
    <label className="block" htmlFor={`${id}-evidence`}>Evidence basis<select id={`${id}-evidence`} className={input} value={value.evidence_basis} onChange={(event) => set('evidence_basis', event.target.value as VehicleTrackingDraft['evidence_basis'])}>
      <option value="user_reported">Entered by me</option><option value="document_supported">Supported by a retained document</option><option value="official_source_supported">Supported by a retained official source</option>
    </select></label>
    <p className="text-sm text-ink-3">A reminder or its completion does not establish legal compliance. A country choice does not supply a verified rule. Unknown remains unknown.</p>
    <label className="block" htmlFor={`${id}-source-note`}>Source note or rationale<textarea id={`${id}-source-note`} className={input} value={value.source_note} onChange={(event) => set('source_note', event.target.value)} /></label>
    <fieldset className="space-y-2"><legend>Retained sources</legend>{sources.length ? sources.map((source) => <label className="block" key={source.id}>
      <input type="checkbox" checked={value.source_ids.includes(source.id)} onChange={(event) => set('source_ids', event.target.checked ? [...value.source_ids, source.id] : value.source_ids.filter((s) => s !== source.id))} /> {source.label}
    </label>) : <p className="text-sm">Add a document, link or source note in Sources above to reference it here. A source note can also record your own input.</p>}</fieldset>
    <label className="block"><input type="checkbox" checked={value.track} onChange={(event) => set('track', event.target.checked)} /> Add or update operational tracking</label>
    {value.track && showSchedule && <div className="space-y-3 rounded border border-line p-3">
      <label className="block" htmlFor={`${id}-policy`}>Tracking policy<select id={`${id}-policy`} className={input} value={value.policy} onChange={(event) => set('policy', event.target.value as VehicleTrackingDraft['policy'])}>
        <option value="expiry">Issued expiry or renewal date</option><option value="interval">Repeating service interval</option><option value="prepaid_meter">Purchased distance entitlement</option><option value="on_condition">Condition or inspection finding</option>
      </select></label>
      {value.policy === 'interval' && <>
        <label className="block" htmlFor={`${id}-months`}>Interval in months (optional)<input id={`${id}-months`} className={input} type="number" min={1} value={value.interval_months ?? ''} onChange={(event) => onChange({ ...value, interval_months: number(event.target.value), interval_days: null })} /></label>
        <label className="block" htmlFor={`${id}-days`}>Or interval in days (optional)<input id={`${id}-days`} className={input} type="number" min={1} value={value.interval_days ?? ''} onChange={(event) => onChange({ ...value, interval_days: number(event.target.value), interval_months: null })} /></label>
        {meterUnit && <label className="block" htmlFor={`${id}-distance`}>Distance interval ({meterUnit}, optional)<input id={`${id}-distance`} className={input} type="number" min={0} step="any" value={value.interval_meter ?? ''} onChange={(event) => set('interval_meter', number(event.target.value))} /></label>}
      </>}
      {value.policy !== 'prepaid_meter' && <label className="block" htmlFor={`${id}-date`}>{value.policy === 'expiry' ? 'Actual issued expiry date (if known)' : 'Next due or review date (if known)'}<input id={`${id}-date`} className={input} type="date" value={value.next_due_date ?? ''} onChange={(event) => set('next_due_date', event.target.value || null)} /></label>}
      {meterUnit && value.policy !== 'expiry' && <label className="block" htmlFor={`${id}-meter`}>{value.policy === 'prepaid_meter' ? 'Purchased-to reading' : 'Next due reading'} ({meterUnit}, if known)<input id={`${id}-meter`} className={input} type="number" min={0} step="any" value={value.next_due_meter ?? ''} onChange={(event) => set('next_due_meter', number(event.target.value))} /></label>}
      {!meterUnit && value.policy === 'prepaid_meter' && <p role="alert">Confirm a vehicle meter unit before defining purchased-distance tracking.</p>}
      <label className="block" htmlFor={`${id}-lead`}>Reminder lead time in days<input id={`${id}-lead`} className={input} type="number" min={0} value={value.lead_days ?? 0} onChange={(event) => set('lead_days', Number(event.target.value))} /></label>
      <p className="text-sm text-ink-3">Unknown dates or readings stay empty. This does not invent a completed service or historical baseline. Review will show any schedule and task effects before you apply them.</p>
    </div>}
  </fieldset>;
}
