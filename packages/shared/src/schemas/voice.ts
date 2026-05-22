import { z } from 'zod';

// The Claude-API voice parser returns an array of these. One utterance can
// produce multiple actions (e.g. complete a task AND log activity AND create
// a calendar event). Schemas here mirror the action types listed in spec §14.

const FuzzyMatchSchema = z.string().min(1); // "the Reviews plugin", "Randy"

export const VoiceActionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('create_task'),
    title: z.string().min(1),
    due_date: z.string().date().optional(),
    due_time: z.string().optional(),
    priority: z.number().int().min(1).max(4).optional(),
    project_match: FuzzyMatchSchema.optional(),
    parent_task_match: FuzzyMatchSchema.optional(),
    reminder_offsets: z.array(z.number()).optional(),
  }),
  z.object({
    action: z.literal('complete_task'),
    task_match: FuzzyMatchSchema,
  }),
  z.object({
    action: z.literal('create_project'),
    name: z.string().min(1),
    domain_match: FuzzyMatchSchema.optional(),
    target_date: z.string().date().optional(),
  }),
  z.object({
    action: z.literal('update_project_status'),
    project_match: FuzzyMatchSchema,
    status: z.enum(['active', 'paused', 'done', 'archived']),
  }),
  z.object({
    action: z.literal('log_activity'),
    project_match: FuzzyMatchSchema,
    entry: z.string().min(1),
    hours_logged: z.number().nonnegative().optional(),
  }),
  z.object({
    action: z.literal('update_milestone'),
    project_match: FuzzyMatchSchema,
    milestone_match: FuzzyMatchSchema,
    progress_pct: z.number().min(0).max(100).optional(),
    status: z.enum(['open', 'done']).optional(),
  }),
  z.object({
    action: z.literal('create_calendar_event'),
    title: z.string().min(1),
    start: z.string().datetime({ offset: true }),
    end: z.string().datetime({ offset: true }),
    location: z.string().optional(),
    attendees: z.array(z.string()).optional(),
  }),
  z.object({
    action: z.literal('create_note'),
    body: z.string().min(1),
    // Addendum 02 — finer-grained source_type replaces the old `type` enum.
    source_type: z.enum([
      'own_thought', 'reading_response', 'meeting_note',
      'brainstorm', 'observation', 'other',
    ]).optional(),
    source_reference: z.string().optional(),
    tags: z.array(z.string()).optional(),
    project_match: FuzzyMatchSchema.optional(),
    person_match: FuzzyMatchSchema.optional(),
    quote_match: FuzzyMatchSchema.optional(),  // when the note is about a quote but isn't itself an annotation
    needs_review: z.boolean().optional(),
  }),
  z.object({
    action: z.literal('create_quote'),
    text: z.string().min(1),
    book_match: FuzzyMatchSchema.optional(),
    page_number: z.number().int().positive().optional(),
    chapter: z.string().optional(),
    source_type: z.enum(['book', 'article', 'podcast', 'conversation', 'sermon', 'other']).optional(),
    source_reference: z.string().optional(),
    source_author: z.string().optional(),
    tags: z.array(z.string()).optional(),
    // Addendum 02 §4 — if the user bundles a thought with the quote in the
    // same utterance, the parser includes annotation_body here and the
    // executor creates both the quote AND an annotation with context='on_capture'.
    annotation_body: z.string().optional(),
  }),
  z.object({
    // Addendum 02 §4 — adding a thought to an existing quote.
    action: z.literal('create_quote_annotation'),
    quote_match: FuzzyMatchSchema,
    body: z.string().min(1),
    context: z.enum(['on_capture', 'on_revisit', 'on_surface', 'unspecified']).optional(),
    tags: z.array(z.string()).optional(),
  }),
  z.object({
    action: z.literal('create_journal_entry'),
    text: z.string().min(1),
    date: z.string().date().optional(),
  }),
  z.object({
    action: z.literal('create_person_fact'),
    person_match: FuzzyMatchSchema,
    fact_type: z.enum(['anniversary', 'birthday', 'kid_name', 'shared', 'follow_up', 'other']),
    fact_value: z.string().min(1),
    date_relevant: z.string().date().optional(),
    recurring: z.boolean().optional(),
  }),
  z.object({
    action: z.literal('update_content_item'),
    item_match: FuzzyMatchSchema,
    status: z.enum([
      'idea', 'outline', 'filming', 'editing', 'published',
      'derivatives_pending', 'done',
    ]).optional(),
    video_url: z.string().url().optional(),
    outline_md: z.string().optional(),
  }),
  z.object({
    action: z.literal('add_inventory_item'),
    category: z.string().min(1),
    brand: z.string().optional(),
    model: z.string().optional(),
    serial: z.string().optional(),
    purchase_date: z.string().date().optional(),
    purchase_price: z.number().optional(),
  }),
]);

// What the parser returns. Either an array of actions, an error, or a
// disambiguation request.
export const ParsedActionSchema = z.union([
  z.array(VoiceActionSchema),
  z.object({
    needs_disambiguation: z.literal(true),
    field: z.string(),
    candidates: z.array(z.object({
      id: z.string(),
      label: z.string(),
    })),
  }),
  z.object({
    error: z.string(),
    transcript: z.string(),
  }),
]);

export const VoiceCaptureRequestSchema = z.object({
  transcript: z.string().min(1),
  // Optional: what the client believes the current local time is. Server
  // falls back to its own clock if absent.
  client_time: z.string().datetime({ offset: true }).optional(),
});
