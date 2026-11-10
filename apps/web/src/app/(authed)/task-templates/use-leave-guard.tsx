'use client';

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';

// Leave guard for an editor that is a routed page. EditorShell guards a modal
// editor that sits over a page and closes back to the same URL; here leaving
// means changing route, so the same three exits are covered at page level:
//
//   unload        beforeunload asks the browser to confirm.
//   in-app links  a capture-phase click listener stops the navigation and
//                 asks first. Every nav surface in the shell is an <a>.
//   Back          once the draft is dirty a same-URL history entry is pushed
//                 (EditorShell's technique), so Back lands on this page again
//                 and can be answered before the route changes.
//
// Programmatic navigation started elsewhere (router.push from another
// component) is not intercepted; callers that navigate on purpose call
// allow() first.

const actionClass = 'min-h-11 px-3 rounded font-mono text-[11px] uppercase tracking-wide focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent';

export function useLeaveGuard(dirty: boolean, fallbackHref: string): { allow: () => void; dialog: ReactNode } {
  const router = useRouter();
  const token = `leave-${useId()}`;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const allowed = useRef(false);
  const sentinel = useRef(false);
  const [leave, setLeave] = useState<{ go: () => void } | null>(null);
  const allow = useCallback(() => { allowed.current = true; }, []);

  useEffect(() => {
    if (!dirty || sentinel.current || allowed.current) return;
    sentinel.current = true;
    // Keep Next's own history metadata on the entry; only add the marker.
    window.history.pushState({ ...window.history.state, jeviLeaveGuard: token }, '', location.href);
  }, [dirty, token]);

  useEffect(() => {
    const guarding = () => dirtyRef.current && !allowed.current;
    const unload = (event: BeforeUnloadEvent) => {
      if (!guarding()) return;
      event.preventDefault();
      event.returnValue = '';
    };
    const click = (event: MouseEvent) => {
      if (!guarding() || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = (event.target as Element | null)?.closest?.<HTMLAnchorElement>('a[href]');
      if (!link || link.target || link.hasAttribute('download')) return;
      const url = new URL(link.href, location.href);
      // Another origin unloads the document, which beforeunload already covers.
      if (url.origin !== location.origin) return;
      if (url.pathname + url.search === location.pathname + location.search) return;
      event.preventDefault();
      event.stopPropagation();
      const href = url.pathname + url.search + url.hash;
      // Replace, so the marker entry does not linger behind the destination.
      setLeave({ go: () => router.replace(href) });
    };
    const pop = () => {
      if (!sentinel.current || allowed.current || window.history.state?.jeviLeaveGuard === token) return;
      if (dirtyRef.current) {
        window.history.pushState({ ...window.history.state, jeviLeaveGuard: token }, '', location.href);
        setLeave({ go: () => {
          const from = location.pathname;
          window.history.go(-2);
          // Opened directly, with nothing behind this page: go somewhere sensible.
          window.setTimeout(() => { if (location.pathname === from) router.replace(fallbackHref); }, 400);
        } });
      } else {
        // Clean again (saved version reloaded): one Back press still leaves.
        sentinel.current = false;
        window.history.back();
      }
    };
    window.addEventListener('beforeunload', unload);
    window.addEventListener('popstate', pop);
    document.addEventListener('click', click, true);
    return () => {
      window.removeEventListener('beforeunload', unload);
      window.removeEventListener('popstate', pop);
      document.removeEventListener('click', click, true);
    };
  }, [router, token, fallbackHref]);

  const dialog = leave
    ? <DiscardDialog onKeep={() => setLeave(null)} onDiscard={() => { allowed.current = true; const { go } = leave; setLeave(null); go(); }} />
    : null;
  return { allow, dialog };
}

function DiscardDialog({ onKeep, onDiscard }: { onKeep: () => void; onDiscard: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  useLayoutEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);
  return <dialog ref={dialog} role="alertdialog" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`}
    onCancel={event => { event.preventDefault(); onKeep(); }}
    className="m-auto w-[calc(100%-2rem)] max-w-sm border border-line-strong bg-surface p-5 text-ink shadow-xl backdrop:bg-ink/30">
    <h3 id={`${id}-title`} className="font-serif text-xl">Discard unsaved changes?</h3>
    <p id={`${id}-description`} className="my-4 text-sm">Your unsaved changes will be lost.</p>
    <div className="flex flex-wrap gap-3">
      <button autoFocus type="button" className={`${actionClass} border border-line-strong`} onClick={onKeep}>Keep editing</button>
      <button type="button" className={`${actionClass} bg-accent text-bg`} onClick={onDiscard}>Discard changes</button>
    </div>
  </dialog>;
}
