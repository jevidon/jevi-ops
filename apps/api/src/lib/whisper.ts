import OpenAI from 'openai';
import { toFile } from 'openai/uploads';
import { env } from './env.js';

// OpenAI Whisper transcription. Used when the browser ships raw audio bytes
// (e.g. MediaRecorder webm/opus) instead of a transcript — works around the
// Web Speech API being blocked on networks that filter googleapis.com.

let _client: OpenAI | null = null;

function openai(): OpenAI {
  if (_client) return _client;
  if (!env.OPENAI_API_KEY) {
    throw new Error('OpenAI client requested but OPENAI_API_KEY is not set.');
  }
  _client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  return _client;
}

export function isWhisperConfigured(): boolean {
  return Boolean(env.OPENAI_API_KEY);
}

/**
 * Transcribe an audio buffer to text via Whisper.
 * @param buffer Raw audio bytes.
 * @param filename A filename hint with the correct extension — Whisper uses
 *   this to detect the format. Common values: 'audio.webm', 'audio.mp4',
 *   'audio.m4a', 'audio.wav'.
 * @param mimeType Content type from the upload.
 */
export async function transcribeAudio(
  buffer: Buffer,
  filename: string,
  mimeType: string,
): Promise<string> {
  const file = await toFile(buffer, filename, { type: mimeType });
  const result = await openai().audio.transcriptions.create({
    file,
    model: env.OPENAI_WHISPER_MODEL,
    // English-only for now — Jerad is in Mountain Time, English speaker.
    // Drop this if multilingual capture becomes a need.
    language: 'en',
    response_format: 'text',
  });
  // With response_format: 'text', the result is a plain string.
  return typeof result === 'string' ? result.trim() : '';
}
