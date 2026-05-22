'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { submitVoiceAudio, type VoiceResult } from '@/lib/voice-actions';

// Voice capture FAB. Records audio in the browser via MediaRecorder and ships
// the Blob to /api/capture/voice-audio for Whisper transcription + Claude
// parsing + execution against the DB.
//
// We dropped the Web Speech API path because it relies on Google's cloud
// speech endpoint, which DNS-level ad blockers, VPNs, and strict firewalls
// often block. MediaRecorder works offline and doesn't touch googleapis.com.

type State =
  | { phase: 'idle' }
  | { phase: 'recording'; startedAt: number }
  | { phase: 'submitting' }
  | { phase: 'done'; result: VoiceResult }
  | { phase: 'error'; message: string };

// Browser support is excellent for MediaRecorder + audio/webm;codecs=opus.
// Safari needs audio/mp4 fallback. We probe at runtime.
function pickMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4;codecs=mp4a.40.2',
    'audio/mp4',
    'audio/ogg;codecs=opus',
  ];
  for (const m of candidates) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return ''; // browser will pick a default
}

function extensionFor(mime: string): string {
  if (mime.includes('webm')) return 'webm';
  if (mime.includes('mp4')) return 'm4a';
  if (mime.includes('ogg')) return 'ogg';
  return 'webm';
}

export function MicFAB() {
  const [state, setState] = useState<State>({ phase: 'idle' });
  const [elapsed, setElapsed] = useState(0);
  const [isPending, startTransition] = useTransition();

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const mimeRef = useRef<string>('');

  // Tick a duration counter while recording.
  useEffect(() => {
    if (state.phase !== 'recording') return;
    const started = state.startedAt;
    const interval = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 250);
    return () => clearInterval(interval);
  }, [state]);

  // Auto-dismiss result/error chip after 5s.
  useEffect(() => {
    if (state.phase !== 'done' && state.phase !== 'error') return;
    const t = setTimeout(() => setState({ phase: 'idle' }), 5000);
    return () => clearTimeout(t);
  }, [state.phase]);

  // Cleanup if component unmounts mid-recording.
  useEffect(() => {
    return () => {
      try { recorderRef.current?.stop(); } catch { /* noop */ }
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const stopTracks = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const startRecording = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setState({ phase: 'error', message: 'Audio recording not supported in this browser.' });
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      const name = (err as Error).name;
      let message = 'Microphone access failed.';
      if (name === 'NotAllowedError') {
        message = 'Microphone permission denied. Check browser AND System Settings → Privacy → Microphone.';
      } else if (name === 'NotFoundError') {
        message = 'No microphone found. Plug one in or select an input device.';
      } else if (name === 'NotReadableError') {
        message = 'Microphone is in use by another app.';
      }
      setState({ phase: 'error', message });
      return;
    }

    const mime = pickMimeType();
    mimeRef.current = mime;
    chunksRef.current = [];

    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, {
        ...(mime ? { mimeType: mime } : {}),
        // 32 kbps Opus is the speech-quality sweet spot for Whisper. Browser
        // defaults vary (~20-32kbps); pinning makes file sizes predictable.
        audioBitsPerSecond: 32000,
      });
    } catch (err) {
      stream.getTracks().forEach((t) => t.stop());
      setState({ phase: 'error', message: `Couldn't start recorder: ${(err as Error).message}` });
      return;
    }

    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) chunksRef.current.push(event.data);
    };
    recorder.onstop = () => {
      stopTracks();
      const blob = new Blob(chunksRef.current, { type: mimeRef.current || 'audio/webm' });
      chunksRef.current = [];
      if (blob.size === 0) {
        setState({ phase: 'error', message: 'No audio captured. Try again.' });
        return;
      }
      setState({ phase: 'submitting' });
      const formData = new FormData();
      formData.append('audio', blob, `voice.${extensionFor(blob.type)}`);
      startTransition(async () => {
        const result = await submitVoiceAudio(formData);
        setState({ phase: 'done', result });
      });
    };
    recorder.onerror = (e) => {
      // eslint-disable-next-line no-console
      console.warn('[MicFAB] MediaRecorder error:', e);
      stopTracks();
      setState({ phase: 'error', message: 'Recording failed.' });
    };

    streamRef.current = stream;
    recorderRef.current = recorder;
    // 1s timeslice = ondataavailable fires every second. Helps catch all
    // chunks reliably (some browsers only emit on stop without a timeslice).
    recorder.start(1000);
    setElapsed(0);
    setState({ phase: 'recording', startedAt: Date.now() });
  }, [stopTracks]);

  const stopRecording = useCallback(() => {
    const r = recorderRef.current;
    if (!r) return;
    if (r.state !== 'inactive') {
      r.stop(); // triggers onstop → upload
    }
  }, []);

  const handleClick = useCallback(() => {
    switch (state.phase) {
      case 'idle':
      case 'done':
      case 'error':
        void startRecording();
        break;
      case 'recording':
        stopRecording();
        break;
      // submitting: ignore
    }
  }, [state, startRecording, stopRecording]);

  const recording = state.phase === 'recording';
  const submitting = state.phase === 'submitting' || isPending;

  return (
    <>
      {/* Recording bubble — duration + hint */}
      {recording && (
        <div className="fixed bottom-44 left-1/2 -translate-x-1/2 z-40 w-[88%] max-w-[420px] bg-ink/95 text-bg px-4 py-3 shadow-lg">
          <div className="eyebrow text-bg/70 mb-1">Listening · tap mic to stop</div>
          <div className="font-mono text-[18px] tabular-nums tracking-wider">
            {formatDuration(elapsed)}
          </div>
        </div>
      )}

      {state.phase === 'submitting' && (
        <div className="fixed bottom-44 left-1/2 -translate-x-1/2 z-40 w-[88%] max-w-[420px] bg-ink/95 text-bg px-4 py-3 shadow-lg">
          <div className="eyebrow text-bg/70 mb-1">Transcribing…</div>
          <div className="font-sans text-[13px]">Sending audio to Whisper, then parsing.</div>
        </div>
      )}

      {state.phase === 'done' && <ResultChip result={state.result} />}
      {state.phase === 'error' && (
        <div className="fixed bottom-32 left-1/2 -translate-x-1/2 z-40 w-[88%] max-w-[420px] bg-accent text-bg px-4 py-3 shadow-lg">
          <div className="font-mono text-[11px] uppercase tracking-wider">Error</div>
          <div className="font-sans text-[13px]">{state.message}</div>
        </div>
      )}

      <button
        aria-label={recording ? 'Stop recording' : submitting ? 'Submitting' : 'Voice capture'}
        onClick={handleClick}
        disabled={submitting}
        className={`fixed right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full shadow-lg transition-all ${
          recording ? 'bg-accent scale-110' :
          submitting ? 'bg-ink-2 cursor-wait' :
          'bg-ink hover:bg-ink-2'
        }`}
        style={{ bottom: 'calc(env(safe-area-inset-bottom) + 72px)' }}
      >
        {submitting ? <SpinnerIcon /> : <MicIcon className="h-6 w-6 text-bg" />}
        {recording && (
          <span className="absolute inset-0 -z-10 rounded-full bg-accent/40 animate-ping" />
        )}
      </button>
    </>
  );
}

function ResultChip({ result }: { result: VoiceResult }) {
  const isOk = result.kind === 'executed';
  const isWarn = result.kind === 'disambiguation';
  return (
    <div
      className={`fixed bottom-32 left-1/2 -translate-x-1/2 z-40 w-[88%] max-w-[420px] px-4 py-3 shadow-lg ${
        isOk ? 'bg-ink text-bg' : isWarn ? 'bg-surface-2 text-ink border border-line' : 'bg-accent text-bg'
      }`}
    >
      <div className="eyebrow opacity-70 mb-1">
        {isOk ? 'Voice' : isWarn ? 'Needs clarification' : 'Voice'}
      </div>
      <div className="font-sans text-[13px] leading-snug">
        {result.kind === 'executed' && result.summary}
        {result.kind === 'disambiguation' && `Ambiguous: ${result.field}. Try again with a more specific name.`}
        {result.kind === 'parse_error' && `Couldn't parse: ${result.message}`}
        {result.kind === 'http_error' && `Error: ${result.message}`}
      </div>
    </div>
  );
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function MicIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75}
      strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <rect x="9" y="3" width="6" height="12" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v3" />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg className="h-6 w-6 text-bg animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2.5" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}
