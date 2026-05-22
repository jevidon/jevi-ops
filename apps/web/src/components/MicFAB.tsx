'use client';

import { useState } from 'react';

// Persistent floating mic — visible on every screen per spec §4 and §7.
// Web Speech API wiring lands when capture is fully implemented; for now
// this is the visual + a stub click handler.

export function MicFAB() {
  const [recording, setRecording] = useState(false);

  return (
    <button
      aria-label={recording ? 'Stop recording' : 'Voice capture'}
      onClick={() => setRecording((v) => !v)}
      className={`fixed right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full shadow-lg transition-all ${
        recording ? 'bg-accent scale-110' : 'bg-ink hover:bg-ink-2'
      }`}
      style={{ bottom: 'calc(env(safe-area-inset-bottom) + 72px)' }}
    >
      <MicIcon className="h-6 w-6 text-bg" />
      {recording && (
        <span className="absolute inset-0 -z-10 rounded-full bg-accent/40 animate-ping" />
      )}
    </button>
  );
}

function MicIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <rect x="9" y="3" width="6" height="12" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v3" />
    </svg>
  );
}
