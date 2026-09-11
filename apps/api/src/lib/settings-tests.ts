import type { CapabilityTest } from '@jevi-ops/shared/schemas';
import { chatCompleteWithConfig, type ResolvedLlmConfig } from './llm.js';
import { integrationFetch, safeProviderError } from './integration-fetch.js';
import { type ResolvedIntegration } from './settings-config.js';
import { SettingsError } from './settings-crypto.js';

export async function testIntegration(cfg: ResolvedIntegration, capability: CapabilityTest['capability']): Promise<CapabilityTest> {
  const started = Date.now();
  let error: string | null = null;
  try {
    if (!cfg.configured) throw new SettingsError(`integration_${cfg.credential.state === 'ready' || cfg.credential.state === 'missing' ? 'not_configured' : cfg.credential.state}`, 503);
    if (capability === 'stt_reachability' || capability === 'immich_reachability') {
      const isStt = capability === 'stt_reachability';
      const response = await integrationFetch(`${cfg.baseUrl}${isStt ? '/models' : '/api/users/me'}`, {
        headers: cfg.apiKey ? isStt ? { Authorization: `Bearer ${cfg.apiKey}` } : { 'x-api-key': cfg.apiKey } : {},
        signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok) throw { status: response.status };
      const body = await response.json() as Record<string, unknown>;
      if (isStt && !Array.isArray(body.data)) throw new SettingsError('unsupported_models_response', 502);
      if (!isStt && typeof body.id !== 'string') throw new SettingsError('unsupported_identity_response', 502);
      // A models listing proves authenticated reachability only. Actual audio
      // transcription and photo permissions are separate runtime operations.
    } else {
      const result = await chatCompleteWithConfig(cfg as ResolvedLlmConfig, {
        system: capability === 'structured' ? 'Return exactly the JSON object {"ok":true}.' : capability === 'tools' ? 'Call the connectivity_check tool exactly once with {"ok":true}. Do not write prose.' : 'Reply with the single word ok.',
        messages: [{ role: 'user', content: 'Run the requested connectivity check.' }],
        maxTokens: 128,
        effort: 'low',
        ...(capability === 'structured' ? { jsonMode: true } : {}),
        ...(capability === 'tools' ? { tools: [{ name: 'connectivity_check', description: 'Connectivity check only; no side effects.', parameters: { type: 'object', properties: { ok: { type: 'boolean', const: true } }, required: ['ok'], additionalProperties: false } }] } : {}),
      });
      if (capability === 'text' && result.text.trim().toLowerCase() !== 'ok') throw new SettingsError('text_check_failed', 502);
      if (capability === 'structured') {
        let body: Record<string, unknown>;
        try { body = JSON.parse(result.text) as Record<string, unknown>; } catch { throw new SettingsError('structured_output_unsupported', 502); }
        if (body?.ok !== true || Object.keys(body).length !== 1) throw new SettingsError('structured_output_unsupported', 502);
      }
      if (capability === 'tools' && (result.toolCalls.length !== 1 || result.toolCalls[0]?.name !== 'connectivity_check' || result.toolCalls[0]?.args.ok !== true || Object.keys(result.toolCalls[0]?.args ?? {}).length !== 1)) throw new SettingsError('tool_call_unsupported', 502);
    }
  } catch (err) { error = safeProviderError(err); }
  return { capability, fingerprint: cfg.fingerprint, status: error ? 'failed' : 'passed', tested_at: new Date().toISOString(), error, latency_ms: Date.now() - started };
}
