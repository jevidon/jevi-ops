'use client';

import { useEffect, useState } from 'react';

// Edit drawer (Detail Pages v2, Addendum 10 §5). Configuration lives here,
// behind the header's Edit button — off the read surface. A right slide-over
// holding the item's existing edit form (relocated, not rebuilt) + danger zone.
// The trigger renders as the solid "Edit" action button so it sits inline with
// the capture buttons in the header band.

export function EditDrawer({
  title,
  triggerLabel = 'Edit',
  triggerVariant = 'solid',
  children,
}: {
  title: string;
  triggerLabel?: string;
  // 'solid' = the header action button (operational pages); 'quiet' = a mono
  // text affordance for the calm library reading pages.
  triggerVariant?: 'solid' | 'quiet';
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const triggerClass = triggerVariant === 'quiet'
    ? 'font-mono text-[10px] uppercase tracking-[0.07em] text-ink-3 hover:text-ink transition-colors'
    : 'inline-flex items-center gap-1.5 h-[34px] px-3 rounded border border-ink bg-ink text-bg font-mono text-[10px] font-semibold uppercase tracking-[0.07em] hover:bg-ink-2 transition-colors shrink-0';

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={triggerClass}>
        {triggerLabel}
      </button>

      {open && (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={title}>
          <div
            className="absolute inset-0 bg-ink/30"
            onClick={() => setOpen(false)}
          />
          <div className="absolute top-0 right-0 bottom-0 w-[440px] max-w-[92vw] bg-surface border-l border-line-strong shadow-[-24px_0_60px_-30px_rgba(18,16,14,0.5)] overflow-y-auto">
            <div className="sticky top-0 z-10 bg-surface border-b border-line-strong px-5 py-3.5 flex items-center justify-between">
              <span className="eyebrow">{title}</span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="font-mono text-[13px] text-ink-3 hover:text-ink transition-colors leading-none px-1"
              >
                ✕
              </button>
            </div>
            <div className="px-5 py-5">{children}</div>
          </div>
        </div>
      )}
    </>
  );
}
