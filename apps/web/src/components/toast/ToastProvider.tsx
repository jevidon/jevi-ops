'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';

// Transient feedback layer — the app's first toast surface. Complements (not
// replaces) the inline useTransientSaveResult "Saved." convention: toasts are
// for creations whose result lives somewhere else (a task you can jump to),
// inline text stays right for edits to the form you're looking at.
//
// Contract mirrors the SaveResult convention: successes auto-dismiss (3s);
// errors persist until dismissed.

export interface ToastInput {
  message: string;
  action?: { label: string; href: string };
  tone?: 'success' | 'error';
}

interface ToastEntry extends ToastInput {
  id: number;
}

const ToastContext = createContext<{ toast: (t: ToastInput) => void } | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx.toast;
}

const SUCCESS_DISMISS_MS = 3000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const nextId = useRef(0);
  // Portal target only exists client-side; render nothing until mounted.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const dismiss = useCallback((id: number) => {
    setToasts((cur) => cur.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback((input: ToastInput) => {
    const id = nextId.current++;
    setToasts((cur) => [...cur, { id, tone: 'success', ...input }]);
  }, []);

  const api = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      {mounted &&
        createPortal(
          // Upper right (user preference). z-50: above the sticky Topbar
          // (z-30) and BottomTabBar (z-40). Mobile clears the iOS status
          // bar via safe-area; desktop sits just below the 60px Topbar.
          <div
            className="fixed right-5 z-50 flex flex-col items-end gap-2 pointer-events-none top-[calc(env(safe-area-inset-top)+12px)] lg:right-6 lg:top-[72px]"
            aria-live="polite"
          >
            {toasts.map((t) => (
              <Toast key={t.id} entry={t} onDismiss={() => dismiss(t.id)} />
            ))}
          </div>,
          document.body,
        )}
    </ToastContext.Provider>
  );
}

function Toast({ entry, onDismiss }: { entry: ToastEntry; onDismiss: () => void }) {
  const isError = entry.tone === 'error';

  useEffect(() => {
    if (isError) return; // errors persist until dismissed
    const timer = setTimeout(onDismiss, SUCCESS_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [isError, onDismiss]);

  return (
    <div
      role="status"
      className="pointer-events-auto flex items-center gap-3 bg-surface border border-line-strong shadow-sm px-4 py-3 max-w-full motion-safe:animate-toast-in"
    >
      <span
        className={`shrink-0 font-mono text-[10px] uppercase tracking-wider ${isError ? 'text-accent' : 'text-ink-2'}`}
      >
        {isError ? '✕ Error' : '✓'}
      </span>
      <span className="font-sans text-[13px] text-ink truncate">{entry.message}</span>
      {entry.action && (
        <Link
          href={entry.action.href}
          onClick={onDismiss}
          className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-accent hover:text-accent-ink transition-colors"
        >
          {entry.action.label} →
        </Link>
      )}
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="shrink-0 font-mono text-[10px] text-ink-3 hover:text-ink transition-colors"
      >
        ✕
      </button>
    </div>
  );
}
