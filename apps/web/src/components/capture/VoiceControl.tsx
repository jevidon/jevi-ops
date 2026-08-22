'use client';

import { useRef, useState } from 'react';
import { Icon } from '../Icon';
import type { AudioPhase, AudioSupport } from '@/lib/use-audio-capture';
import type { VoiceResult } from '@/lib/voice-actions';
import { ResultChip } from './ResultChip';

// Client-side ceiling for uploaded recordings — just under the 25MB server
// action body limit so oversized files fail fast with a real message.
const MAX_UPLOAD_BYTES = 24 * 1024 * 1024;

export function formatElapsed(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// The voice row inside the open portal. The star-triggered flow (portal
// closed) renders the fixed overlay in CapturePortal instead — same state
// machine, different slot.

export function VoiceControl({
  state,
  elapsed,
  support,
  onStart,
  onStop,
  onCancel,
  onUploadFile,
  mobileHint,
}: {
  state: AudioPhase<VoiceResult>;
  elapsed: number;
  support: AudioSupport;
  onStart: () => void;
  onStop: () => void;
  onCancel: () => void;
  onUploadFile: (file: File) => void;
  mobileHint?: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [tooBig, setTooBig] = useState(false);

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file
    if (!file) return;
    if (file.size > MAX_UPLOAD_BYTES) {
      setTooBig(true);
      return;
    }
    setTooBig(false);
    onUploadFile(file);
  }
  if (state.phase === 'recording') {
    return (
      <div className="flex items-center gap-3">
        <span className="relative flex h-2.5 w-2.5 shrink-0">
          <span className="motion-safe:animate-ping absolute inline-flex h-full w-full rounded-full bg-accent opacity-60" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-accent" />
        </span>
        <span className="font-sans text-[13px] text-ink flex-1">
          Listening · <span className="font-mono tabular-nums">{formatElapsed(elapsed)}</span>
        </span>
        <button
          type="button"
          onClick={onCancel}
          className="font-mono text-[10px] uppercase tracking-wider text-ink-3 hover:text-ink transition-colors"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onStop}
          className="px-3 py-1.5 bg-accent text-bg font-mono text-[10px] uppercase tracking-wider hover:opacity-90 transition-opacity"
        >
          Stop &amp; submit
        </button>
      </div>
    );
  }

  if (state.phase === 'submitting') {
    return (
      <div className="flex items-center gap-3 font-sans text-[13px] text-ink-2">
        <span className="h-3.5 w-3.5 shrink-0 rounded-full border-2 border-ink-3 border-t-transparent motion-safe:animate-spin" />
        Transcribing…
      </div>
    );
  }

  if (state.phase === 'done' || state.phase === 'error') {
    return (
      <div className="-mx-4">
        {state.phase === 'done' ? (
          <ResultChip result={state.result} />
        ) : (
          <ResultChip result={{ kind: 'http_error', message: state.message }} />
        )}
      </div>
    );
  }

  // Idle. Where live recording is impossible, be honest about why and offer
  // the failover: an audio-file upload into the same STT pipeline (record in
  // Voice Memos → upload works).
  if (!support.ok) {
    return (
      <div className="flex flex-col gap-2">
        <span className="font-sans text-[12px] text-ink-3 leading-relaxed">
          {support.reason === 'insecure-context'
            ? 'Voice needs a secure (HTTPS) connection — this page loaded over plain HTTP. Type it above, or upload a recording:'
            : "This browser can't record audio. Type it above, or upload a recording:"}
        </span>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="inline-flex items-center gap-2 px-3 py-1.5 border border-line rounded text-ink-2 hover:border-ink-3 hover:text-ink font-mono text-[10px] uppercase tracking-wider transition-colors"
          >
            <Icon name="mic" size={16} />
            Upload audio
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="audio/*"
            onChange={onFileChange}
            className="sr-only"
            aria-label="Upload an audio recording"
          />
          {tooBig && (
            <span className="font-sans text-[12px] text-accent">
              That file is over 24MB — trim it first.
            </span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={onStart}
        className="inline-flex items-center gap-2 px-3 py-1.5 border border-line rounded text-ink-2 hover:border-ink-3 hover:text-ink font-mono text-[10px] uppercase tracking-wider transition-colors"
      >
        <Icon name="mic" size={16} />
        Record
      </button>
      <span className="font-sans text-[12px] text-ink-3">
        {mobileHint ? 'or long-press the ✦ star anywhere.' : 'Speak it instead of typing it.'}
      </span>
    </div>
  );
}
