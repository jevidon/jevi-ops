import OpenAI from 'openai';
import { toFile } from 'openai/uploads';
import { activeIntegration, resolveIntegration } from './settings-config.js';
import { integrationFetch, safeProviderError } from './integration-fetch.js';
import { SettingsError } from './settings-crypto.js';
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
  const cfg = await activeIntegration('stt');
  if (!cfg.configured) throw new Error('stt_not_configured');
  return { baseUrl: cfg.baseUrl!, model: cfg.model!, apiKey: cfg.apiKey };
}
export async function isSttConfigured(): Promise<boolean> {
  try { return resolveIntegration(await getAppSettings(), 'stt').configured; } catch { return false; }
}
export async function sttDescription(): Promise<string> {
  try {
    const cfg = resolveIntegration(await getAppSettings(), 'stt');
    return `${cfg.baseUrl ?? 'endpoint missing'} · ${cfg.model ?? 'model missing'} · ${cfg.credential.state}`;
  } catch { return 'STT settings unavailable'; }
}

let cached: { key: string; client: OpenAI } | null = null;
function client(cfg: ResolvedSttConfig): OpenAI {
  const key = `${cfg.baseUrl}|${cfg.apiKey ?? ''}`;
  if (cached?.key === key) return cached.client;
  const c = new OpenAI({ baseURL: cfg.baseUrl, apiKey: cfg.apiKey ?? 'none', fetch: integrationFetch as unknown as NonNullable<ConstructorParameters<typeof OpenAI>[0]>['fetch'], maxRetries: 0, timeout: 60_000 });
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
  }).catch((error: unknown) => { throw new SettingsError(safeProviderError(error), 502); });
  // With response_format: 'text', the result is a plain string.
  return typeof result === 'string' ? result.trim() : '';
}
