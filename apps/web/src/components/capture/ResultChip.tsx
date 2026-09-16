'use client';

import type { CaptureOutcome } from '@/lib/capture-result';

// Capture outcome chip — shared by the text and voice layers of the portal.
// Colour grammar is the app's: ink = done/saved, surface = needs input or
// still working, accent = failed. Storage and interpretation are distinct
// outcomes: "Saved to Jevi Ops" is a receipt, "✓ 2 done" is a result.

const LINK_KINDS = new Set(['pending', 'review', 'upload_incomplete', 'status_unknown', 'server_saved']);

export function ResultChip({ result, onRetryUpload }: { result: CaptureOutcome; onRetryUpload?: () => void }) {
  const isOk = result.kind === 'executed' || result.kind === 'server_saved';
  const isWarn = result.kind === 'disambiguation' || result.kind === 'pending' || result.kind === 'review' || result.kind === 'upload_incomplete' || result.kind === 'status_unknown';
  const eyebrow = result.kind === 'executed' ? 'Done'
    : result.kind === 'server_saved' ? 'Saved'
    : result.kind === 'disambiguation' ? 'Needs clarification'
    : result.kind === 'pending' ? 'Saved · processing'
    : result.kind === 'review' ? 'Saved · needs review'
    : result.kind === 'upload_incomplete' ? 'Upload incomplete'
    : result.kind === 'status_unknown' ? 'Checking'
    : result.kind === 'save_failed' ? 'Not saved'
    : 'Capture';
  return (
    <div
      role="status"
      className={`border-t px-4 py-3 ${
        isOk ? 'bg-ink text-bg border-ink' : isWarn ? 'bg-surface-2 text-ink border-line' : 'bg-accent text-bg border-accent'
      }`}
    >
      <div className="eyebrow opacity-70 mb-1">{eyebrow}</div>
      <div className="font-sans text-[13px] leading-snug">
        {result.kind === 'executed' && result.summary}
        {result.kind === 'disambiguation' && `Ambiguous: ${result.field}. Try again with a more specific name.`}
        {result.kind === 'parse_error' && `Couldn't parse: ${result.message}`}
        {result.kind === 'http_error' && `Error: ${result.message}`}
        {(result.kind === 'server_saved' || result.kind === 'pending' || result.kind === 'review' || result.kind === 'upload_incomplete' || result.kind === 'status_unknown' || result.kind === 'save_failed') && result.message}
      </div>
      {(LINK_KINDS.has(result.kind) || (result.kind === 'upload_incomplete' && onRetryUpload)) && (
        <div className="mt-2 flex items-center gap-3">
          {'captureId' in result && (
            <a href={`/inbox/captures/${result.captureId}`} className="font-mono text-[10px] uppercase tracking-wider underline underline-offset-2 opacity-80 hover:opacity-100">
              Open in Inbox
            </a>
          )}
          {result.kind === 'upload_incomplete' && onRetryUpload && (
            <button type="button" onClick={onRetryUpload} className="font-mono text-[10px] uppercase tracking-wider border border-current px-2 py-0.5 hover:opacity-80">
              Retry upload
            </button>
          )}
        </div>
      )}
    </div>
  );
}
