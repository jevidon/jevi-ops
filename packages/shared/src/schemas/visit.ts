import { z } from 'zod';
import { AttachmentSchema } from './note.js';

// Service visits (0051) — wire shapes for /api/assets/:id/visits and
// /api/visits/:id. One visit is one event: several items done on ONE
// odometer (a single reading every line links to) with ONE invoice. A
// `planned` visit is a saved work order (the "plan together" batch); a
// `done` visit is the record. The visit's `total` is the invoice; each
// line's `cost` is the allocated part of it — kept distinct on purpose.

const nullableString = () => z.string().nullable().optional();
const nullableDate = () => z.string().date().nullable().optional();
const nullableNonNeg = () => z.number().nonnegative().nullable().optional();

export const VisitStatusSchema = z.enum(['planned', 'done']);
export type VisitStatus = z.infer<typeof VisitStatusSchema>;

// One line of a completed visit. Policy evidence is per line, exactly as
// on a single completion (missingCompletionFields): an expiry renewal at
// the visit still needs its new expiry.
export const VisitLineInputSchema = z.object({
  item_id: z.string().uuid(),
  // A planned line the workshop did not get to: stays due, task stays open.
  // The line is kept on the visit with outcome 'skipped' and the reason.
  skipped: z.boolean().optional(),
  skip_reason: nullableString(),
  cost: nullableNonNeg(),
  notes: nullableString(),
  issued_until: nullableDate(),
  purchased_to: nullableNonNeg(),
  finding: nullableString(),
  next_review_on: nullableDate(),
  next_review_meter: nullableNonNeg(),
});
export type VisitLineInput = z.infer<typeof VisitLineInputSchema>;

const visitFacts = {
  provider: nullableString(),
  invoice_number: nullableString(),
  // ISO 4217; null = unspecified.
  currency: z.string().trim().length(3).toUpperCase().nullable().optional(),
  total: nullableNonNeg(),
  notes: nullableString(),
  attachments: z.array(AttachmentSchema).optional(),
};

// A work order: what to do, for whom, roughly when.
export const CreatePlannedVisitSchema = z.object({
  status: z.literal('planned'),
  planned_on: nullableDate(),
  provider: nullableString(),
  notes: nullableString(),
  items: z
    .array(z.object({ item_id: z.string().uuid(), notes: nullableString() }))
    .min(1),
});

// The record of a visit that happened — used both to log a visit outright
// (POST …/visits with status 'done') and to complete a planned one (POST
// /api/visits/:id/complete, where `lines` defaults to the plan).
export const CompleteVisitSchema = z.object({
  // Omit → today in app tz. Never in the future.
  visited_on: z.string().date().optional(),
  // The odometer at the visit — one reading, linked from every line.
  meter: nullableNonNeg(),
  allow_decrease: z.boolean().optional(),
  ...visitFacts,
  // Idempotency + provenance (0048 conventions).
  event_key: z.string().min(1).max(200).optional(),
  run_id: z.string().max(200).optional(),
  source: z.enum(['agent', 'import']).optional(),
  lines: z.array(VisitLineInputSchema).min(1),
});

export const CreateDoneVisitSchema = CompleteVisitSchema.extend({ status: z.literal('done') });

export const CreateVisitSchema = z.discriminatedUnion('status', [CreatePlannedVisitSchema, CreateDoneVisitSchema]);

// Edits. On a planned visit: the plan. On a done visit: the facts, and the
// evidence — moving `visited_on` or `meter` moves the visit's reading and
// every line's log with it, and re-derives the affected schedules.
export const UpdateVisitSchema = z.object({
  planned_on: nullableDate(),
  items: z.array(z.object({ item_id: z.string().uuid(), notes: nullableString() })).optional(),
  visited_on: z.string().date().optional(),
  meter: nullableNonNeg(),
  allow_decrease: z.boolean().optional(),
  ...visitFacts,
});

export const VisitSchema = z.object({
  id: z.string().uuid(),
  asset_id: z.string().uuid(),
  status: VisitStatusSchema,
  planned_on: nullableDate(),
  visited_on: nullableDate(),
  meter: nullableNonNeg(),
  reading_id: z.string().uuid().nullable().optional(),
  provider: nullableString(),
  invoice_number: nullableString(),
  currency: nullableString(),
  total: nullableNonNeg(),
  notes: nullableString(),
  attachments: z.array(AttachmentSchema).default([]),
  event_key: nullableString(),
  actor: nullableString(),
  run_id: nullableString(),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
});
export type Visit = z.infer<typeof VisitSchema>;
