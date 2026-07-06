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
  .regex(/^[A-Za-z_]+(?:\/[A-Za-z_+-]+){0,2}$/, 'Must be an IANA timezone string.');

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
  .refine((v) => v === null || /^https?:\/\//.test(v), 'Must be an http(s) URL.');

export const AppSettingsSchema = z.object({
  id: z.literal(true),
  timezone: TimezoneSchema,
  llm_provider: z.enum(['openai_compatible', 'anthropic']).nullable(),
  llm_base_url: z.string().nullable(),
  llm_model: z.string().nullable(),
  llm_api_key: z.string().nullable(),
  stt_base_url: z.string().nullable(),
  stt_model: z.string().nullable(),
  immich_base_url: z.string().nullable(),
  immich_api_key: z.string().nullable(),
  updated_at: z.string().datetime({ offset: true }),
});

// Dashboard-editable integration config. Every field is optional (PATCH
// semantics); explicit null / empty string clears the override so the env
// value applies again.
export const UpdateAppSettingsSchema = z.object({
  timezone: TimezoneSchema.optional(),
  llm_provider: z.enum(['openai_compatible', 'anthropic']).nullable().optional(),
  llm_base_url: ClearableUrl.optional(),
  llm_model: ClearableString.optional(),
  llm_api_key: ClearableString.optional(),
  stt_base_url: ClearableUrl.optional(),
  stt_model: ClearableString.optional(),
  immich_base_url: ClearableUrl.optional(),
  immich_api_key: ClearableString.optional(),
});

export type AppSettings = z.infer<typeof AppSettingsSchema>;
export type UpdateAppSettings = z.infer<typeof UpdateAppSettingsSchema>;
