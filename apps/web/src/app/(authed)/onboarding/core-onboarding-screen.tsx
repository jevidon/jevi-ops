'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { CoreOnboardingDraft, CoreSetupContext, CoreStructure, OnboardingModuleDefinition, OnboardingPreview, OnboardingSession } from '@jevi-ops/shared/schemas';
import type { AppSettings, IntegrationItem } from '@/lib/api';
import { OnboardingShell, type OnboardingStepProps } from '@/components/onboarding/OnboardingShell';
import { CaptureTypeGrid } from '@/components/capture/CaptureTypeGrid';
import { AiSettingsForm } from '../settings/ai-settings-form';
import { updateIntegrationSettingsAction } from '../settings/actions';
import { completeOnboardingAction, interpretCoreStructureAction, loadCoreContextAction, previewOnboardingAction, startOnboardingAction } from './actions';

const input = 'w-full rounded border border-line bg-transparent px-3 py-2';
const button = 'rounded border border-line px-3 py-2 disabled:opacity-50';

export function CoreOnboardingScreen({ initialSession, module, initialSettings, initialContext, integrations }: {
  initialSession: OnboardingSession; module: OnboardingModuleDefinition; initialSettings: AppSettings;
  initialContext: CoreSetupContext; integrations: IntegrationItem[];
}) {
  const [settings, setSettings] = useState(initialSettings);
  const [context, setContext] = useState(initialContext);
  async function refresh() {
    const result = await loadCoreContextAction(initialSession.id);
    if (result.ok) setContext(result.value);
  }
  return <OnboardingShell initialSession={initialSession} module={module} notice={<p className="text-sm text-ink-3">Provider settings, timezone, currency and approved structure changes save immediately. Back or Abandon does not undo those saves.</p>}
    renderStep={(props) => <CoreStep key={props.step.id} {...props} settings={settings} onSettings={setSettings} context={context} refresh={refresh} integrations={integrations} />} />;
}

function CoreStep(props: OnboardingStepProps & { settings: AppSettings; onSettings(settings: AppSettings): void; context: CoreSetupContext; refresh(): Promise<void>; integrations: IntegrationItem[] }) {
  const { step, values, onChange, settings, onSettings, context, session, refresh } = props;
  useEffect(() => { void refresh(); }, [step.id]); // Recheck saved state on each entry, without changing draft answers.
  if (step.id === 'welcome') return <WelcomeStep {...props} />;
  if (step.id === 'ai') return <div className="space-y-4">
    <p>AI requests go to the endpoint you choose. A local or private network endpoint can keep requests on your infrastructure; a remote provider receives the content sent with each request.</p>
    <label className="flex gap-2"><input type="radio" name="ai-mode" checked={values.mode === 'manual'} onChange={() => onChange({ mode: 'manual' })} /> Set up later — use manual forms</label>
    <label className="flex gap-2"><input type="radio" name="ai-mode" checked={values.mode === 'configure'} onChange={() => onChange({ mode: 'configure' })} /> Configure an AI provider</label>
    {values.mode === 'manual' && <p>Manual tasks, notes, domains, projects and vehicle records work now. Free-text interpretation, speech transcription and research need their separate connections. You can configure them later in <Link className="underline" href="/settings">Settings</Link>.</p>}
    {values.mode === 'configure' && <AiSettingsForm key="core-llm" current={settings} integrations={['llm']} onBusy={props.blockNavigation} onDirty={props.setUnsavedChanges} onSaved={(next) => { onSettings(next); void refresh(); }} />}
  </div>;
  if (step.id === 'integrations') return <div className="space-y-5">
    <p>Connect only what is useful. Each connection is optional and can be changed later in Settings.</p>
    <AiSettingsForm key="core-integrations" current={settings} integrations={['stt', 'immich']} onBusy={props.blockNavigation} onDirty={props.setUnsavedChanges} onSaved={(next) => { onSettings(next); void refresh(); }} />
    <ul className="space-y-4">{props.integrations.filter((item) => ['google_oauth', 'pushover', 'storage'].includes(item.key)).map((item) => <li key={item.key} className="rounded border border-line p-3">
      <strong>{item.label}</strong><p>{item.purpose}</p><p className="text-sm">Configuration: {item.status}. This inventory does not prove a working connection.</p>
      <p className="text-sm">{item.key === 'google_oauth' ? 'Calendar sync sends events to Google after you connect an account. Disconnect through Settings.' : item.key === 'pushover' ? 'Enabled notifications send reminder text to Pushover. Configure or remove the protected server credentials to disconnect.' : 'Photos are stored on your configured server volume. Private source documents use separate authenticated storage.'}</p>
      <Link className="underline" href="/settings">Manage {item.label}</Link>
    </li>)}</ul>
    <p>External research is separate from these integrations. Vehicle setup and manual maintenance remain available while research is unconfigured.</p>
  </div>;
  if (step.id === 'structure') return <StructureStep {...props} />;
  if (step.id === 'vehicle') return <VehicleStep {...props} />;
  if (step.id === 'practice') return <div className="space-y-4">
    <p>Try a real manual create form with an item you want to keep. A task is one action; a project groups work toward an outcome; a note holds reference information. Choose a domain on the form to file it, or leave it in Inbox.</p>
    <p>These are the ordinary Capture grid forms and work without a model. No demonstration records are created automatically. The free-text Capture box uses AI interpretation and is separate from these forms.</p>
    <CaptureTypeGrid onNavigate={() => { void props.save(); }} />
    <p className="text-sm">Your setup stays resumable at <Link className="underline" href={`/onboarding/${session.id}`}>this setup page</Link>. Skipping this lesson is fine.</p>
    <label><input type="checkbox" checked={values.choice === 'skipped'} onChange={(event) => onChange({ choice: event.target.checked ? 'skipped' : 'manual_task' })} /> Skip practice for now</label>
  </div>;
  const tested = context.capabilities.some((c) => c.id === 'text_generation' && c.status === 'tested');
  return <div className="space-y-4">
    <h3 className="font-serif text-xl">{tested ? 'Workspace ready' : 'Ready in manual mode'}</h3>
    <p>Completion records your setup choice. You can keep improving the workspace through Settings and the normal Add vehicle path.</p>
    <Readiness context={context} />
    <ul className="space-y-2">{context.capabilities.map((capability) => <li key={capability.id}><strong>{capability.id.replaceAll('_', ' ')}: {capability.status}</strong><p className="text-sm">{capability.detail}</p></li>)}</ul>
    <p>Organisation: {context.domains.filter((d) => !d.is_system).length} saved domains and {context.areas.length} general areas. Vehicles use their asset record as an area.</p>
    {context.children.length ? <ul>{context.children.map((child) => <li key={child.id}><Link className="underline" href={`/onboarding/${child.id}`}>Vehicle setup: {child.status.replaceAll('_', ' ')}</Link></li>)}</ul> : <p>Vehicle setup was left for later. That does not block completion.</p>}
    <p><Link className="underline" href="/settings">Return to connection settings</Link> or use Back to review a setup choice.</p>
  </div>;
}

function Readiness({ context }: { context: CoreSetupContext }) {
  return <ul className="space-y-2">{context.readiness.map((check) => <li key={check.id} className="rounded border border-line p-3">
    <strong>{check.title}: {check.status}</strong> <span className="text-sm">({check.required ? 'core requirement' : 'optional capability'})</span><p className="text-sm">{check.detail}</p>
  </li>)}</ul>;
}

function WelcomeStep({ values, onChange, settings, onSettings, context, blockNavigation }: OnboardingStepProps & { settings: AppSettings; onSettings(settings: AppSettings): void; context: CoreSetupContext }) {
  const [suggestedTimezone, setSuggestedTimezone] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => { blockNavigation(saving); return () => blockNavigation(false); }, [saving, blockNavigation]);
  useEffect(() => setSuggestedTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone), []);
  const timezone = typeof values.timezone === 'string' ? values.timezone : settings.timezone;
  const currency = typeof values.currency === 'string' ? values.currency : settings.currency ?? 'USD';
  return <div className="space-y-4">
    <p>Jevi Ops keeps the parts of life and work you care for, the projects that improve them, and the next actions together. Your records stay in this installation. Optional model, calendar and notification connections receive only the information sent to them when those features run.</p>
    <Readiness context={context} />
    <label className="block">What would you like help organising? (optional)<textarea className={input} value={String(values.context ?? '')} onChange={(event) => onChange({ ...values, context: event.target.value })} /></label>
    <fieldset disabled={saving} className="space-y-3">
      <label className="block">Timezone<input className={input} value={timezone} onChange={(event) => onChange({ ...values, timezone: event.target.value, settings_confirmed: false })} /></label>
      {suggestedTimezone && <p className="text-sm">Browser suggestion: {suggestedTimezone}. <button type="button" className="underline" onClick={() => onChange({ ...values, timezone: suggestedTimezone, settings_confirmed: false })}>Use this timezone</button></p>}
      <label className="block">Household display currency<input className={input} maxLength={3} value={currency} onChange={(event) => onChange({ ...values, currency: event.target.value.toUpperCase(), settings_confirmed: false })} /></label>
      <p className="text-sm">Use a three-letter currency such as NZD, USD or GBP. Original transaction currencies remain distinct.</p>
      <button type="button" className={button} disabled={context.readiness.some((c) => c.required && (c.status === 'degraded' || c.status === 'unavailable'))} onClick={async () => {
        setSaving(true);
        try {
          const result = await updateIntegrationSettingsAction({ expected_revision: settings.revision, timezone, currency });
          setNotice(result.message);
          if (result.ok && result.settings) { onSettings(result.settings); onChange({ ...values, timezone: result.settings.timezone, currency: result.settings.currency ?? currency, settings_confirmed: true }); }
        } finally { setSaving(false); }
      }}>{saving ? 'Saving settings…' : 'Confirm and save timezone and currency'}</button>
    </fieldset>
    <p className="text-sm">These settings take effect immediately, including when you leave setup unfinished.</p>
    {notice && <p role="status">{notice}</p>}{values.settings_confirmed === true && <p>Timezone and currency confirmed.</p>}
  </div>;
}

function StructureStep({ values, onChange, context, refresh, save, session, onSession, blockNavigation }: OnboardingStepProps & { context: CoreSetupContext; refresh(): Promise<void> }) {
  const structure = { domains: [], areas: [], ...values } as CoreStructure;
  const [preview, setPreview] = useState<OnboardingPreview | null>(null);
  const key = useRef<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [suggestion, setSuggestion] = useState<CoreStructure | null>(null);
  useEffect(() => { blockNavigation(busy); return () => blockNavigation(false); }, [busy, blockNavigation]);
  const edit = (next: CoreStructure) => { setPreview(null); key.current = null; onChange(next); };
  const previouslyApplied = new Set(context.receipts.filter((r) => r.action_id === 'structure').flatMap((r) => Array.isArray(r.receipt.result.domains) ? r.receipt.result.domains : []).flatMap((d) => d && typeof d === 'object' && !Array.isArray(d) && typeof d.key === 'string' ? [d.key] : []));
  return <div className="space-y-4">
    <p>A domain is a long-lived part of life or work, such as Home. A vehicle is an asset within a domain. A project has a finite outcome, such as fitting a roof rack; an ongoing general area remains available for contexts that are not assets. Routine maintenance uses the maintenance schedule.</p>
    <p>Choose existing records explicitly to reuse them. Similar names never merge or rename records. Applying this structure saves it immediately.</p>
    <div className="flex flex-wrap gap-2">{['Home', 'Family', 'Vehicles'].map((name) => <button key={name} type="button" className={button} disabled={busy} onClick={() => edit({ ...structure, domains: [...structure.domains, { key: crypto.randomUUID(), name, selected: true }] })}>Suggest {name}</button>)}</div>
    {structure.domains.map((domain, index) => <fieldset key={domain.key} disabled={busy || Boolean(preview)} className="space-y-2 rounded border border-line p-3">
      <legend>Domain {index + 1}</legend>
      <label><input type="checkbox" checked={domain.selected} onChange={(e) => edit({ ...structure, domains: structure.domains.map((d, i) => i === index ? { ...d, selected: e.target.checked } : d) })} /> Include this domain</label>
      <label className="block">Create or reuse<select className={input} value={domain.existing_id ?? ''} disabled={previouslyApplied.has(domain.key)} onChange={(e) => {
        const existing = context.domains.find((d) => d.id === e.target.value);
        edit({ ...structure, domains: structure.domains.map((d, i) => i === index ? { ...d, existing_id: existing?.id ?? null, name: existing?.name ?? d.name } : d) });
      }}><option value="">Create a domain</option>{context.domains.map((d) => <option value={d.id} key={d.id}>Reuse {d.name}</option>)}</select></label>
      <label className="block">Domain name<input className={input} value={domain.name} readOnly={Boolean(domain.existing_id) || previouslyApplied.has(domain.key)} onChange={(e) => edit({ ...structure, domains: structure.domains.map((d, i) => i === index ? { ...d, name: e.target.value } : d) })} /></label>
      {previouslyApplied.has(domain.key) && <p className="text-sm">Already saved. This setup will reuse its stable record. Rename it through the normal domain editor.</p>}
    </fieldset>)}
    <button type="button" className={button} disabled={busy || Boolean(preview)} onClick={() => edit({ ...structure, domains: [...structure.domains, { key: crypto.randomUUID(), name: '', selected: true }] })}>Add domain</button>
    {structure.areas.map((area, index) => <fieldset key={area.key} disabled={busy || Boolean(preview)} className="space-y-2 rounded border border-line p-3">
      <legend>General area {index + 1}</legend>
      <label><input type="checkbox" checked={area.selected} onChange={(e) => edit({ ...structure, areas: structure.areas.map((a, i) => i === index ? { ...a, selected: e.target.checked } : a) })} /> Include this area</label>
      <label className="block">Create or reuse<select className={input} value={area.existing_id ?? ''} onChange={(e) => {
        const existing = context.areas.find((a) => a.id === e.target.value);
        edit({ ...structure, areas: structure.areas.map((a, i) => i === index ? { ...a, existing_id: existing?.id ?? null, name: existing?.name ?? a.name } : a) });
      }}><option value="">Create a general area</option>{context.areas.map((a) => <option key={a.id} value={a.id}>Reuse {a.name}</option>)}</select></label>
      <label className="block">Area name<input className={input} value={area.name} readOnly={Boolean(area.existing_id)} onChange={(e) => edit({ ...structure, areas: structure.areas.map((a, i) => i === index ? { ...a, name: e.target.value } : a) })} /></label>
      <label className="block">Domain<select className={input} value={area.domain_key ?? ''} onChange={(e) => edit({ ...structure, areas: structure.areas.map((a, i) => i === index ? { ...a, domain_key: e.target.value || null } : a) })}><option value="">Unassigned</option>{structure.domains.filter((d) => d.selected).map((d) => <option key={d.key} value={d.key}>{d.name}</option>)}</select></label>
    </fieldset>)}
    <button type="button" className={button} disabled={busy || Boolean(preview)} onClick={() => edit({ ...structure, areas: [...structure.areas, { key: crypto.randomUUID(), name: '', selected: true }] })}>Add general area</button>
    {context.capabilities.some((c) => c.id === 'structured_interpretation' && c.status === 'tested') && <div className="space-y-3 rounded border border-line p-3">
      <label className="block">Describe the structure you want<textarea className={input} value={text} onChange={(e) => setText(e.target.value)} /></label>
      <p className="text-sm">This text is sent to your configured model only when you request suggestions.</p>
      <button type="button" className={button} disabled={busy || !text.trim()} onClick={async () => { setBusy(true); try { const result = await interpretCoreStructureAction(text); if (result.ok) setSuggestion(result.value); else setError(result.error.replaceAll('_', ' ')); } finally { setBusy(false); } }}>Suggest domains</button>
      {suggestion && <div><p>Proposed domains: {suggestion.domains.map((d) => d.name).join(', ')}.</p><button type="button" className={button} onClick={() => { edit({ ...structure, domains: [...structure.domains, ...suggestion.domains] }); setSuggestion(null); }}>Add suggestions to editable list</button></div>}
    </div>}
    <button type="button" className={button} disabled={busy} onClick={async () => {
      setBusy(true); setError(null);
      try { const saved = await save(); if (!saved) return; const result = await previewOnboardingAction({ id: session.id, expected_revision: saved.revision, action_id: 'structure' });
        if (result.ok) { setPreview(result.value); key.current = crypto.randomUUID(); } else setError(result.error.replaceAll('_', ' '));
      } finally { setBusy(false); }
    }}>Preview structure</button>
    {preview && <div className="space-y-3 rounded border border-line p-3"><h3 className="font-semibold">Structure to save now</h3><ul>{preview.changes.map((change, index) => <li key={index}>{change.label}</li>)}</ul>
      {!preview.changes.length && <p>No domains or areas selected.</p>}
      <button type="button" className={button} disabled={busy} onClick={async () => {
        setBusy(true); setError(null);
        try { const result = await completeOnboardingAction({ id: session.id, expected_revision: preview.revision, operation_key: key.current!, preview_fingerprint: preview.fingerprint, action_id: 'structure' });
          if (result.ok) { onSession(result.value.session); setPreview(null); await refresh(); } else setError(result.error.replaceAll('_', ' '));
        } finally { setBusy(false); }
      }}>Apply structure now</button> <button type="button" className={button} disabled={busy} onClick={() => setPreview(null)}>Edit selection</button>
    </div>}
    {context.receipts.some((r) => r.action_id === 'structure') && <p role="status">Your applied structure is saved. Reapplying the same choices reuses those records.</p>}
    {error && <p role="alert">{error}. Review the selected existing records and retry.</p>}
  </div>;
}

function VehicleStep({ values, onChange, session, save, context, blockNavigation }: OnboardingStepProps & { context: CoreSetupContext }) {
  const router = useRouter();
  const key = useRef<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { blockNavigation(busy); return () => blockNavigation(false); }, [busy, blockNavigation]);
  return <div className="space-y-4"><p>Add a vehicle using the same setup available from Assets. It can be saved for later independently of workspace setup.</p>
    {context.children.length > 0 && <ul>{context.children.map((child) => <li key={child.id}><Link className="underline" href={`/onboarding/${child.id}`}>Vehicle setup — {child.status.replaceAll('_', ' ')}</Link></li>)}</ul>}
    <label className="block">Vehicle domain (optional)<select className={input} value={String(values.domain_id ?? '')} onChange={(event) => onChange({ ...values, domain_id: event.target.value || null })}><option value="">Choose later</option>{context.domains.map((domain) => <option key={domain.id} value={domain.id}>{domain.name}</option>)}</select></label>
    <button type="button" className={button} disabled={busy} onClick={async () => {
      setBusy(true); key.current ??= crypto.randomUUID();
      try {
        if (!await save()) return;
        const result = await startOnboardingAction({ module_id: 'vehicle', creation_key: key.current, entry_point: 'first_run', parent_session_id: session.id,
          ...(typeof values.domain_id === 'string' ? { draft: { plans: { domain_id: values.domain_id } } } : {}) });
        if (result.ok) router.push(`/onboarding/${result.value.id}`); else setError(result.error.replaceAll('_', ' '));
      } finally { setBusy(false); }
    }}>{context.children.length ? 'Add another vehicle' : 'Add a vehicle now'}</button>
    <label className="block"><input type="checkbox" checked={values.deferred === true} onChange={(event) => onChange({ ...values, deferred: event.target.checked })} /> Do this later</label>
    {error && <p role="alert">{error}</p>}
  </div>;
}
