'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { retryInterpretationAction } from '@/lib/capture-actions';

// Explicit retry = new intent: a fresh operation id against the same
// capture, refused by the server unless the last attempt is known to have
// stopped before any effect. The expected attempt number stops two tabs
// from both retrying.

export function RetryInterpretationButton({ captureId, expectedAttemptNo }: { captureId: string; expectedAttemptNo: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        disabled={pending}
        onClick={() => start(async () => {
          const res = await retryInterpretationAction(captureId, expectedAttemptNo);
          setMessage(res.message);
          router.refresh();
        })}
        className="border border-line hover:border-ink-2 hover:text-ink text-ink-2 font-mono text-[10px] uppercase tracking-wider px-3 py-1 transition-colors disabled:opacity-50"
      >
        {pending ? 'Interpreting…' : 'Retry interpretation'}
      </button>
      {message && <span className="font-sans text-[12px] text-ink-2">{message}</span>}
    </div>
  );
}
