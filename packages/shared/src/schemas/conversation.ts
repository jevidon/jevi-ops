import { z } from 'zod';

// Conversations (Addendum 05 §7) — the unified interaction log that
// supersedes person_interactions. A conversation attaches to at least one
// of company / person / project / task, carries a summary (AI for emails,
// user text for manual), optional email metadata + Gmail deep-link, and
// follow-up flags the Attention Engine reads. Mirrors migration 0034.

export const ConversationInteractionTypeSchema = z.enum([
  'email', 'call', 'text_message', 'social_dm',
  'in_person', 'meeting', 'video_call', 'other',
]);
export type ConversationInteractionType = z.infer<typeof ConversationInteractionTypeSchema>;

export const ConversationDirectionSchema = z.enum(['inbound', 'outbound', 'internal']);
export type ConversationDirection = z.infer<typeof ConversationDirectionSchema>;

export const ConversationCapturedViaSchema = z.enum([
  'email_forward', 'manual', 'voice', 'import',
]);
export type ConversationCapturedVia = z.infer<typeof ConversationCapturedViaSchema>;

export const ConversationSchema = z.object({
  id: z.string().uuid(),
  company_id: z.string().uuid().nullable().optional(),
  person_id: z.string().uuid().nullable().optional(),
  project_id: z.string().uuid().nullable().optional(),
  task_id: z.string().uuid().nullable().optional(),
  interaction_type: ConversationInteractionTypeSchema,
  direction: ConversationDirectionSchema,
  subject: z.string().nullable().optional(),
  summary: z.string().min(1),
  body_excerpt: z.string().nullable().optional(),
  email_message_id: z.string().nullable().optional(),
  email_thread_id: z.string().nullable().optional(),
  email_deep_link: z.string().nullable().optional(),
  from_address: z.string().nullable().optional(),
  to_addresses: z.array(z.string()),
  cc_addresses: z.array(z.string()),
  captured_via: ConversationCapturedViaSchema,
  requires_followup: z.boolean(),
  followup_by: z.string().date().nullable().optional(),
  occurred_at: z.string().datetime({ offset: true }),
  created_at: z.string().datetime({ offset: true }),
});
export type Conversation = z.infer<typeof ConversationSchema>;

// Manual-entry create shape. At-least-one association is enforced server-side
// (mirrors the DB CHECK); summary + interaction_type + direction are required.
export const CreateConversationSchema = z.object({
  company_id: z.string().uuid().nullable().optional(),
  person_id: z.string().uuid().nullable().optional(),
  project_id: z.string().uuid().nullable().optional(),
  task_id: z.string().uuid().nullable().optional(),
  interaction_type: ConversationInteractionTypeSchema,
  direction: ConversationDirectionSchema,
  subject: z.string().nullable().optional(),
  summary: z.string().min(1),
  body_excerpt: z.string().nullable().optional(),
  requires_followup: z.boolean().optional(),
  followup_by: z.string().date().nullable().optional(),
  // Datetime or date; the server defaults to now() when omitted.
  occurred_at: z.string().nullable().optional(),
}).refine(
  (v) => Boolean(v.company_id || v.person_id || v.project_id || v.task_id),
  { message: 'A conversation must relate to at least one of company/person/project/task.' },
);

export const UpdateConversationSchema = z.object({
  interaction_type: ConversationInteractionTypeSchema.optional(),
  direction: ConversationDirectionSchema.optional(),
  subject: z.string().nullable().optional(),
  summary: z.string().min(1).optional(),
  body_excerpt: z.string().nullable().optional(),
  company_id: z.string().uuid().nullable().optional(),
  person_id: z.string().uuid().nullable().optional(),
  project_id: z.string().uuid().nullable().optional(),
  task_id: z.string().uuid().nullable().optional(),
  requires_followup: z.boolean().optional(),
  followup_by: z.string().date().nullable().optional(),
  occurred_at: z.string().nullable().optional(),
});
