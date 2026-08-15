'use client';

import { useEffect, useState } from 'react';

// Mobile bottom sheet. A full-bleed slide-up panel anchored to the bottom of
// the viewport (edge to edge, matching the now-uncapped app shell + tab bar),
// with a dimmed backdrop. Used for the More nav menu and the per-screen
// Filters — the two
// mobile affordances that don't fit the 5-slot tab bar or the desktop-only
// facet rail. Desktop never sees it (`lg:hidden`); the rail + tab bar cover
// those cases there.
//
// Enter/exit are animated by toggling `shown` a frame after mount and
// unmounting on the panel's transitionend, so both directions are smooth
// without an animation library. Esc and a backdrop tap close it.
export function BottomSheet({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const [render, setRender] = useState(open);
  const [shown, setShown] = useState(false);

  // Mount → next frame → slide in. Close → slide out → unmount (onTransitionEnd).
  useEffect(() => {
    if (open) {
      setRender(true);
      const id = requestAnimationFrame(() => setShown(true));
      return () => cancelAnimationFrame(id);
    }
    setShown(false);
    return undefined;
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!render) return null;

  return (
    <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label={title}>
      <div
        className={`absolute inset-0 bg-ink/40 transition-opacity duration-200 ${shown ? 'opacity-100' : 'opacity-0'}`}
        onClick={onClose}
        aria-hidden
      />
      <div
        className={`absolute inset-x-0 bottom-0 w-full flex flex-col bg-bg border-t border-line-strong rounded-t-[18px] shadow-[0_-18px_50px_-20px_rgba(18,16,14,0.4)] transition-transform duration-200 ease-out ${
          shown ? 'translate-y-0' : 'translate-y-full'
        }`}
        style={{ maxHeight: '85dvh' }}
        onTransitionEnd={() => {
          if (!shown) setRender(false);
        }}
      >
        {/* Grabber */}
        <div className="pt-2.5 pb-1 flex justify-center shrink-0">
          <span className="h-1 w-9 rounded-full bg-line-strong" aria-hidden />
        </div>
        <div className="flex items-center justify-between px-5 pb-2.5 shrink-0">
          <span className="eyebrow">{title}</span>
          <button
            type="button"
            onClick={onClose}
            className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3 hover:text-ink transition-colors"
          >
            Done
          </button>
        </div>
        <div className="overflow-y-auto overscroll-contain flex-1">{children}</div>
        {footer && (
          <div
            className="shrink-0 border-t border-line px-5 py-3"
            style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 12px)' }}
          >
            {footer}
          </div>
        )}
        {!footer && <div style={{ height: 'calc(env(safe-area-inset-bottom) + 8px)' }} className="shrink-0" />}
      </div>
    </div>
  );
}
