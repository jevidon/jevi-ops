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

export const AppSettingsSchema = z.object({
  id: z.literal(true),
  timezone: TimezoneSchema,
  updated_at: z.string().datetime({ offset: true }),
});

export const UpdateAppSettingsSchema = z.object({
  timezone: TimezoneSchema.optional(),
});

export type AppSettings = z.infer<typeof AppSettingsSchema>;
export type UpdateAppSettings = z.infer<typeof UpdateAppSettingsSchema>;
