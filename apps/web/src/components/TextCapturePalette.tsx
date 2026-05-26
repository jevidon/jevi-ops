'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { submitVoiceTranscript, type VoiceResult } from '@/lib/voice-actions';

// Cmd+J / Ctrl+J opens a centered modal with a multi-line text input.
// Pipes the text through submitVoiceTranscript — same Claude parser the
// voice path uses — so any command you can say into the mic, you can
// type here. On desktop this is the fastest capture surface; the MicFAB
// remains for hands-busy moments and phones.
//
// Why a modal vs. a dedicated /capture page:
//   - Cmd+J should be usable from anywhere without losing your spot.
//   - Result chip stays visible without a page nav.
//   - Esc to dismiss is the universal expectation.

type Phase =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'done'; result: VoiceResult };

export function TextCapturePalette() {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [text, setText] = useState('');
  const [, startTransition] = useTransition();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ⌘J / Ctrl-J to toggle. We use 'j' (not Cmd+K which already opens
  // /search) so the two shortcuts coexist naturally.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        setOpen((prev) => !prev);
      } else if (e.key === 'Escape' && open) {
        e.preventDefault();
        setOpen(false);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // External components (e.g. the mobile text-capture FAB) dispatch
  // `text-capture:open` to summon the palette. Keeps this component
  // self-contained — no shared state needed.
  useEffect(() => {
    function onOpen() {
      setOpen(true);
    }
    window.addEventListener('text-capture:open', onOpen);
    return () => window.removeEventListener('text-capture:open', onOpen);
  }, []);

  // Reset transient state whenever the palette is closed so reopening
  // gives a clean slate.
  useEffect(() => {
    if (!open) {
      setPhase({ kind: 'idle' });
      // Don't wipe `text` immediately on close — if the user re-opens
      // with Cmd+J right away (common when they accidentally dismissed
      // mid-thought) the draft is still there. Only clear after a
      // successful submit.
    }
  }, [open]);

  // Autofocus the textarea when opening; place cursor at the end so a
  // prefilled draft is editable without re-clicking.
  useEffect(() => {
    if (open) {
      // setTimeout 0 lets the DOM mount before focus.
      setTimeout(() => {
        const el = textareaRef.current;
        if (el) {
          el.focus();
          el.setSelectionRange(el.value.length, el.value.length);
        }
      }, 0);
    }
  }, [open]);

  const handleSubmit = useCallback(
    (e?: React.FormEvent) => {
      e?.preventDefault();
      const transcript = text.trim();
      if (!transcript || phase.kind === 'submitting') return;
      setPhase({ kind: 'submitting' });
      startTransition(async () => {
        // Tagged 'text' so the executor stamps tasks/activity rows
        // with source='manual' and journal entries with source='typed'
        // — matching how the user actually entered them, not via mic.
        const result = await submitVoiceTranscript(transcript, 'text');
        setPhase({ kind: 'done', result });
        // Successful actions clear the input so chained captures are easy.
        // Disambiguation / parse errors keep the text so the user can edit.
        if (result.kind === 'executed') setText('');
      });
    },
    [text, phase.kind],
  );

  // Cmd+Enter from inside the textarea submits — matches Slack/Linear/etc.
  const onTextareaKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh] px-4"
      role="dialog"
      aria-modal="true"
      aria-label="Quick capture"
    >
      {/* Backdrop */}
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="absolute inset-0 bg-ink/40 backdrop-blur-sm"
        aria-label="Close"
      />

      <div className="relative w-full max-w-[640px] bg-bg border border-line shadow-2xl">
        <form onSubmit={handleSubmit} className="p-4">
          <div className="flex items-baseline justify-between mb-2">
            <div className="eyebrow">Quick capture</div>
            <div className="font-mono text-[10px] uppercase tracking-wider text-ink-3">
              ⌘↵ submit · Esc close
            </div>
          </div>
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onTextareaKeyDown}
            disabled={phase.kind === 'submitting'}
            placeholder="Add a task to Tech With Jerad: ship the new intro &mdash; due tomorrow.&#10;Save a quote from Atomic Habits by James Clear: &ldquo;You do not rise to the level of your goals…&rdquo;"
            rows={4}
            className="w-full bg-transparent border border-line focus:border-accent focus:outline-none p-3 font-sans text-[15px] text-ink placeholder:text-ink-3 leading-snug resize-none"
            spellCheck
          />

          <div className="mt-3 flex items-center justify-between gap-3">
            <div className="font-mono text-[10px] uppercase tracking-wider text-ink-3">
              {text.trim().length > 0
                ? `${text.trim().length} chars`
                : 'Say what you would say to the mic.'}
            </div>
            <button
              type="submit"
              disabled={!text.trim() || phase.kind === 'submitting'}
              className="px-3 py-1.5 bg-ink text-bg font-mono text-[10px] uppercase tracking-wider disabled:opacity-40 disabled:cursor-not-allowed hover:bg-ink-2 transition-colors"
            >
              {phase.kind === 'submitting' ? 'Parsing…' : 'Capture'}
            </button>
          </div>
        </form>

        {phase.kind === 'done' && <ResultChip result={phase.result} />}
      </div>
    </div>
  );
}

function ResultChip({ result }: { result: VoiceResult }) {
  const isOk = result.kind === 'executed';
  const isWarn = result.kind === 'disambiguation';
  return (
    <div
      className={`border-t px-4 py-3 ${
        isOk
          ? 'bg-ink text-bg border-ink'
          : isWarn
          ? 'bg-surface-2 text-ink border-line'
          : 'bg-accent text-bg border-accent'
      }`}
    >
      <div className="eyebrow opacity-70 mb-1">
        {isOk ? 'Done' : isWarn ? 'Needs clarification' : 'Capture'}
      </div>
      <div className="font-sans text-[13px] leading-snug">
        {result.kind === 'executed' && result.summary}
        {result.kind === 'disambiguation' &&
          `Ambiguous: ${result.field}. Try again with a more specific name.`}
        {result.kind === 'parse_error' && `Couldn't parse: ${result.message}`}
        {result.kind === 'http_error' && `Error: ${result.message}`}
      </div>
    </div>
  );
}
