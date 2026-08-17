'use client';

import { useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { useToast } from './ToastProvider';

// Redirect handoff for return-to-origin task creation: the server action
// can't reach the client's toast context, so it appends ?created=<taskId> to
// the origin URL it redirects to. This (mounted once in the authed layout,
// under <Suspense> — useSearchParams would otherwise deopt the tree) fires
// the toast and immediately strips the param via native replaceState, which
// Next 15 syncs into useSearchParams without a server round-trip. Refresh or
// back-nav therefore never re-fires.
export function CreatedTaskToast() {
  const toast = useToast();
  const params = useSearchParams();
  const created = params.get('created');
  // Guards Strict Mode double-effects and same-id re-renders before the
  // param strip lands.
  const consumed = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!created || consumed.current.has(created)) return;
    consumed.current.add(created);
    toast({
      message: 'Task created.',
      action: { label: 'View task', href: `/tasks/${created}` },
    });
    const url = new URL(window.location.href);
    url.searchParams.delete('created');
    window.history.replaceState(null, '', url.toString());
  }, [created, toast]);

  return null;
}
