'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import type { AppSettings, CredentialAction, UpdateAppSettingsBody } from '@/lib/api';
import { testLlmAction, testSttAction, testImmichAction, updateIntegrationSettingsAction, type SyncResult } from './actions';

type Integration = 'llm' | 'stt' | 'immich';
const inputCls = 'bg-transparent border border-line focus:border-accent focus:outline-none p-2 font-sans text-[14px] text-ink w-full';
const buttonCls = 'border border-line hover:border-ink text-ink px-3 py-2 disabled:opacity-40 font-sans text-sm';

export function AiSettingsForm({ current, integrations = ['llm', 'stt', 'immich'], onSaved, onBusy, onDirty }: { current: AppSettings; integrations?: Integration[]; onSaved?: (settings: AppSettings) => void; onBusy?: (busy: boolean) => void; onDirty?: (dirty: boolean) => void }) {
  const [settings, setSettings] = useState(current);
  const [busy, setBusy] = useState<Partial<Record<Integration, boolean>>>({});
  const [dirty, setDirty] = useState<Partial<Record<Integration, boolean>>>({});
  const setEditorBusy = useCallback((name: Integration, value: boolean) => setBusy((old) => old[name] === value ? old : { ...old, [name]: value }), []);
  const setEditorDirty = useCallback((name: Integration, value: boolean) => setDirty((old) => old[name] === value ? old : { ...old, [name]: value }), []);
  const anyBusy = Object.values(busy).some(Boolean);
  const anyDirty = Object.values(dirty).some(Boolean);
  useEffect(() => { onBusy?.(anyBusy); }, [anyBusy, onBusy]);
  useEffect(() => { onDirty?.(anyDirty); }, [anyDirty, onDirty]);
  const callbacks = useRef({ onBusy, onDirty });
  callbacks.current = { onBusy, onDirty };
  useEffect(() => () => { callbacks.current.onBusy?.(false); callbacks.current.onDirty?.(false); }, []);
  if (!settings.revision) return <p role="alert">Settings are unavailable. Restore the API/database connection and reload before configuring integrations.</p>;
  return <div className="flex flex-col gap-8">
    <p className="text-sm text-ink-3">Saved credentials are never shown. Connection tests use the fields below without changing the active configuration. Saving takes effect immediately. External research requires a separate worker.</p>
    {integrations.map((integration) => <IntegrationEditor key={integration} integration={integration} settings={settings} onBusy={setEditorBusy} onDirty={setEditorDirty} onSave={(saved) => { setSettings(saved); onSaved?.(saved); }} />)}
  </div>;
}
function IntegrationEditor({ integration, settings, onSave, onBusy, onDirty }: { integration: Integration; settings: AppSettings; onSave: (settings: AppSettings) => void; onBusy: (integration: Integration, busy: boolean) => void; onDirty: (integration: Integration, dirty: boolean) => void }) {
  const [provider, setProvider] = useState(settings.llm_provider ?? '');
  const [baseUrl, setBaseUrl] = useState((integration === 'llm' ? settings.llm_base_url : integration === 'stt' ? settings.stt_base_url : settings.immich_base_url) ?? '');
  const [model, setModel] = useState((integration === 'llm' ? settings.llm_model : settings.stt_model) ?? '');
  const [credentialAction, setCredentialAction] = useState<CredentialAction['action']>('keep');
  const [secret, setSecret] = useState('');
  const [insecure, setInsecure] = useState(settings.credentials[integration].allow_insecure);
  const [state, setState] = useState<SyncResult | null>(null);
  const [pending, startTransition] = useTransition();
  useEffect(() => { onBusy(integration, pending); }, [integration, pending, onBusy]);
  const credential = settings.credentials[integration];
  const capability = settings.capabilities[integration];
  const names = { llm: 'Language model', stt: 'Speech to text', immich: 'Immich photos' };
  const change = (fn: () => void) => { fn(); setState(null); onDirty(integration, true); };
  function candidate(): UpdateAppSettingsBody {
    const action: CredentialAction = credentialAction === 'replace' ? { action: 'replace', value: secret } : { action: credentialAction };
    const fields = integration === 'llm'
      ? { llm_provider: provider === '' ? null : provider as 'openai_compatible' | 'anthropic', llm_base_url: baseUrl || null, llm_model: model || null, llm_credential: action, llm_allow_insecure_credentials: insecure }
      : integration === 'stt' ? { stt_base_url: baseUrl || null, stt_model: model || null, stt_credential: action, stt_allow_insecure_credentials: insecure }
        : { immich_base_url: baseUrl || null, immich_credential: action, immich_allow_insecure_credentials: insecure };
    return { expected_revision: settings.revision, ...fields };
  }
  function save() {
    startTransition(async () => {
      try {
        const result = await updateIntegrationSettingsAction(candidate());
        setState(result);
        if (result.ok && result.settings) { onSave(result.settings); setSecret(''); setCredentialAction('keep'); onDirty(integration, false); }
      } catch { setState({ ok: false, message: 'Connection interrupted. Your inputs are preserved; reload to check whether the save completed before retrying.' }); }
    });
  }
  function discard() {
    setProvider(settings.llm_provider ?? '');
    setBaseUrl((integration === 'llm' ? settings.llm_base_url : integration === 'stt' ? settings.stt_base_url : settings.immich_base_url) ?? '');
    setModel((integration === 'llm' ? settings.llm_model : settings.stt_model) ?? '');
    setSecret(''); setCredentialAction('keep'); setInsecure(settings.credentials[integration].allow_insecure); setState(null); onDirty(integration, false);
  }
  function test(kind: 'text' | 'structured' | 'tools' = 'text') {
    startTransition(async () => {
      const body = { candidate: candidate(), capability: kind };
      try { setState(await (integration === 'llm' ? testLlmAction(body) : integration === 'stt' ? testSttAction(body) : testImmichAction(body))); }
      catch { setState({ ok: false, message: 'Connection interrupted. Your inputs are preserved.' }); }
    });
  }
  return <fieldset disabled={pending} className="flex flex-col gap-3 border-t border-line pt-4">
    <legend className="font-semibold">{names[integration]}</legend>
    <p className="text-sm text-ink-3">Credential source: {credential.source}. State: {credential.state.replaceAll('_', ' ')}. Active target: {credential.endpoint ?? 'not set'}.</p>
    <p className="text-sm text-ink-3">Active configuration: {capability?.configured ? 'configured' : 'unavailable'}. {capability?.tests.length ? capability.tests.map((t) => `${t.capability.replaceAll('_', ' ')}: ${t.status} (${new Date(t.tested_at).toLocaleString()})`).join('; ') : 'No successful capability checks recorded for this configuration.'}</p>
    {integration === 'llm' && <label>Provider<select aria-label="LLM provider" value={provider} onChange={(e) => change(() => setProvider(e.target.value))} className={inputCls}>
      <option value="">Use environment provider</option><option value="openai_compatible">OpenAI compatible</option><option value="anthropic">Anthropic</option>
    </select></label>}
    <label>Endpoint URL {integration === 'llm' ? '(OpenAI compatible)' : ''}<input aria-label={`${names[integration]} endpoint`} value={baseUrl} onChange={(e) => change(() => setBaseUrl(e.target.value))} className={inputCls} placeholder="Blank uses the environment endpoint" /></label>
    {integration !== 'immich' && <label>Model identifier<input aria-label={`${names[integration]} model`} value={model} onChange={(e) => change(() => setModel(e.target.value))} className={inputCls} placeholder="Blank uses the environment model" /></label>}
    <label>Credential action<select aria-label={`${names[integration]} credential action`} value={credentialAction} onChange={(e) => change(() => { setCredentialAction(e.target.value as CredentialAction['action']); setSecret(''); })} className={inputCls}>
      <option value="keep">Keep current credential</option><option value="replace">Replace with a new credential</option><option value="clear">Use no credential (disable environment fallback)</option><option value="use_environment">Use the environment credential for this endpoint</option>
    </select></label>
    {credentialAction === 'replace' && <label>New API key<input aria-label={`${names[integration]} new API key`} type="password" autoComplete="new-password" value={secret} onChange={(e) => change(() => setSecret(e.target.value))} className={inputCls} /></label>}
    <label className="text-sm"><input type="checkbox" checked={insecure} onChange={(e) => change(() => setInsecure(e.target.checked))} /> I allow credentials to be sent over HTTP to this non-local endpoint. Use HTTPS where available.</label>
    <p className="text-sm text-ink-3">Changing an endpoint or provider requires an explicit credential selection. Private network and Tailscale endpoints are supported. “Use no credential” is suitable for local services without authentication; cloud services will usually require a key.</p>
    <div className="flex flex-wrap gap-2"><button type="button" className={buttonCls} onClick={save}>Save {names[integration]}</button><button type="button" className={buttonCls} onClick={discard}>Discard unsaved inputs</button>
      <button type="button" className={buttonCls} onClick={() => test()}>{integration === 'llm' ? 'Test text' : 'Test authenticated reachability'}</button>
      {integration === 'llm' && <><button type="button" className={buttonCls} onClick={() => test('structured')}>Test structured output</button><button type="button" className={buttonCls} onClick={() => test('tools')}>Test tool calls</button></>}
    </div>
    {state && <p role="status" className={`text-sm ${state.ok ? 'text-ink-2' : 'text-accent'}`}>{state.message}</p>}
  </fieldset>;
}
