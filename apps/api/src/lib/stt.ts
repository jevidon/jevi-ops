import OpenAI from 'openai';
import { toFile } from 'openai/uploads';
import { env } from './env.js';
import { getAppSettings } from './app-settings.js';

// Speech-to-text via any OpenAI-compatible /v1/audio/transcriptions server:
// speaches / faster-whisper-server / whisper.cpp's server on the tailnet, or
// OpenAI cloud as the fallback. Config resolves app_settings (dashboard) →
// env, same pattern as lib/llm.ts.

interface ResolvedSttConfig {
  baseUrl: string;
  apiKey: string | null;
  model: string;
}

const OPENAI_CLOUD = 'https://api.openai.com/v1';

async function resolveConfig(): Promise<ResolvedSttConfig> {
  const s = await getAppSettings();
  return {
    baseUrl: s.stt_base_url ?? env.STT_BASE_URL ?? OPENAI_CLOUD,
    apiKey: env.STT_API_KEY ?? null,
    model: s.stt_model ?? env.STT_MODEL,
  };
}

export async function isSttConfigured(): Promise<boolean> {
  const cfg = await resolveConfig();
  // A local server needs no key; OpenAI cloud does.
  if (cfg.baseUrl === OPENAI_CLOUD) return Boolean(cfg.apiKey);
  return Boolean(cfg.baseUrl);
}

export async function sttDescription(): Promise<string> {
  const cfg = await resolveConfig();
  if (cfg.baseUrl === OPENAI_CLOUD && !cfg.apiKey) return 'OpenAI cloud · API key missing';
  return `${cfg.baseUrl} · ${cfg.model}`;
}

let cached: { key: string; client: OpenAI } | null = null;
function client(cfg: ResolvedSttConfig): OpenAI {
  const key = `${cfg.baseUrl}|${cfg.apiKey ?? ''}`;
  if (cached?.key === key) return cached.client;
  const c = new OpenAI({ baseURL: cfg.baseUrl, apiKey: cfg.apiKey ?? 'none' });
  cached = { key, client: c };
  return c;
}

/**
 * Transcribe an audio buffer to text.
 * @param buffer Raw audio bytes.
 * @param filename A filename hint with the correct extension — servers use
 *   this to detect the format. Common values: 'audio.webm', 'audio.mp4',
 *   'audio.m4a', 'audio.wav'.
 * @param mimeType Content type from the upload.
 */
export async function transcribeAudio(
  buffer: Buffer,
  filename: string,
  mimeType: string,
): Promise<string> {
  const cfg = await resolveConfig();
  const file = await toFile(buffer, filename, { type: mimeType });
  const result = await client(cfg).audio.transcriptions.create({
    file,
    model: cfg.model,
    // English-only for now. Drop this if multilingual capture becomes a need.
    language: 'en',
    response_format: 'text',
  });
  // With response_format: 'text', the result is a plain string.
  return typeof result === 'string' ? result.trim() : '';
}
