import { createHmac } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { CapabilityTest, CredentialAction, CredentialStatus, UpdateAppSettings } from '@jevi-ops/shared/schemas';
import { app_settings } from '../db/schema.js';
import { getDb } from './db.js';
import { env } from './env.js';
import { type AppSettings, getAppSettings, invalidateAppSettings } from './app-settings.js';
import { openSecret, sealSecret, SettingsError, type SecretEnvelope } from './settings-crypto.js';

export type Integration = 'llm' | 'stt' | 'immich';
export const integrationNames: Integration[] = ['llm', 'stt', 'immich'];
export interface StoredCredential { source: 'environment' | 'none' | 'managed'; binding: string; allow_insecure: boolean; envelope?: SecretEnvelope }
export interface ResolvedIntegration {
  provider: 'openai_compatible' | 'anthropic' | 'immich';
  baseUrl: string | null;
  model: string | null;
  apiKey: string | null;
  credential: CredentialStatus;
  configured: boolean;
  fingerprint: string;
}
export function canonicalEndpoint(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const u = new URL(value);
    if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.search || u.hash) throw new Error();
    return u.href.replace(/\/+$/, '');
  } catch { throw new SettingsError('invalid_endpoint'); }
}
function target(s: AppSettings, integration: Integration) {
  if (integration === 'llm') {
    const provider = s.llm_provider ?? env.LLM_PROVIDER;
    return { provider, baseUrl: canonicalEndpoint(provider === 'anthropic' ? 'https://api.anthropic.com' : s.llm_base_url ?? env.LLM_BASE_URL), model: s.llm_model ?? (provider === 'anthropic' ? env.ANTHROPIC_MODEL : env.LLM_MODEL) ?? null };
  }
  if (integration === 'stt') return { provider: 'openai_compatible' as const, baseUrl: canonicalEndpoint(s.stt_base_url ?? env.STT_BASE_URL ?? 'https://api.openai.com/v1'), model: s.stt_model ?? env.STT_MODEL };
  return { provider: 'immich' as const, baseUrl: canonicalEndpoint(s.immich_base_url ?? env.IMMICH_BASE_URL), model: null };
}
export function credentialBinding(s: AppSettings, integration: Integration): string {
  const cfg = target(s, integration);
  return `${integration}:${cfg.provider}:${cfg.baseUrl ?? ''}`;
}
function environmentCredential(integration: Integration, provider: ResolvedIntegration['provider']) {
  if (integration === 'llm') return { value: (provider === 'anthropic' ? env.ANTHROPIC_API_KEY : env.LLM_API_KEY) ?? null, endpoint: canonicalEndpoint(provider === 'anthropic' ? 'https://api.anthropic.com' : env.LLM_BASE_URL) };
  if (integration === 'stt') return { value: env.STT_API_KEY ?? null, endpoint: canonicalEndpoint(env.STT_BASE_URL ?? 'https://api.openai.com/v1') };
  return { value: env.IMMICH_API_KEY ?? null, endpoint: canonicalEndpoint(env.IMMICH_BASE_URL) };
}
export function permitsCredentials(endpoint: string | null, acknowledge: boolean): boolean {
  if (!endpoint) return false;
  const u = new URL(endpoint);
  return u.protocol === 'https:' || u.hostname === 'localhost' || u.hostname === '[::1]' || /^127\.\d+\.\d+\.\d+$/.test(u.hostname) || acknowledge;
}
export function resolveIntegration(s: AppSettings, integration: Integration): ResolvedIntegration {
  let cfg: ReturnType<typeof target>;
  try { cfg = target(s, integration); }
  catch {
    return { provider: 'openai_compatible', baseUrl: null, model: null, apiKey: null, credential: { source: 'none', configured: false, state: 'invalid_endpoint', endpoint: null, allow_insecure: false }, configured: false, fingerprint: 'invalid_endpoint' };
  }
  const stored = s.credential_settings[integration] as StoredCredential | undefined;
  const binding = credentialBinding(s, integration);
  const credential: CredentialStatus = { source: stored?.source ?? 'environment', configured: false, state: 'missing', endpoint: cfg.baseUrl, allow_insecure: stored?.allow_insecure ?? false };
  let apiKey: string | null = null;
  const legacy = integration === 'llm' ? s.llm_api_key : integration === 'immich' ? s.immich_api_key : null;
  if (stored && (!['managed', 'environment', 'none'].includes(stored.source) || typeof stored.binding !== 'string' || typeof stored.allow_insecure !== 'boolean')) { credential.source = 'managed'; credential.state = 'locked'; }
  else if (legacy) { credential.source = 'managed'; credential.state = 'migration_required'; }
  else if (stored && stored.binding !== binding && stored.source !== 'none') credential.state = 'binding_mismatch';
  else if (stored?.source === 'managed') {
    try {
      if (!stored.envelope) throw new Error();
      apiKey = openSecret(stored.envelope, binding);
      credential.state = 'ready';
    } catch { credential.state = 'locked'; }
  } else if (stored?.source !== 'none') {
    try {
      const fromEnv = environmentCredential(integration, cfg.provider);
      if (fromEnv.value && fromEnv.endpoint !== cfg.baseUrl) credential.state = 'binding_mismatch';
      else { apiKey = fromEnv.value; credential.state = apiKey ? 'ready' : 'missing'; }
    } catch { credential.state = 'invalid_endpoint'; }
  }
  if (apiKey && !permitsCredentials(cfg.baseUrl, credential.allow_insecure)) { apiKey = null; credential.state = 'insecure_transport'; }
  credential.configured = Boolean(apiKey);
  const healthy = credential.state === 'ready' || credential.state === 'missing';
  const requiresKey = cfg.provider === 'anthropic' || integration === 'immich' || (cfg.baseUrl != null && new URL(cfg.baseUrl).hostname === 'api.openai.com');
  const configured = healthy && Boolean(cfg.baseUrl && (integration === 'immich' || cfg.model) && (!requiresKey || apiKey));
  // A keyed digest binds tests to the exact credential without exposing a
  // reusable verifier of weak user-supplied secrets in the public DTO.
  const fingerprint = createHmac('sha256', env.AUTH_SECRET ?? 'unconfigured-auth')
    .update(JSON.stringify([integration, cfg, apiKey, credential])).digest('hex');
  return { ...cfg, apiKey, credential, configured, fingerprint };
}
export async function activeIntegration(integration: Integration): Promise<ResolvedIntegration> {
  const resolved = resolveIntegration(await getAppSettings(), integration);
  if (!['ready', 'missing'].includes(resolved.credential.state)) throw new SettingsError(`credential_${resolved.credential.state}`, 503);
  return resolved;
}

/** Returns only explicitly public fields. Never spread a database row here. */
export function publicSettings(s: AppSettings) {
  const integrations = Object.fromEntries(integrationNames.map((name) => [name, resolveIntegration(s, name)])) as Record<Integration, ResolvedIntegration>;
  const safeUrl = (value: string | null) => { try { return canonicalEndpoint(value); } catch { return null; } };
  const tests = Object.values(s.capability_tests) as CapabilityTest[];
  const capability = (name: Integration) => ({ configured: integrations[name].configured, fingerprint: integrations[name].fingerprint, tests: tests.filter((t) => t.fingerprint === integrations[name].fingerprint) });
  return {
    revision: s.revision, timezone: s.timezone,
    llm_provider: s.llm_provider, llm_base_url: safeUrl(s.llm_base_url), llm_model: s.llm_model,
    stt_base_url: safeUrl(s.stt_base_url), stt_model: s.stt_model, immich_base_url: safeUrl(s.immich_base_url),
    health_module_enabled: s.health_module_enabled, routines_module_enabled: s.routines_module_enabled,
    rule_module_enabled: s.rule_module_enabled, maintenance_module_enabled: s.maintenance_module_enabled,
    meter_stale_days: s.meter_stale_days, currency: s.currency, briefing_panels: s.briefing_panels,
    agenda_image_url: safeUrl(s.agenda_image_url), agenda_data_url: safeUrl(s.agenda_data_url),
    credentials: { llm: integrations.llm.credential, stt: integrations.stt.credential, immich: integrations.immich.credential },
    capabilities: { llm: capability('llm'), stt: capability('stt'), immich: capability('immich') },
  };
}
export function prepareSettings(s: AppSettings, patch: UpdateAppSettings): AppSettings {
  if (patch.expected_revision !== s.revision) throw new SettingsError('settings_revision_conflict', 409);
  const { expected_revision: _, llm_credential, stt_credential, immich_credential,
    llm_allow_insecure_credentials, stt_allow_insecure_credentials, immich_allow_insecure_credentials, ...fields } = patch;
  const next: AppSettings = { ...s, ...fields, credential_settings: { ...s.credential_settings } };
  const actions: Record<Integration, CredentialAction | undefined> = { llm: llm_credential, stt: stt_credential, immich: immich_credential };
  const insecure = { llm: llm_allow_insecure_credentials, stt: stt_allow_insecure_credentials, immich: immich_allow_insecure_credentials };
  for (const name of integrationNames) {
    const touched = Object.keys(patch).some((key) => key.startsWith(`${name}_`));
    if (!touched) continue;
    const action = actions[name];
    const old = s.credential_settings[name] as StoredCredential | undefined;
    const binding = credentialBinding(next, name);
    let priorBinding: string | null = null;
    try { priorBinding = credentialBinding(s, name); } catch { /* legacy invalid URLs require explicit repair */ }
    const changed = priorBinding !== binding;
    const oldCredential = resolveIntegration(s, name).credential;
    if (changed && (!action || action.action === 'keep') && (oldCredential.configured || !['ready', 'missing'].includes(oldCredential.state))) {
      throw new SettingsError('credential_selection_required');
    }
    const allow_insecure = insecure[name] ?? (changed ? false : old?.allow_insecure ?? false);
    if (action && action.action !== 'keep') {
      if (action.action === 'replace') next.credential_settings[name] = { source: 'managed', binding, allow_insecure, envelope: sealSecret(action.value, binding) } satisfies StoredCredential;
      else next.credential_settings[name] = { source: action.action === 'clear' ? 'none' : 'environment', binding, allow_insecure } satisfies StoredCredential;
      if (name === 'llm') next.llm_api_key = null;
      if (name === 'immich') next.immich_api_key = null;
    } else if (old) next.credential_settings[name] = { ...old, allow_insecure };
    else if (insecure[name] !== undefined) next.credential_settings[name] = { source: 'environment', binding, allow_insecure } satisfies StoredCredential;
    if (action || changed || insecure[name] !== undefined) {
      const resolved = resolveIntegration(next, name);
      if (['binding_mismatch', 'insecure_transport', 'invalid_endpoint'].includes(resolved.credential.state)) throw new SettingsError(`credential_${resolved.credential.state}`);
    }
  }
  return next;
}
export async function updateSettings(patch: UpdateAppSettings) {
  const result = await getDb().transaction(async (tx) => {
    const [row] = await tx.select().from(app_settings).where(eq(app_settings.id, true)).for('update');
    if (!row) throw new SettingsError('settings_unavailable', 503);
    const next = prepareSettings(row as AppSettings, patch);
    const { capability_tests: _tests, ...write } = next;
    const [saved] = await tx.update(app_settings).set({ ...write, revision: row.revision + 1 }).where(eq(app_settings.id, true)).returning();
    return publicSettings(saved as AppSettings);
  });
  invalidateAppSettings();
  return result;
}
export async function recordCapabilityTest(result: CapabilityTest): Promise<void> {
  await getDb().transaction(async (tx) => {
    const [row] = await tx.select().from(app_settings).where(eq(app_settings.id, true)).for('update');
    if (!row) throw new SettingsError('settings_unavailable', 503);
    const tests = { ...row.capability_tests, [`${result.fingerprint}:${result.capability}`]: result };
    const latest = Object.entries(tests).sort((a, b) => (b[1] as CapabilityTest).tested_at.localeCompare((a[1] as CapabilityTest).tested_at)).slice(0, 30);
    await tx.update(app_settings).set({ capability_tests: Object.fromEntries(latest) }).where(eq(app_settings.id, true));
  });
  invalidateAppSettings();
}
