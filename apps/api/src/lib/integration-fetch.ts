import { SettingsError } from './settings-crypto.js';

/** Provider requests never follow redirects carrying credentials. Bounded
 *  non-streaming responses avoid unlimited memory and body-read hangs. */
export const integrationFetch: typeof fetch = async (input, init) => {
  const requestSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
  const signal = AbortSignal.any([AbortSignal.timeout(60_000), ...(requestSignal ? [requestSignal] : [])]);
  const response = await fetch(input, { ...init, signal, redirect: 'error' });
  if (!response.body) return response;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 2 * 1024 * 1024) throw new SettingsError('provider_response_too_large', 502);
      chunks.push(chunk.value);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  return new Response(Buffer.concat(chunks), { status: response.status, statusText: response.statusText, headers: response.headers });
};

export function safeProviderError(error: unknown): string {
  // Do not echo SDK message/body/request/headers: providers may reflect keys.
  const value = error as { status?: number; name?: string; code?: string; cause?: unknown };
  if (value.status === 401 || value.status === 403) return 'authentication_failed';
  if (value.status === 404) return 'model_or_endpoint_not_found';
  if (value.status === 400 || value.status === 422) return 'unsupported_request';
  if (value.status === 429) return 'provider_rate_limited';
  if (value.name?.includes('Timeout') || value.name === 'AbortError') return 'provider_timeout';
  if (error instanceof SettingsError) return error.code;
  return 'provider_unreachable';
}
