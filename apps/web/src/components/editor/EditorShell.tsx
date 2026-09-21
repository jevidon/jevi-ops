'use client';

import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/toast/ToastProvider';
import { useEditorNavigation } from './EditorProvider';

export type EditorResult = { ok: true; redirectTo?: string } | { ok: false; error: string };
export interface EditorRegistration {
  formId: string;
  dirty: () => boolean;
  pending: boolean;
  deleteAction?: () => Promise<EditorResult>;
  deleteDescription?: string;
}
interface EditorContextValue {
  register: (registration: EditorRegistration | null) => void;
  saved: (result: Extract<EditorResult, { ok: true }>) => void;
}
const Context = createContext<EditorContextValue | null>(null);
export function useEditor() { return useContext(Context); }

const actionClass = 'min-h-11 px-3 rounded font-mono text-[11px] uppercase tracking-wide focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50 disabled:cursor-wait';

function trapFocus(event: KeyboardEvent<HTMLDialogElement>) {
  if (event.key !== 'Tab' || (event.target as Element).closest('dialog') !== event.currentTarget) return;
  const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href], [tabindex]')]
    .filter(element => element.tabIndex >= 0 && !element.matches(':disabled') && element.getClientRects().length > 0);
  const first = controls[0];
  const last = controls.at(-1);
  if (!first || !last) { event.preventDefault(); return; }
  if (event.shiftKey && (document.activeElement === first || !controls.includes(document.activeElement as HTMLElement))) {
    event.preventDefault(); last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault(); first.focus();
  }
}

export function EditorShell({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const registration = useRef<EditorRegistration | null>(null);
  const [actions, setActions] = useState<EditorRegistration | null>(null);
  const [confirm, setConfirm] = useState<'discard' | 'delete' | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pendingRef = useRef(false);
  const closing = useRef(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const navigation = useEditorNavigation();
  const opened = navigation?.opened;
  const router = useRouter();
  const toast = useToast();
  const id = useId();
  const historyToken = useRef(`editor-${id}`);
  const requestCloseRef = useRef<() => void>(() => {});
  const deferred = useRef<(() => void) | null>(null);

  const register = useCallback((next: EditorRegistration | null) => {
    registration.current = next;
    setActions(next);
  }, []);

  // A same-URL history entry makes Back close this local editor first. Keep
  // Next's history metadata intact; never infer ownership from history.length.
  const close = useCallback((after?: () => void) => {
    if (closing.current) return;
    closing.current = true;
    deferred.current = after ?? null;
    if (window.history.state?.jeviEditor === historyToken.current) {
      window.history.back();
    } else {
      closeRef.current();
      after?.();
    }
  }, []);

  const saved = useCallback((result: Extract<EditorResult, { ok: true }>) => {
    toast({ message: 'Saved.' });
    close(() => {
      if (result.redirectTo) navigation?.returnTo(result.redirectTo);
      else router.refresh();
    });
  }, [close, navigation, router, toast]);

  const requestClose = () => {
    if (pendingRef.current || registration.current?.pending) return;
    if (registration.current?.dirty()) setConfirm('discard');
    else close();
  };
  requestCloseRef.current = requestClose;

  useLayoutEffect(() => {
    const element = dialog.current!;
    const trigger = document.activeElement as HTMLElement | null;
    const y = window.scrollY;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    element.showModal();
    const titleElement = element.querySelector<HTMLElement>('h2');
    titleElement?.focus();
    if (window.history.state?.jeviEditor !== historyToken.current) window.history.pushState({ ...window.history.state, jeviEditor: historyToken.current }, '', location.href);
    const pop = () => {
      if (window.history.state?.jeviEditor === historyToken.current) return;
      if (closing.current) {
        const after = deferred.current;
        deferred.current = null;
        closeRef.current();
        after?.();
        return;
      }
      if (pendingRef.current || registration.current?.pending || registration.current?.dirty()) {
        window.history.pushState({ ...window.history.state, jeviEditor: historyToken.current }, '', location.href);
        requestCloseRef.current();
      } else {
        closing.current = true;
        closeRef.current();
      }
    };
    const unload = (event: BeforeUnloadEvent) => {
      if (registration.current?.dirty() || pendingRef.current || registration.current?.pending) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('popstate', pop);
    window.addEventListener('beforeunload', unload);
    return () => {
      element.close();
      document.body.style.overflow = previousOverflow;
      window.scrollTo(0, y);
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
      window.removeEventListener('popstate', pop);
      window.removeEventListener('beforeunload', unload);
    };
  }, []);
  useEffect(() => opened?.(), [opened]);

  const remove = async () => {
    if (pendingRef.current || registration.current?.pending || !registration.current?.deleteAction) return;
    pendingRef.current = true;
    setDeleting(true);
    setError(null);
    try {
      const result = await registration.current.deleteAction();
      if (!result.ok) { setError(result.error); return; }
      toast({ message: 'Deleted.' });
      close(() => {
        if (result.redirectTo) navigation?.returnTo(result.redirectTo);
        else router.refresh();
      });
    } catch {
      setError('Could not delete this item. Your changes are still here. Please try again.');
    } finally {
      pendingRef.current = false;
      setDeleting(false);
    }
  };
  const pending = actions?.pending || deleting;
  return createPortal(
    <Context.Provider value={{ register, saved }}>
      <dialog ref={dialog} aria-labelledby={`${id}-title`} onKeyDown={trapFocus} onCancel={event => { event.preventDefault(); if (event.target === event.currentTarget) requestClose(); }}
        onClick={event => { if (event.target === event.currentTarget) requestClose(); }}
        className="fixed inset-0 m-0 h-dvh max-h-none w-screen max-w-none bg-transparent p-0 text-ink backdrop:bg-ink/30">
        <div className="absolute inset-y-0 right-0 flex w-full flex-col bg-surface shadow-xl lg:w-[440px] lg:border-l lg:border-line-strong"
          style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
          <header className="shrink-0 border-b border-line-strong px-4 py-2">
            <h2 id={`${id}-title`} tabIndex={-1} className="eyebrow py-2 focus:outline-none">{title}</h2>
            <div className="flex items-center gap-2">
              <button type="button" disabled={pending} className={actionClass} onClick={requestClose}>Cancel</button>
              <div className="ml-auto flex gap-3">
                {actions?.deleteAction && <button type="button" disabled={pending} className={`${actionClass} text-accent`} onClick={() => { setError(null); setConfirm('delete'); }}>Delete</button>}
                {actions && <button type="submit" form={actions.formId} disabled={pending} className={`${actionClass} bg-ink text-bg`}>{pending ? (deleting ? 'Deleting…' : 'Saving…') : 'Save'}</button>}
              </div>
            </div>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5">{children}</div>
        </div>
        {confirm && <Confirmation title={confirm === 'delete' ? 'Delete this item?' : 'Discard unsaved changes?'}
          description={confirm === 'delete' ? (actions?.deleteDescription ?? 'This cannot be undone.') : 'Your unsaved changes will be lost.'}
          pending={deleting} error={error} confirmLabel={confirm === 'delete' ? 'Confirm delete' : 'Discard changes'}
          onCancel={() => { if (!deleting) { setConfirm(null); setError(null); } }}
          onConfirm={() => { if (confirm === 'delete') void remove(); else close(); }} />}
      </dialog>
    </Context.Provider>, document.body,
  );
}

function Confirmation({ title, description, pending, error, confirmLabel, onCancel, onConfirm }: {
  title: string; description: string; pending: boolean; error: string | null; confirmLabel: string; onCancel: () => void; onConfirm: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  useLayoutEffect(() => { const el = dialog.current!; el.showModal(); return () => el.close(); }, []);
  return <dialog ref={dialog} role="alertdialog" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`} onKeyDown={trapFocus}
    onCancel={e => { e.preventDefault(); e.stopPropagation(); onCancel(); }} className="m-auto w-[calc(100%-2rem)] max-w-sm border border-line-strong bg-surface p-5 text-ink shadow-xl backdrop:bg-ink/30">
    <h3 id={`${id}-title`} className="font-serif text-xl">{title}</h3>
    <p id={`${id}-description`} className="my-4 text-sm">{description}</p>
    {error && <p role="alert" className="mb-4 text-sm text-accent">{error}</p>}
    <div className="flex flex-wrap gap-3">
      <button autoFocus type="button" disabled={pending} className={`${actionClass} border border-line-strong`} onClick={onCancel}>{confirmLabel === 'Discard changes' ? 'Keep editing' : 'Cancel deletion'}</button>
      <button type="button" disabled={pending} className={`${actionClass} bg-accent text-bg`} onClick={onConfirm}>{pending ? 'Deleting…' : confirmLabel}</button>
    </div>
  </dialog>;
}
