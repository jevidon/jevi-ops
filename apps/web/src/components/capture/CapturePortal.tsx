'use client';

import { useCallback, useEffect, useState } from 'react';
import { BottomSheet } from '../BottomSheet';
import { submitVoiceAudio, type VoiceResult } from '@/lib/voice-actions';
import { useAudioCapture, getAudioSupport, type AudioSupport } from '@/lib/use-audio-capture';
import { CaptureTypeGrid } from './CaptureTypeGrid';
import { CaptureTextBox } from './CaptureTextBox';
import { VoiceControl, formatElapsed } from './VoiceControl';
import { ResultChip } from './ResultChip';

// The Capture Portal — the app's single capture surface. One component,
// mounted once in the authed layout, rendered into two hosts: a BottomSheet
// on mobile, the old ⌘J palette's top-anchored modal on desktop. Contents
// (create-type grid, free-text parser box, voice) are identical in both.
//
// Openers, all funneled through one channel:
//   window.dispatchEvent(new CustomEvent('text-capture:open',
//     { detail: { mode: 'menu' | 'record' } }))
//   - BottomTabBar star: tap → menu, long-press → record (sheet stays
//     closed; the fixed listening bubble carries the state).
//   - Topbar + IconRail Capture buttons → menu.
//   - ⌘J keeps its historical TOGGLE semantics (the CustomEvent path always
//     opens) — the two paths are deliberately distinct.
// While recording, ANY open signal instead stops + submits — that is how
// "tap the star to stop" works without the star knowing recorder state.

export function CapturePortal() {
  const [open, setOpen] = useState(false);
  // The free-text draft lives here so the two hosts stay in sync; it
  // survives close (accidental dismiss mid-thought) and clears on submit.
  const [text, setText] = useState('');

  const audio = useAudioCapture<VoiceResult>({ submit: submitVoiceAudio });
  const { state: audioState, start: audioStart, stop: audioStop, cancel: audioCancel } = audio;
  const recording = audioState.phase === 'recording';

  // Probed once on mount (client-only — SSR can't know the context). Until
  // then we optimistically render the normal voice row; the buttons re-check
  // via start() anyway.
  const [support, setSupport] = useState<AudioSupport>({ ok: true });
  useEffect(() => {
    setSupport(getAudioSupport());
  }, []);

  const close = useCallback(() => setOpen(false), []);

  // The unified open channel.
  useEffect(() => {
    function onOpen(e: Event) {
      const mode = (e as CustomEvent<{ mode?: 'menu' | 'record' }>).detail?.mode ?? 'menu';
      if (recording) {
        audioStop(); // star tap (or any opener) while recording = stop + submit
        return;
      }
      if (mode === 'record') {
        if (audioState.phase === 'submitting') return; // don't stack recordings on an in-flight one
        // Failover: where live recording is impossible (plain-HTTP origin,
        // old browser), a long-press opens the sheet instead of dead-ending
        // in an error chip — the text box and the upload control are the
        // capture paths there, and the voice row explains why.
        if (!getAudioSupport().ok) {
          setOpen(true);
          return;
        }
        setOpen(false); // star long-press records with the sheet closed
        void audioStart();
      } else {
        setOpen(true);
      }
    }
    window.addEventListener('text-capture:open', onOpen);
    return () => window.removeEventListener('text-capture:open', onOpen);
  }, [recording, audioState.phase, audioStart, audioStop]);

  // ⌘J / Ctrl-J toggle + Esc. 'j' (not 'k') so it coexists with ⌘K search.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        if (recording) {
          audioStop();
          return;
        }
        setOpen((prev) => !prev);
      } else if (e.key === 'Escape') {
        if (recording) {
          e.preventDefault();
          audioCancel(); // Esc mid-recording discards — Stop & submit is explicit
        } else if (open) {
          e.preventDefault();
          setOpen(false);
        }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, recording, audioStop, audioCancel]);

  const content = (mobile: boolean) => (
    <div className="flex flex-col gap-4">
      <CaptureTypeGrid onNavigate={close} />
      <div className="hairline" />
      <CaptureTextBox text={text} onTextChange={setText} autoFocus={!mobile} />
      <div className="hairline" />
      <VoiceControl
        state={audioState}
        elapsed={audio.elapsed}
        support={support}
        onStart={() => void audioStart()}
        onStop={audioStop}
        onCancel={audioCancel}
        onUploadFile={(file) => audio.submitBlob(file, file.name || 'voice-upload')}
        mobileHint={mobile}
      />
    </div>
  );

  return (
    <>
      {/* Mobile host — BottomSheet is already lg:hidden. */}
      <BottomSheet open={open} onClose={close} title="Capture">
        <div className="px-4 pb-4 pt-1">{content(true)}</div>
      </BottomSheet>

      {/* Desktop host — the old ⌘J palette shell. */}
      {open && (
        <div
          className="hidden lg:flex fixed inset-0 z-50 items-start justify-center pt-[10vh] px-4"
          role="dialog"
          aria-modal="true"
          aria-label="Capture"
        >
          <button
            type="button"
            onClick={close}
            className="absolute inset-0 bg-ink/40 backdrop-blur-sm"
            aria-label="Close"
          />
          <div className="relative w-full max-w-[640px] bg-bg border border-line shadow-2xl">
            <div className="p-4">
              <div className="flex items-baseline justify-between mb-3">
                <div className="eyebrow">Capture</div>
                <div className="font-mono text-[10px] uppercase tracking-wider text-ink-3">
                  ⌘↵ submit · Esc close
                </div>
              </div>
              {content(false)}
            </div>
          </div>
        </div>
      )}

      {/* Star-triggered flow — the portal is closed but the recorder is
          live (or reporting). A fixed bubble above the tab bar carries the
          state so outcomes are never invisible. */}
      {!open && audioState.phase !== 'idle' && (
        <div
          className="fixed left-1/2 -translate-x-1/2 z-50 w-[88%] max-w-[420px]"
          style={{ bottom: 'calc(env(safe-area-inset-bottom) + 84px)' }}
        >
          {recording && (
            <button
              type="button"
              onClick={audioStop}
              className="w-full flex items-center gap-3 bg-ink/95 text-bg px-4 py-3 rounded-lg shadow-lg"
            >
              <span className="relative flex h-2.5 w-2.5 shrink-0">
                <span className="motion-safe:animate-ping absolute inline-flex h-full w-full rounded-full bg-accent opacity-60" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-accent" />
              </span>
              <span className="flex-1 text-left font-sans text-[13px]">
                Listening · tap the star to stop
              </span>
              <span className="font-mono text-[12px] tabular-nums">
                {formatElapsed(audio.elapsed)}
              </span>
            </button>
          )}
          {audioState.phase === 'submitting' && (
            <div className="flex items-center gap-3 bg-ink/95 text-bg px-4 py-3 rounded-lg shadow-lg font-sans text-[13px]">
              <span className="h-3.5 w-3.5 shrink-0 rounded-full border-2 border-bg/50 border-t-transparent motion-safe:animate-spin" />
              Transcribing…
            </div>
          )}
          {(audioState.phase === 'done' || audioState.phase === 'error') && (
            <div className="rounded-lg overflow-hidden shadow-lg [&>div]:border-t-0">
              <ResultChip
                result={
                  audioState.phase === 'done'
                    ? audioState.result
                    : { kind: 'http_error', message: audioState.message }
                }
              />
            </div>
          )}
        </div>
      )}
    </>
  );
}
