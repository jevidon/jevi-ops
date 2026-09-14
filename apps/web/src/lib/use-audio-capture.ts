'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';

// Browser audio capture state machine, extracted from the old MicFAB so the
// Capture Portal (and eventually the chat composer) share one recorder.
// MediaRecorder → Blob → caller-supplied submit. We deliberately avoid the
// Web Speech API: it relies on Google's cloud speech endpoint, which
// DNS-level ad blockers, VPNs, and strict firewalls often block.
//
// Two-step reporting: `submit` receives a `report` callback so the durable
// storage receipt can be shown ("reporting" phase) while a later, slower
// step (interpretation) is still running; the final result lands in "done".
// The last FormData (blob + client ids) is retained so an incomplete upload
// can be retried with the same identities.

export type AudioPhase<T> =
  | { phase: 'idle' }
  | { phase: 'recording'; startedAt: number }
  | { phase: 'submitting' }
  | { phase: 'reporting'; result: T }
  | { phase: 'done'; result: T }
  | { phase: 'error'; message: string };

export type AudioSupport =
  | { ok: true }
  | { ok: false; reason: 'insecure-context' | 'no-media-api' };

export function getAudioSupport(): AudioSupport {
  if (typeof navigator === 'undefined') return { ok: false, reason: 'no-media-api' }; // SSR — callers gate client-side
  if (
    typeof navigator.mediaDevices?.getUserMedia === 'function' &&
    typeof MediaRecorder !== 'undefined'
  ) {
    return { ok: true };
  }
  if (typeof window !== 'undefined' && window.isSecureContext === false) {
    return { ok: false, reason: 'insecure-context' };
  }
  return { ok: false, reason: 'no-media-api' };
}

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

export function useAudioCapture<T>(opts: {
  // Receives FormData with the recording under field name `audio`
  // (`voice.<ext>`) plus whatever the caller sets on it, and a `report`
  // callback for an interim result (the storage receipt).
  submit: (formData: FormData, report: (interim: T) => void) => Promise<T>;
  // done/error → idle after this long. 0 disables.
  autoDismissMs?: number;
  // Which final results may auto-dismiss (default: all). Results that need
  // the user (an incomplete upload, a review request) should return false.
  shouldAutoDismiss?: (result: T) => boolean;
}): {
  state: AudioPhase<T>;
  elapsed: number; // seconds, ticks while recording
  start: () => Promise<void>;
  stop: () => void; // stop → blob → submit
  cancel: () => void; // stop + discard, no submit
  submitBlob: (blob: Blob, filename: string) => void;
  // Re-submit the last recording with the same FormData (same ids).
  retry: () => void;
} {
  const { submit, autoDismissMs = 5000, shouldAutoDismiss } = opts;
  const [state, setState] = useState<AudioPhase<T>>({ phase: 'idle' });
  const [elapsed, setElapsed] = useState(0);
  const [, startTransition] = useTransition();

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const mimeRef = useRef<string>('');
  const cancelledRef = useRef(false);
  const submitRef = useRef(submit);
  submitRef.current = submit;
  const lastFormRef = useRef<FormData | null>(null);

  useEffect(() => {
    if (state.phase !== 'recording') return;
    const started = state.startedAt;
    const interval = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 250);
    return () => clearInterval(interval);
  }, [state]);

  useEffect(() => {
    if (!autoDismissMs) return;
    if (state.phase !== 'done' && state.phase !== 'error') return;
    if (state.phase === 'done' && shouldAutoDismiss && !shouldAutoDismiss(state.result)) return;
    const t = setTimeout(() => setState({ phase: 'idle' }), autoDismissMs);
    return () => clearTimeout(t);
  }, [state, autoDismissMs, shouldAutoDismiss]);

  useEffect(() => {
    return () => {
      cancelledRef.current = true;
      try { recorderRef.current?.stop(); } catch { /* noop */ }
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const stopTracks = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const run = useCallback((formData: FormData) => {
    lastFormRef.current = formData;
    setState({ phase: 'submitting' });
    startTransition(async () => {
      const result = await submitRef.current(formData, (interim) => setState({ phase: 'reporting', result: interim }));
      setState({ phase: 'done', result });
    });
  }, []);

  const start = useCallback(async () => {
    const support = getAudioSupport();
    if (!support.ok) {
      setState({
        phase: 'error',
        message:
          support.reason === 'insecure-context'
            ? 'Voice capture needs a secure (HTTPS) connection — this page loaded over plain HTTP.'
            : 'Audio recording not supported in this browser.',
      });
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
    cancelledRef.current = false;

    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, {
        ...(mime ? { mimeType: mime } : {}),
        // 32 kbps Opus is the speech-quality sweet spot for Whisper.
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
      const discarded = cancelledRef.current;
      const blob = new Blob(chunksRef.current, { type: mimeRef.current || 'audio/webm' });
      chunksRef.current = [];
      if (discarded) return;
      if (blob.size === 0) {
        setState({ phase: 'error', message: 'No audio captured. Try again.' });
        return;
      }
      const formData = new FormData();
      formData.append('audio', blob, `voice.${extensionFor(blob.type)}`);
      run(formData);
    };
    recorder.onerror = () => {
      stopTracks();
      setState({ phase: 'error', message: 'Recording failed.' });
    };

    streamRef.current = stream;
    recorderRef.current = recorder;
    recorder.start(1000);
    setElapsed(0);
    setState({ phase: 'recording', startedAt: Date.now() });
  }, [stopTracks, run]);

  const stop = useCallback(() => {
    const r = recorderRef.current;
    if (!r) return;
    if (r.state !== 'inactive') r.stop(); // triggers onstop → submit
  }, []);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    const r = recorderRef.current;
    if (r && r.state !== 'inactive') {
      try { r.stop(); } catch { /* noop */ }
    }
    stopTracks();
    chunksRef.current = [];
    setState({ phase: 'idle' });
  }, [stopTracks]);

  const submitBlob = useCallback((blob: Blob, filename: string) => {
    if (blob.size === 0) {
      setState({ phase: 'error', message: 'That file is empty.' });
      return;
    }
    const formData = new FormData();
    formData.append('audio', blob, filename);
    run(formData);
  }, [run]);

  const retry = useCallback(() => {
    if (lastFormRef.current) run(lastFormRef.current);
  }, [run]);

  return { state, elapsed, start, stop, cancel, submitBlob, retry };
}
