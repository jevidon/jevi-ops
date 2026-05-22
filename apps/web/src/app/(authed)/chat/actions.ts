'use server';

import { chatApi, ApiError, type ChatResponse } from '@/lib/api';
import { getAccessToken } from '@/lib/auth';

export type AskResult =
  | { ok: true; response: ChatResponse }
  | { ok: false; error: string };

export async function askAction(question: string): Promise<AskResult> {
  if (!question.trim()) return { ok: false, error: 'empty question' };
  try {
    const response = await chatApi.ask(question);
    return { ok: true, response };
  } catch (err) {
    if (err instanceof ApiError) {
      const body = err.body as { error?: string; message?: string } | null;
      return { ok: false, error: body?.message ?? body?.error ?? `API ${err.status}` };
    }
    return { ok: false, error: (err as Error).message };
  }
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

// Server action for voice → transcript. Forwards FormData to the API's
// /api/capture/transcribe endpoint. Returns the plain transcript.
export async function transcribeAudioAction(formData: FormData): Promise<{ ok: true; transcript: string } | { ok: false; error: string }> {
  const audio = formData.get('audio');
  if (!(audio instanceof Blob) || audio.size === 0) {
    return { ok: false, error: 'no audio' };
  }
  const token = await getAccessToken();
  if (!token) return { ok: false, error: 'no_session' };

  const res = await fetch(`${API_URL}/api/capture/transcribe`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
    cache: 'no-store',
  });
  if (!res.ok) {
    let body: { error?: string; message?: string } | null = null;
    try {
      body = (await res.json()) as { error?: string; message?: string };
    } catch { /* ignore */ }
    return { ok: false, error: body?.message ?? body?.error ?? `HTTP ${res.status}` };
  }
  const json = await res.json() as { transcript?: string };
  return { ok: true, transcript: json.transcript ?? '' };
}
