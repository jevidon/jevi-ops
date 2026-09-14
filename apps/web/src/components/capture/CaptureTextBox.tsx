'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { interpretSavedCapture, saveTextCapture } from '@/lib/capture-actions';
import type { CaptureOutcome } from '@/lib/capture-result';
import { createClientId } from '@/lib/client-id';
import { ResultChip } from './ResultChip';

// Free-text capture — the old ⌘J palette's textarea, extracted. Two steps
// on submit: (1) durable save, rendered as "Saved to Jevi Ops" the moment
// the receipt arrives; (2) interpretation, a separate call that updates the
// same chip when the local model answers. A cold or hung model never delays
// the receipt. The draft (`text`) is owned by CapturePortal so both hosts
// (sheet + modal) stay in sync; submit phase is local.

type Phase =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'interpreting'; result: CaptureOutcome }
  | { kind: 'done'; result: CaptureOutcome };

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
  // Ids live until the save is confirmed, so retrying a failed save replays
  // the same operation instead of creating a second capture.
  const idsRef = useRef<{ operationId: string; captureId: string; capturedAt: string } | null>(null);

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
      if (!transcript || phase.kind === 'saving') return;
      setPhase({ kind: 'saving' });
      startTransition(async () => {
        const ids = idsRef.current ?? { operationId: createClientId(), captureId: createClientId(), capturedAt: new Date().toISOString() };
        idsRef.current = ids;
        const saved = await saveTextCapture(transcript, ids);
        if (saved.kind !== 'server_saved') {
          setPhase({ kind: 'done', result: saved }); // ids kept: the next submit replays
          return;
        }
        idsRef.current = null;
        onTextChange('');
        setPhase({ kind: 'interpreting', result: saved });
        const outcome = await interpretSavedCapture(saved.captureId);
        setPhase({ kind: 'done', result: outcome });
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

  const chip = phase.kind === 'interpreting' || phase.kind === 'done' ? phase.result : null;

  return (
    <div>
      <form onSubmit={handleSubmit}>
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => onTextChange(e.target.value)}
          onKeyDown={onTextareaKeyDown}
          disabled={phase.kind === 'saving'}
          placeholder="Say what you would say to the mic &mdash; &ldquo;add a task to Homestead: fix the gate, due Saturday.&rdquo;"
          rows={3}
          className="w-full bg-transparent border border-line focus:border-accent focus:outline-none p-3 font-sans text-[15px] text-ink placeholder:text-ink-3 leading-snug resize-none"
          spellCheck
        />
        <div className="mt-2 flex items-center justify-between gap-3">
          <div className="font-mono text-[10px] uppercase tracking-wider text-ink-3">
            {phase.kind === 'interpreting'
              ? 'Saved · interpreting…'
              : text.trim().length > 0 ? `${text.trim().length} chars` : '⌘↵ submits'}
          </div>
          <button
            type="submit"
            disabled={!text.trim() || phase.kind === 'saving'}
            className="px-3 py-1.5 bg-ink text-bg font-mono text-[10px] uppercase tracking-wider disabled:opacity-40 disabled:cursor-not-allowed hover:bg-ink-2 transition-colors"
          >
            {phase.kind === 'saving' ? 'Saving…' : 'Capture'}
          </button>
        </div>
      </form>
      {chip && (
        <div className="mt-3 -mx-4 lg:-mx-4">
          <ResultChip result={chip} />
        </div>
      )}
    </div>
  );
}
