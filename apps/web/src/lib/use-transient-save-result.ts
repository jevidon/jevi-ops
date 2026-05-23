'use client';

import { useEffect, useState } from 'react';

// Shape every server action in this codebase returns.
export type AnySaveResult =
  | { ok: true }
  | { ok: false; error: string };

// Wraps a useActionState result so the "Saved" message disappears after
// a short delay — that way back-to-back saves on the same form each
// produce visible feedback (otherwise the stale "Saved" sticks until
// the page reloads and the second save looks like a no-op).
//
// Errors are NOT auto-cleared — the user needs time to read them, and
// they shouldn't silently vanish.
//
// Usage:
//   const [actionState, formAction, pending] = useActionState(fn, null);
//   const display = useTransientSaveResult(actionState);
//   ...
//   {display?.ok && <span>Saved.</span>}
//   {display?.ok === false && <span>{display.error}</span>}
//
// Pass the original `actionState` to the form/button (e.g., pending),
// pass `display` to anything that renders feedback.
export function useTransientSaveResult<T extends AnySaveResult>(
  result: T | null,
  timeoutMs: number = 2500,
): T | null {
  const [display, setDisplay] = useState<T | null>(null);

  useEffect(() => {
    if (!result) return;
    setDisplay(result);
    if (result.ok) {
      const t = setTimeout(() => setDisplay(null), timeoutMs);
      return () => clearTimeout(t);
    }
    // Errors stay until the next submit replaces them.
  }, [result, timeoutMs]);

  return display;
}
