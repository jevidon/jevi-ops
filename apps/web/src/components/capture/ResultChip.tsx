'use client';

import type { VoiceResult } from '@/lib/voice-actions';

// Capture outcome chip — shared by the text and voice layers of the portal.
// Absorbed from the old TextCapturePalette; the color grammar is the app's:
// ink = done, surface = needs input, accent = failed.

export function ResultChip({ result }: { result: VoiceResult }) {
  const isOk = result.kind === 'executed';
  const isWarn = result.kind === 'disambiguation';
  return (
    <div
      className={`border-t px-4 py-3 ${
        isOk
          ? 'bg-ink text-bg border-ink'
          : isWarn
          ? 'bg-surface-2 text-ink border-line'
          : 'bg-accent text-bg border-accent'
      }`}
    >
      <div className="eyebrow opacity-70 mb-1">
        {isOk ? 'Done' : isWarn ? 'Needs clarification' : 'Capture'}
      </div>
      <div className="font-sans text-[13px] leading-snug">
        {result.kind === 'executed' && result.summary}
        {result.kind === 'disambiguation' &&
          `Ambiguous: ${result.field}. Try again with a more specific name.`}
        {result.kind === 'parse_error' && `Couldn't parse: ${result.message}`}
        {result.kind === 'http_error' && `Error: ${result.message}`}
      </div>
    </div>
  );
}
