'use client';

// Mobile-only floating button that opens the TextCapturePalette modal.
// On desktop Cmd+J does the same thing — and the visible mic FAB
// already pulls the eye toward the bottom-right, so a second button
// there is just clutter. On mobile there's no keyboard shortcut, hence
// this affordance.
//
// Stacks directly above the MicFAB. Dispatches a `text-capture:open`
// custom event the palette listens for (avoids lifting state into the
// server-component layout).

export function TextCaptureFAB() {
  return (
    <button
      type="button"
      aria-label="Text capture"
      onClick={() => window.dispatchEvent(new CustomEvent('text-capture:open'))}
      // lg:hidden — desktop users have Cmd+J + the in-rail capture
      // button is sufficient.
      className="fixed right-5 z-40 flex h-12 w-12 items-center justify-center rounded-full shadow-lg bg-ink-2 hover:bg-ink transition-colors lg:hidden"
      // 72px (mic FAB height + bottom offset) + 56px (this button's
      // height) + 12px gap = stack neatly above the mic.
      style={{ bottom: 'calc(env(safe-area-inset-bottom) + 140px)' }}
    >
      <PencilIcon className="h-5 w-5 text-bg" />
    </button>
  );
}

function PencilIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
    </svg>
  );
}
