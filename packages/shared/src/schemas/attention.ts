import { z } from 'zod';

// Attention Engine (migration 0035) — wire shapes for /api/attention.
// Items are generated server-side by the daily cron (lib/attention.ts);
// clients only read them and apply lifecycle actions.

export const AttentionStatusSchema = z.enum([
  'active',
  'dismissed',
  'snoozed',
  'acted_on',
  'expired',
]);
export const AttentionUrgencySchema = z.enum(['low', 'normal', 'high']);
export const AttentionSourceTypeSchema = z.enum([
  'person',
  'company',
  'domain',
  'project',
  'conversation',
  'task',
  'content',
]);

export const AttentionItemSchema = z.object({
  id: z.string().uuid(),
  rule_type: z.string(),
  source_type: AttentionSourceTypeSchema,
  source_id: z.string().uuid(),
  title: z.string(),
  detail: z.string().nullable().optional(),
  suggested_action: z.string().nullable().optional(),
  score: z.number(),
  urgency: AttentionUrgencySchema,
  first_surfaced_at: z.string().datetime({ offset: true }),
  last_surfaced_at: z.string().datetime({ offset: true }),
  surface_count: z.number().int(),
  status: AttentionStatusSchema,
  snoozed_until: z.string().date().nullable().optional(),
  dismissed_at: z.string().datetime({ offset: true }).nullable().optional(),
  acted_on_at: z.string().datetime({ offset: true }).nullable().optional(),
  acted_on_action: z.string().nullable().optional(),
  created_at: z.string().datetime({ offset: true }),
});

// PATCH /api/attention/:id body. `until` only applies to snooze (defaults
// to +7 days server-side); `acted_on_action` only to acted_on.
export const AttentionActionSchema = z.object({
  action: z.enum(['snooze', 'dismiss', 'acted_on', 'reactivate']),
  until: z.string().date().optional(),
  acted_on_action: z.string().optional(),
});
