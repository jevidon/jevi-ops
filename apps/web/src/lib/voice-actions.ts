'use server';

import { revalidatePath } from 'next/cache';
import { captureApi, ApiError, type VoiceCaptureResponse } from './api';

export type VoiceResult =
  | { kind: 'executed'; summary: string; details: VoiceCaptureResponse['actions'] }
  | { kind: 'disambiguation'; field: string; candidates: { id: string; label: string }[]; transcript: string }
  | { kind: 'parse_error'; message: string; transcript: string }
  | { kind: 'http_error'; message: string };

function summarize(actions: VoiceCaptureResponse['actions']): string {
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

function shapeResponse(res: VoiceCaptureResponse): VoiceResult {
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

function shapeError(err: unknown): VoiceResult {
  if (err instanceof ApiError) {
    const body = err.body as { error?: string } | null;
    return { kind: 'http_error', message: body?.error ?? `HTTP ${err.status}` };
  }
  return { kind: 'http_error', message: (err as Error).message };
}

// `source` distinguishes Cmd+J text captures from voice fallbacks so
// the API can tag created rows with the right value (tasks → 'manual'
// vs 'voice'; journal_entries → 'typed' vs 'voice'). Defaults to
// 'voice' for back-compat with any caller that doesn't care.
export async function submitVoiceTranscript(
  transcript: string,
  source: 'voice' | 'text' = 'voice',
): Promise<VoiceResult> {
  if (!transcript.trim()) {
    return { kind: 'parse_error', message: 'empty transcript', transcript };
  }
  let res: VoiceCaptureResponse;
  try {
    res = await captureApi.voice(transcript, source);
  } catch (err) {
    return shapeError(err);
  }
  revalidatePath('/');
  revalidatePath('/domains');
  return shapeResponse(res);
}

// Audio path. Server actions accept FormData natively — the action receives
// a fresh FormData on the server side with the audio Blob attached.
export async function submitVoiceAudio(formData: FormData): Promise<VoiceResult> {
  const audio = formData.get('audio');
  if (!(audio instanceof Blob) || audio.size === 0) {
    return { kind: 'http_error', message: 'no audio attached' };
  }
  let res: VoiceCaptureResponse;
  try {
    res = await captureApi.voiceAudio(formData);
  } catch (err) {
    return shapeError(err);
  }
  revalidatePath('/');
  revalidatePath('/domains');
  return shapeResponse(res);
}
