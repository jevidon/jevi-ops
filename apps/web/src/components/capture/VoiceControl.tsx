'use client';

import { Icon } from '../Icon';
import type { AudioPhase } from '@/lib/use-audio-capture';
import type { VoiceResult } from '@/lib/voice-actions';
import { ResultChip } from './ResultChip';

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
  onStart,
  onStop,
  onCancel,
  mobileHint,
}: {
  state: AudioPhase<VoiceResult>;
  elapsed: number;
  onStart: () => void;
  onStop: () => void;
  onCancel: () => void;
  mobileHint?: boolean;
}) {
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
