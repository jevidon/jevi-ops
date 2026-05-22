import { z } from 'zod';

export const CaptureSourceSchema = z.enum([
  'zapier', 'cowork', 'n8n', 'manual', 'webhook', 'smart_glasses', 'other',
]);

export const DisplayHintSchema = z.enum(['card', 'log', 'hidden']);

export const CapturedDataSchema = z.object({
  id: z.string().uuid(),
  source: CaptureSourceSchema,
  type: z.string().min(1),
  payload: z.record(z.unknown()),
  tags: z.array(z.string()).default([]),
  display_hint: DisplayHintSchema,
  processed_status: z.enum(['raw', 'parsed', 'displayed', 'archived']),
  source_ref: z.string().nullable().optional(),
  created_at: z.string().datetime({ offset: true }),
});

// Payload accepted at POST /api/ingest. Loose by design — anything with
// a `type` and `payload` is recorded; the consumer decides how to display.
export const IngestRequestSchema = z.object({
  source: CaptureSourceSchema.default('webhook'),
  type: z.string().min(1),
  payload: z.record(z.unknown()),
  tags: z.array(z.string()).optional(),
  display_hint: DisplayHintSchema.optional(),
  source_ref: z.string().optional(),
});
