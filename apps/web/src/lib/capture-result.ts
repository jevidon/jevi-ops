import type { InterpretResponse, VoiceCaptureResponse } from './api';

// Capture outcome shapes shared by the server actions (voice-actions.ts,
// capture-actions.ts) and the portal's client components. No runtime import
// of ./api here — that module is server-only and this file renders in the
// browser.
//
// Two layers of truth are kept apart on purpose: storage ("Saved to Jevi
// Ops") comes from the durable receipt, and interpretation ("Created 2
// tasks") from a later, separate call. A chip never says "saved" because an
// HTTP request started, and never says "done" because a save succeeded.

export type VoiceResult =
  | { kind: 'executed'; summary: string; details: VoiceCaptureResponse['actions'] }
  | { kind: 'disambiguation'; field: string; candidates: { id: string; label: string }[]; transcript: string }
  | { kind: 'parse_error'; message: string; transcript: string }
  | { kind: 'http_error'; message: string };

export type CaptureOutcome =
  | VoiceResult
  // Storage receipts
  | { kind: 'server_saved'; captureId: string; message: string }
  | { kind: 'upload_incomplete'; captureId: string; message: string }
  | { kind: 'status_unknown'; captureId: string; message: string }
  | { kind: 'save_failed'; message: string }
  // Interpretation states that are not a legacy result
  | { kind: 'pending'; captureId: string; message: string; state: string; errorCode: string | null }
  | { kind: 'review'; captureId: string; message: string; state: string; errorCode: string | null };

export function summarize(actions: VoiceCaptureResponse['actions']): string {
  if (!actions || actions.length === 0) return 'Nothing to do.';
  const success = actions.filter((a) => a.status === 'success');
  const skipped = actions.filter((a) => a.status === 'skipped');
  const failed = actions.filter((a) => a.status === 'failed');
  const parts: string[] = [];
  if (success.length > 0) parts.push(`✓ ${success.length} done`);
  if (skipped.length > 0) parts.push(`⚠ ${skipped.length} skipped`);
  if (failed.length > 0) parts.push(`✕ ${failed.length} failed`);
  return parts.join(' · ');
}

export function shapeResponse(res: VoiceCaptureResponse): VoiceResult {
  if (res.status === 'executed') {
    return { kind: 'executed', summary: summarize(res.actions), details: res.actions };
  }
  if (res.status === 'needs_disambiguation') {
    return {
      kind: 'disambiguation',
      field: res.field ?? 'unknown',
      candidates: res.candidates ?? [],
      transcript: res.transcript,
    };
  }
  // Translate machine error codes to friendlier copy where it helps.
  const friendly: Record<string, string> = {
    audio_too_short: 'Hold the mic and speak for at least a second.',
    empty_transcript: "Couldn't hear anything. Try again.",
  };
  const code = res.error ?? 'parse_error';
  return {
    kind: 'parse_error',
    message: friendly[code] ?? code,
    transcript: res.transcript,
  };
}

const BLOCKED_COPY: Record<string, string> = {
  llm_unavailable: 'Saved to Jevi Ops. Interpretation is waiting for the local model.',
  llm_not_configured: 'Saved to Jevi Ops. No language model is configured yet.',
  stt_unavailable: 'Saved to Jevi Ops. Transcription is waiting for the local speech server.',
  stt_not_configured: 'Saved to Jevi Ops. No transcription server is configured yet.',
  stt_failed: 'Saved to Jevi Ops. Transcription failed; the recording is kept.',
  endpoint_not_approved: 'Saved to Jevi Ops. Interpretation refused: the configured model endpoint is not an approved local endpoint.',
  parser_failed: "Saved to Jevi Ops. The model's reply couldn't be used; retry from Inbox › Captures.",
  image_processing_unavailable: 'Saved to Jevi Ops. Image understanding is not available yet.',
};
const REVIEW_COPY: Record<string, string> = {
  external_effect_requires_review: 'Saved. This includes a calendar event, which needs your review in Inbox › Captures.',
  partial_execution: 'Saved. Some actions failed; review the result in Inbox › Captures.',
  execution_uncertain: 'Saved. The outcome is uncertain; review it in Inbox › Captures before retrying.',
};

/** Turn the bridge's response into what the chip shows. */
export function shapeInterpret(res: InterpretResponse): CaptureOutcome {
  const outcome = res.outcome as VoiceCaptureResponse | null;
  if (res.processing_state === 'committed' && outcome) return shapeResponse(outcome);
  if (res.processing_state === 'needs_review') {
    if (outcome?.status === 'needs_disambiguation') return shapeResponse(outcome);
    if (outcome?.status === 'parse_error') return shapeResponse(outcome);
    return { kind: 'review', captureId: res.capture_id, state: res.processing_state, errorCode: res.error_code, message: (res.error_code && REVIEW_COPY[res.error_code]) ?? 'Saved. One item needs your review in Inbox › Captures.' };
  }
  if (res.processing_state === 'blocked') {
    return { kind: 'pending', captureId: res.capture_id, state: res.processing_state, errorCode: res.error_code, message: (res.error_code && BLOCKED_COPY[res.error_code]) ?? 'Saved to Jevi Ops. Interpretation is blocked; see Inbox › Captures.' };
  }
  return { kind: 'pending', captureId: res.capture_id, state: res.processing_state, errorCode: res.error_code, message: 'Saved to Jevi Ops. Interpretation is pending — see Inbox › Captures.' };
}
