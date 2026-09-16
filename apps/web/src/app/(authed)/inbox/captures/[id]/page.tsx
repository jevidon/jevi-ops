import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ScreenHeader } from '@/components/ScreenHeader';
import { ApiError, capturesApi } from '@/lib/api';
import { getAppTimezone } from '@/lib/app-settings';
import { CAPTURE_STATE_COPY } from '../../capture-row';
import { RetryInterpretationButton } from './retry-button';

// One capture: the exact original, what the server holds, what processing
// did with it, and — only when it is safe — a button to run it again.

export default async function CaptureDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tz = await getAppTimezone();
  let capture;
  try {
    capture = (await capturesApi.get(id)).capture;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }
  const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit', timeZone: tz }) : '—');
  const state = CAPTURE_STATE_COPY[capture.processing_state] ?? capture.processing_state;

  return (
    <div>
      <div className="px-5 lg:px-0 pt-4 pb-1 font-mono text-[10px] uppercase tracking-wider text-ink-3">
        <Link href="/inbox" className="hover:text-ink-2 transition-colors">← Inbox</Link>
      </div>
      <ScreenHeader eyebrow="Capture" title={capture.kind ? `${capture.kind[0]!.toUpperCase()}${capture.kind.slice(1)} capture` : 'Earlier capture'} meta={`${state} · ${fmt(capture.created_at)}`} />
      <div className="hairline mb-4" />

      <div className="px-5 lg:px-0 max-w-2xl flex flex-col gap-5">
        <section>
          <div className="eyebrow mb-1">Original</div>
          {capture.text ? (
            <p className="font-serif text-[16px] text-ink leading-relaxed whitespace-pre-wrap">{capture.text}</p>
          ) : (
            <p className="font-sans text-[13px] text-ink-3">No text. {capture.media.length ? 'See attachments below.' : ''}</p>
          )}
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[10px] uppercase tracking-wider text-ink-3">
            {capture.captured_at && <span>captured {fmt(capture.captured_at)}</span>}
            {capture.client && <span>via {capture.client.name}{capture.client.surface ? ` · ${capture.client.surface}` : ''}</span>}
            {capture.modality && <span>{capture.modality}</span>}
          </div>
        </section>

        {capture.media.length > 0 && (
          <section>
            <div className="eyebrow mb-1">Attachments</div>
            <ul className="flex flex-col gap-1">
              {capture.media.map((m) => (
                <li key={m.attachment_id} className="flex items-center gap-3 font-mono text-[11px] text-ink-2">
                  <span>{m.media_type}</span>
                  <span className="text-ink-3">{Math.round(m.size_bytes / 1024)} KB</span>
                  <span className={m.state === 'verified' ? 'text-ink-3' : 'text-accent'}>{m.state === 'verified' ? 'stored' : 'not uploaded'}</span>
                  {m.state === 'verified' && (
                    <a href={`/inbox/captures/${capture.capture_id}/media/${m.attachment_id}`} className="underline underline-offset-2 hover:text-ink">download original</a>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section>
          <div className="eyebrow mb-1">Status</div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 font-sans text-[13px]">
            <dt className="text-ink-3">Storage</dt>
            <dd className="text-ink">{capture.storage_state === 'complete' ? 'Saved to Jevi Ops' : capture.storage_state === 'awaiting_media' ? 'Waiting for upload — not fully saved' : 'Earlier capture (no receipt)'}</dd>
            <dt className="text-ink-3">Processing</dt>
            <dd className="text-ink">{state}{capture.error_code ? ` · ${capture.error_code.replace(/_/g, ' ')}` : ''}</dd>
            <dt className="text-ink-3">Attempts</dt>
            <dd className="text-ink">{capture.current_attempt_no}</dd>
          </dl>
          {capture.retry_permitted && (
            <div className="mt-3">
              <RetryInterpretationButton captureId={capture.capture_id} expectedAttemptNo={capture.current_attempt_no} />
              <p className="mt-1 font-sans text-[12px] text-ink-3">Safe to retry: the previous attempt stopped before any change was made.</p>
            </div>
          )}
          {capture.processing_state === 'needs_review' && capture.error_code === 'execution_uncertain' && (
            <p className="mt-3 font-sans text-[13px] text-ink-2 leading-relaxed">
              The last attempt stopped after it began applying changes. Check the effects below before doing anything again; this capture is deliberately not retried automatically.
            </p>
          )}
        </section>

        {capture.attempts.length > 0 && (
          <section>
            <div className="eyebrow mb-1">Attempt history</div>
            <ul className="font-mono text-[11px] text-ink-2 flex flex-col gap-0.5">
              {capture.attempts.map((a) => (
                <li key={a.attempt_no}>#{a.attempt_no} · {a.stage}{a.error_code ? ` · ${a.error_code}` : ''} · {fmt(a.started_at)}{a.finished_at ? ` → ${fmt(a.finished_at)}` : ''}</li>
              ))}
            </ul>
          </section>
        )}

        {capture.outcome != null && (
          <section>
            <div className="eyebrow mb-1">Outcome</div>
            <pre className="overflow-x-auto border border-line p-3 font-mono text-[11px] text-ink-2 leading-snug">{JSON.stringify(capture.outcome, null, 2)}</pre>
          </section>
        )}
      </div>
    </div>
  );
}
