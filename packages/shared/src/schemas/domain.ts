import { z } from 'zod';

export const FailurePatternSchema = z.object({
  rule: z.string(),
  value: z.unknown().optional(),
}).passthrough();

// Generated engraved illustration for the Domains board (migration 0032).
// Written only by the API's composer/sanitizer pipeline — never accepted
// from clients, which is why it appears on DomainSchema but deliberately
// NOT on UpdateDomainSchema.
export const DomainIllustrationSchema = z.object({
  svg: z.string(),
  style: z.literal('engraved'),
  source: z.enum(['llm', 'procedural']),
  generated_at: z.string(),
});

export const DomainSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  fruit_definition: z.string().nullable().optional(),
  failure_patterns: z.array(FailurePatternSchema).default([]),
  expected_cadence: z.string().nullable().optional(),
  active: z.boolean(),
  // Added by migration 0026. System domains (currently just Inbox) are
  // protected from rename/deactivate and excluded from slippage detection.
  is_system: z.boolean().default(false),
  // Added by migration 0027. Manual "I shipped something" timestamp for
  // domains whose work lives off-dashboard (Substack, social, etc.). The
  // cadence helper's days_since_publish rule reads MAX of this and the
  // latest content_items.published_at.
  last_shipped_at: z.string().datetime({ offset: true }).nullable().optional(),
  // Added by migration 0032. Server-generated engraved spot art for the
  // Domains board; see DomainIllustrationSchema above.
  illustration: DomainIllustrationSchema.nullable().optional(),
  // Added by migration 0033. Candidate render awaiting Keep/Discard on
  // the domain settings page — never shown on the board.
  illustration_draft: DomainIllustrationSchema.nullable().optional(),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
});

// Patch shape used by the UI's edit form. failure_patterns is included so
// the cadence rule editor on the domain detail page can replace the whole
// array atomically (advanced rule types still get edited via SQL; the
// editor only manages the primary cadence rule, but it sends the merged
// final array).
export const UpdateDomainSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  fruit_definition: z.string().nullable().optional(),
  expected_cadence: z.string().nullable().optional(),
  active: z.boolean().optional(),
  failure_patterns: z.array(FailurePatternSchema).optional(),
  // Stamped via the "Mark shipped" button on the domain detail page.
  // Accept ISO datetime or null (to clear).
  last_shipped_at: z.string().datetime({ offset: true }).nullable().optional(),
});
