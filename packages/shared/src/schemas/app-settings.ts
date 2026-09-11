import { z } from 'zod';

// App-wide settings. Single row in the DB (boolean PK pinned to true),
// so this is effectively a singleton record. Future settings get
// added as new columns here + a corresponding field on the schemas.

// IANA timezone validation — just checks the rough shape ("Area/City"
// or single-token like "UTC"). The browser's Intl handles invalid
// values gracefully (falls back to UTC), and the settings UI will
// validate against `Intl.supportedValuesOf('timeZone')` client-side
// before submitting, so anything that gets here should be valid.
const TimezoneSchema = z
  .string()
  .min(1)
  // Later segments allow digits for the Etc/GMT+N family, which the
  // settings picker now lists (it offers every Intl.supportedValuesOf zone).
  .refine((v) => { try { new Intl.DateTimeFormat('en', { timeZone: v }); return true; } catch { return false; } }, 'Must be an IANA timezone string.');

// Nullable-on-write string: empty string or null clears the column back to
// "use the env fallback".
const ClearableString = z
  .string()
  .trim()
  .transform((v) => (v === '' ? null : v))
  .nullable();

const ClearableUrl = z
  .string()
  .trim()
  .transform((v) => (v === '' ? null : v))
  .nullable()
  .refine((v) => { if (v === null) return true; try { const u = new URL(v); return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password && !u.search && !u.hash; } catch { return false; } }, 'Use an http(s) URL without credentials, query or fragment.');

// Briefing panel visibility/order (migration 0044): an ordered array of
// {id, enabled}. Strictly validated on write — malformed config must never
// wedge the homepage. Null → registry defaults; ids are free-form strings
// so retiring/shipping panels needs no schema change (the web registry
// drops unknown ids and appends new ones at read time).
export const BriefingPanelConfigSchema = z
  .array(z.object({ id: z.string().min(1).max(64), enabled: z.boolean() }))
  .max(32);
export type BriefingPanelConfig = z.infer<typeof BriefingPanelConfigSchema>;

export const CredentialActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('keep') }).strict(),
  z.object({ action: z.literal('clear') }).strict(),
  z.object({ action: z.literal('use_environment') }).strict(),
  z.object({ action: z.literal('replace'), value: z.string().trim().min(1).max(8192) }).strict(),
]);
export const CredentialStatusSchema = z.object({
  source: z.enum(['environment', 'managed', 'none']),
  configured: z.boolean(),
  state: z.enum(['ready', 'missing', 'locked', 'binding_mismatch', 'migration_required', 'insecure_transport', 'invalid_endpoint']),
  endpoint: z.string().nullable(),
  allow_insecure: z.boolean(),
});
export const CapabilityTestSchema = z.object({
  capability: z.enum(['text', 'structured', 'tools', 'stt_reachability', 'immich_reachability']),
  fingerprint: z.string(),
  status: z.enum(['passed', 'failed']),
  tested_at: z.string(),
  error: z.string().nullable(),
  latency_ms: z.number(),
});
export type CredentialAction = z.infer<typeof CredentialActionSchema>;
export type CredentialStatus = z.infer<typeof CredentialStatusSchema>;
export type CapabilityTest = z.infer<typeof CapabilityTestSchema>;

export const AppSettingsSchema = z.object({
  revision: z.number().int().positive(),
  credentials: z.object({ llm: CredentialStatusSchema, stt: CredentialStatusSchema, immich: CredentialStatusSchema }),
  capabilities: z.record(z.object({ configured: z.boolean(), fingerprint: z.string(), tests: z.array(CapabilityTestSchema) })),
  timezone: TimezoneSchema,
  llm_provider: z.enum(['openai_compatible', 'anthropic']).nullable(),
  llm_base_url: z.string().nullable(),
  llm_model: z.string().nullable(),
  stt_base_url: z.string().nullable(),
  stt_model: z.string().nullable(),
  immich_base_url: z.string().nullable(),
  // Module feature flags (migration 0036). The Editorial v2 layout gates
  // nav items and routes on these; rule_module_enabled stays false (the
  // upstream Daily Rule module isn't ported).
  health_module_enabled: z.boolean(),
  routines_module_enabled: z.boolean(),
  rule_module_enabled: z.boolean(),
  // Maintenance module (migration 0047). Default on — core home-ops.
  maintenance_module_enabled: z.boolean(),
  // Reading-staleness policy (0048): days without a meter reading before
  // the reading nag fires.
  meter_stale_days: z.number().int().positive(),
  // Household currency (0052), ISO 4217. Spend totals are stated in it;
  // foreign-currency invoices are listed apart, never converted.
  currency: z.string().regex(/^[A-Z]{3}$/),
  briefing_panels: BriefingPanelConfigSchema.nullable(),
  // Frame panel image URL (migration 0045); null hides the panel.
  agenda_image_url: z.string().nullable(),
  // Weather panel data-bundle URL (migration 0046); null hides the panel.
  agenda_data_url: z.string().nullable(),
});

// Dashboard-editable integration config. Every field is optional (PATCH
// semantics); explicit null / empty string clears the override so the env
// value applies again.
export const UpdateAppSettingsSchema = z.object({
  expected_revision: z.number().int().positive(),
  llm_credential: CredentialActionSchema.optional(),
  stt_credential: CredentialActionSchema.optional(),
  immich_credential: CredentialActionSchema.optional(),
  llm_allow_insecure_credentials: z.boolean().optional(),
  stt_allow_insecure_credentials: z.boolean().optional(),
  immich_allow_insecure_credentials: z.boolean().optional(),
  timezone: TimezoneSchema.optional(),
  llm_provider: z.enum(['openai_compatible', 'anthropic']).nullable().optional(),
  llm_base_url: ClearableUrl.optional(),
  llm_model: ClearableString.optional(),
  stt_base_url: ClearableUrl.optional(),
  stt_model: ClearableString.optional(),
  immich_base_url: ClearableUrl.optional(),
  health_module_enabled: z.boolean().optional(),
  routines_module_enabled: z.boolean().optional(),
  rule_module_enabled: z.boolean().optional(),
  maintenance_module_enabled: z.boolean().optional(),
  meter_stale_days: z.number().int().positive().max(365).optional(),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, 'Use a three-letter ISO 4217 code.').optional(),
  briefing_panels: BriefingPanelConfigSchema.nullable().optional(),
  agenda_image_url: ClearableUrl.optional(),
  agenda_data_url: ClearableUrl.optional(),
}).strict();

export const CandidateSettingsTestSchema = z.object({
  candidate: UpdateAppSettingsSchema.optional(),
  capability: z.enum(['text', 'structured', 'tools']).default('text'),
}).strict();

export type AppSettings = z.infer<typeof AppSettingsSchema>;
export type UpdateAppSettings = z.infer<typeof UpdateAppSettingsSchema>;
