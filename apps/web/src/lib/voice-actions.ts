'use server';

import { revalidatePath } from 'next/cache';
import { captureApi, ApiError, type VoiceCaptureResponse } from './api';

import { shapeResponse, type VoiceResult } from './capture-result';

export type { VoiceResult };

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

// Prompt-cache warm-up. Called on record start / portal open; never
// surfaces an error — a cold parser still works, just slower.
export async function warmCapture(): Promise<void> {
  try {
    await captureApi.warm();
  } catch {
    // ignore — LLM not configured, or unreachable; the capture itself reports that
  }
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
