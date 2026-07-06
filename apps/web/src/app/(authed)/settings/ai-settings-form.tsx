'use client';

import { useState, useTransition } from 'react';
import type { AppSettings } from '@/lib/api';
import {
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
            <select value={provider} onChange={(e) => setProvider(e.target.value)} className={inputCls}>
              <option value="">— env default —</option>
              <option value="openai_compatible">OpenAI-compatible (local)</option>
              <option value="anthropic">Anthropic (cloud fallback)</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="eyebrow">Model</span>
            <input value={llmModel} onChange={(e) => setLlmModel(e.target.value)}
              placeholder="e.g. qwen3-32b" className={inputCls} />
          </label>
          <label className="flex flex-col gap-1 sm:col-span-2">
            <span className="eyebrow">Base URL (OpenAI-compatible)</span>
            <input value={llmBaseUrl} onChange={(e) => setLlmBaseUrl(e.target.value)}
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
