'use client';

import { useCallback, useEffect, useId, useRef, useState, useTransition } from 'react';
import type { AppSettings, ModelDiscoveryResult } from '@/lib/api';
import {
  discoverLlmModelsAction,
  testLlmAction,
  testSttAction,
  updateIntegrationSettingsAction,
  type SyncResult,
} from './actions';

// AI (LLM + STT) + Immich configuration. Values stored in app_settings act
// as overrides; blank fields fall back to the API's env vars. One form,
// three save groups so a test button sits next to the fields it exercises.

const inputCls =
  'bg-transparent border border-line focus:border-accent focus:outline-none p-2 font-sans text-[14px] text-ink w-full';
const btnCls =
  'bg-ink hover:bg-ink-2 disabled:opacity-40 disabled:cursor-not-allowed text-bg font-sans font-semibold text-[12px] uppercase tracking-wider px-3 py-2 transition-colors';
const ghostBtnCls =
  'border border-line hover:border-ink-2 text-ink-2 hover:text-ink font-mono text-[10px] uppercase tracking-wider px-3 py-2 transition-colors disabled:opacity-40';

function StatusLine({ state }: { state: SyncResult | null }) {
  if (!state) return null;
  return (
    <div className={`font-mono text-[11px] tracking-wider ${state.ok ? 'text-ink-2' : 'text-accent'}`}>
      {state.message}
    </div>
  );
}

export function AiSettingsForm({ current }: { current: AppSettings }) {
  const [pending, startTransition] = useTransition();

  // ── LLM ──
  const [provider, setProvider] = useState(current.llm_provider ?? '');
  const [llmBaseUrl, setLlmBaseUrl] = useState(current.llm_base_url ?? '');
  const [llmModel, setLlmModel] = useState(current.llm_model ?? '');
  const [llmApiKey, setLlmApiKey] = useState(current.llm_api_key ?? '');
  const [llmState, setLlmState] = useState<SyncResult | null>(null);
  const [discovery, setDiscovery] = useState<ModelDiscoveryResult | null>(null);
  const [discovering, setDiscovering] = useState(false);
  const modelListId = useId();
  const discoveryRequest = useRef(0);
  const modelEdits = useRef(0);
  const autoDiscovered = useRef(false);
  const canDiscover = provider !== 'anthropic' && llmBaseUrl.trim() !== '';

  const clearDiscovery = () => {
    discoveryRequest.current += 1;
    setDiscovery(null);
    setDiscovering(false);
  };

  const discoverModels = useCallback(async () => {
    const request = ++discoveryRequest.current;
    const edits = modelEdits.current;
    setDiscovering(true);
    setDiscovery(null);
    try {
      const result = await discoverLlmModelsAction(llmBaseUrl.trim());
      // Ignore results for an old URL/provider and preserve edits made while
      // the request was running, including a custom model typed by the user.
      if (request !== discoveryRequest.current) return;
      setDiscovery(result);
      if (result.ok && result.models.length === 1 && modelEdits.current === edits) {
        setLlmModel(result.models[0]!);
      }
    } catch (err) {
      if (request !== discoveryRequest.current) return;
      setDiscovery({ ok: false, error: 'discover_unreachable', detail: err instanceof Error ? err.message : 'Could not reach the API.' });
    } finally {
      if (request === discoveryRequest.current) setDiscovering(false);
    }
  }, [llmBaseUrl]);

  useEffect(() => {
    if (autoDiscovered.current) return;
    autoDiscovered.current = true;
    if (canDiscover && !llmModel.trim()) void discoverModels();
  }, [canDiscover, llmModel, discoverModels]);

  // ── STT ──
  const [sttBaseUrl, setSttBaseUrl] = useState(current.stt_base_url ?? '');
  const [sttModel, setSttModel] = useState(current.stt_model ?? '');
  const [sttState, setSttState] = useState<SyncResult | null>(null);

  // ── Immich ──
  const [immichBaseUrl, setImmichBaseUrl] = useState(current.immich_base_url ?? '');
  const [immichApiKey, setImmichApiKey] = useState(current.immich_api_key ?? '');
  const [immichState, setImmichState] = useState<SyncResult | null>(null);

  const saveLlm = () =>
    startTransition(async () => {
      setLlmState(await updateIntegrationSettingsAction({
        llm_provider: provider === '' ? null : (provider as 'openai_compatible' | 'anthropic'),
        llm_base_url: llmBaseUrl,
        llm_model: llmModel,
        llm_api_key: llmApiKey,
      }));
    });
  const testLlm = () => startTransition(async () => setLlmState(await testLlmAction()));

  const saveStt = () =>
    startTransition(async () => {
      setSttState(await updateIntegrationSettingsAction({
        stt_base_url: sttBaseUrl,
        stt_model: sttModel,
      }));
    });
  const testStt = () => startTransition(async () => setSttState(await testSttAction()));

  const saveImmich = () =>
    startTransition(async () => {
      setImmichState(await updateIntegrationSettingsAction({
        immich_base_url: immichBaseUrl,
        immich_api_key: immichApiKey,
      }));
    });

  return (
    <div className="flex flex-col gap-8">
      {/* ── LLM ── */}
      <div className="flex flex-col gap-3">
        <div className="font-mono text-[10px] uppercase tracking-wider text-ink-3">
          Language model — voice parser + chat
        </div>
        <p className="font-sans text-[12px] text-ink-3 leading-relaxed">
          Point at any OpenAI-compatible server on your tailnet (llama.cpp
          <code className="font-mono"> llama-server --jinja</code>, MLX, Ollama, vLLM…).
          Blank fields fall back to the API&rsquo;s env vars. Switch the provider to
          Anthropic to use the cloud fallback instead.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <span className="eyebrow">Provider</span>
            <select value={provider} onChange={(e) => { clearDiscovery(); setProvider(e.target.value); }} className={inputCls}>
              <option value="">— env default —</option>
              <option value="openai_compatible">OpenAI-compatible (local)</option>
              <option value="anthropic">Anthropic (cloud fallback)</option>
            </select>
          </label>
          <div className="flex flex-col gap-1">
            <label htmlFor={`${modelListId}-input`} className="eyebrow">Model</label>
            <div className="flex items-center gap-2">
              <input id={`${modelListId}-input`} value={llmModel}
                onChange={(e) => { modelEdits.current += 1; setLlmModel(e.target.value); }}
                list={discovery?.ok ? modelListId : undefined}
                aria-describedby={discovery ? `${modelListId}-status` : undefined}
                placeholder="e.g. qwen3-32b" className={`${inputCls} min-w-0`} />
              {provider !== 'anthropic' && (
                <button type="button" onClick={() => void discoverModels()} disabled={!canDiscover || discovering}
                  className={`${ghostBtnCls} shrink-0`}>
                  {discovering ? 'Discovering…' : 'Discover models'}
                </button>
              )}
            </div>
            {discovery?.ok && (
              <datalist id={modelListId}>
                {discovery.models.map((model) => (
                  <option key={model} value={model} label={discovery.loaded?.includes(model) ? `${model} (loaded)` : model} />
                ))}
              </datalist>
            )}
            {discovery && (
              <p id={`${modelListId}-status`} role="status" className={`font-mono text-[11px] ${discovery.ok ? 'text-ink-3' : 'text-accent'}`}>
                {discovery.ok
                  ? discovery.models.length ? 'Choose a discovered model or enter a custom model ID.' : 'No models found. Enter a custom model ID.'
                  : `server unreachable: ${discovery.detail}`}
              </p>
            )}
          </div>
          <label className="flex flex-col gap-1 sm:col-span-2">
            <span className="eyebrow">Base URL (OpenAI-compatible)</span>
            <input value={llmBaseUrl} onChange={(e) => { clearDiscovery(); setLlmBaseUrl(e.target.value); }}
              placeholder="http://llama-box:8080/v1" className={inputCls} />
          </label>
          <label className="flex flex-col gap-1 sm:col-span-2">
            <span className="eyebrow">API key (optional for local servers)</span>
            <input value={llmApiKey} onChange={(e) => setLlmApiKey(e.target.value)}
              type="password" autoComplete="off" placeholder="leave blank if not required" className={inputCls} />
          </label>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={saveLlm} disabled={pending} className={btnCls}>Save LLM</button>
          <button onClick={testLlm} disabled={pending} className={ghostBtnCls}>Test connection</button>
        </div>
        <StatusLine state={llmState} />
      </div>

      {/* ── STT ── */}
      <div className="flex flex-col gap-3">
        <div className="font-mono text-[10px] uppercase tracking-wider text-ink-3">
          Speech-to-text — voice memo transcription
        </div>
        <p className="font-sans text-[12px] text-ink-3 leading-relaxed">
          Any OpenAI-compatible <code className="font-mono">/v1/audio/transcriptions</code> server
          (speaches, faster-whisper-server, whisper.cpp server). Runs as its own app —
          see the dependencies guide.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <span className="eyebrow">Base URL</span>
            <input value={sttBaseUrl} onChange={(e) => setSttBaseUrl(e.target.value)}
              placeholder="http://stt-box:8000/v1" className={inputCls} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="eyebrow">Model</span>
            <input value={sttModel} onChange={(e) => setSttModel(e.target.value)}
              placeholder="e.g. Systran/faster-whisper-small" className={inputCls} />
          </label>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={saveStt} disabled={pending} className={btnCls}>Save STT</button>
          <button onClick={testStt} disabled={pending} className={ghostBtnCls}>Test connection</button>
        </div>
        <StatusLine state={sttState} />
      </div>

      {/* ── Immich ── */}
      <div className="flex flex-col gap-3">
        <div className="font-mono text-[10px] uppercase tracking-wider text-ink-3">
          Immich — journal photo suggestions
        </div>
        <p className="font-sans text-[12px] text-ink-3 leading-relaxed">
          Connect your Immich server so journal entries can surface the photos you
          took that day. Generate an API key in Immich under Account Settings → API keys.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <span className="eyebrow">Base URL</span>
            <input value={immichBaseUrl} onChange={(e) => setImmichBaseUrl(e.target.value)}
              placeholder="http://immich:2283" className={inputCls} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="eyebrow">API key</span>
            <input value={immichApiKey} onChange={(e) => setImmichApiKey(e.target.value)}
              type="password" autoComplete="off" className={inputCls} />
          </label>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={saveImmich} disabled={pending} className={btnCls}>Save Immich</button>
        </div>
        <StatusLine state={immichState} />
      </div>
    </div>
  );
}
