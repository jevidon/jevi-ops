'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { submitVoiceTranscript, type VoiceResult } from '@/lib/voice-actions';
import { ResultChip } from './ResultChip';

// Free-text capture — the old ⌘J palette's textarea, extracted. Pipes text
// through submitVoiceTranscript (the same Claude parser the voice path
// uses), so anything you can say to the mic you can type here. The draft
// (`text`) is owned by CapturePortal so both hosts (sheet + modal) stay in
// sync; submit phase is local — only the visible instance submits.

type Phase =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'done'; result: VoiceResult };

export function CaptureTextBox({
  text,
  onTextChange,
  autoFocus = false,
}: {
  text: string;
  onTextChange: (next: string) => void;
  autoFocus?: boolean;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [, startTransition] = useTransition();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Autofocus with cursor at the end so a preserved draft is editable
  // without re-clicking. Desktop host only — on mobile this would pop the
  // keyboard over the type grid.
  useEffect(() => {
    if (!autoFocus) return;
    setTimeout(() => {
      const el = textareaRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      }
    }, 0);
  }, [autoFocus]);

  const handleSubmit = useCallback(
    (e?: React.FormEvent) => {
      e?.preventDefault();
      const transcript = text.trim();
      if (!transcript || phase.kind === 'submitting') return;
      setPhase({ kind: 'submitting' });
      startTransition(async () => {
        // Tagged 'text' so the executor stamps tasks/activity rows with
        // source='manual' and journal entries with source='typed'.
        const result = await submitVoiceTranscript(transcript, 'text');
        setPhase({ kind: 'done', result });
        // Successful actions clear the draft so chained captures are easy;
        // disambiguation / parse errors keep it for editing.
        if (result.kind === 'executed') onTextChange('');
      });
    },
    [text, phase.kind, onTextChange],
  );

  const onTextareaKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  return (
    <div>
      <form onSubmit={handleSubmit}>
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => onTextChange(e.target.value)}
          onKeyDown={onTextareaKeyDown}
          disabled={phase.kind === 'submitting'}
          placeholder="Say what you would say to the mic &mdash; &ldquo;add a task to Homestead: fix the gate, due Saturday.&rdquo;"
          rows={3}
          className="w-full bg-transparent border border-line focus:border-accent focus:outline-none p-3 font-sans text-[15px] text-ink placeholder:text-ink-3 leading-snug resize-none"
          spellCheck
        />
        <div className="mt-2 flex items-center justify-between gap-3">
          <div className="font-mono text-[10px] uppercase tracking-wider text-ink-3">
            {text.trim().length > 0 ? `${text.trim().length} chars` : '⌘↵ submits'}
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
      {phase.kind === 'done' && (
        <div className="mt-3 -mx-4 lg:-mx-4">
          <ResultChip result={phase.result} />
        </div>
      )}
    </div>
  );
}
