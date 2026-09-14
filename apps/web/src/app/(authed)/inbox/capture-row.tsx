import Link from 'next/link';
import type { CaptureDetail } from '@/lib/api';

// One row per pending capture in Inbox. Not a TriageRow: a capture is the
// original thing the owner said or recorded, with truthful storage and
// processing state — never a fake task.

export const CAPTURE_STATE_COPY: Record<string, string> = {
  awaiting_media: 'upload incomplete',
  queued: 'saved · waiting',
  preprocessing: 'processing',
  ready_for_hermes: 'ready',
  interpreting: 'interpreting',
  needs_review: 'needs review',
  committed: 'done',
  retry_wait: 'retrying',
  blocked: 'blocked',
  cancelled: 'cancelled',
  legacy: 'earlier capture',
};

export function capturePreview(capture: CaptureDetail): string {
  if (capture.text) return capture.text.length > 140 ? `${capture.text.slice(0, 140)}…` : capture.text;
  const n = capture.media.length;
  return `${capture.kind ?? 'capture'} · ${n} attachment${n === 1 ? '' : 's'}`;
}

export function CaptureRow({ capture, tz }: { capture: CaptureDetail; tz: string }) {
  const when = new Date(capture.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: tz });
  const state = CAPTURE_STATE_COPY[capture.processing_state] ?? capture.processing_state;
  const attention = capture.processing_state === 'needs_review' || capture.processing_state === 'blocked' || capture.processing_state === 'awaiting_media';
  return (
    <li className="py-3 border-b border-line/40">
      <Link href={`/inbox/captures/${capture.capture_id}`} className="block group">
        <div className="font-sans text-[14px] text-ink leading-snug mb-1 group-hover:underline underline-offset-2">
          {capturePreview(capture)}
        </div>
        <div className="flex flex-wrap items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-ink-3">
          <span>{capture.kind ?? 'text'}</span>
          <span aria-hidden>·</span>
          <span className={attention ? 'text-accent' : ''}>{state}</span>
          {capture.error_code && (
            <>
              <span aria-hidden>·</span>
              <span>{capture.error_code.replace(/_/g, ' ')}</span>
            </>
          )}
          {capture.storage_state === 'awaiting_media' && (
            <>
              <span aria-hidden>·</span>
              <span className="text-accent">not fully saved</span>
            </>
          )}
          <span className="ml-auto">{when}</span>
        </div>
      </Link>
    </li>
  );
}
