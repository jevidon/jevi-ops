import { z } from 'zod';

// Spec Addendum 02 §3 — notes use a finer-grained source_type instead of
// the old `type` enum. The type field has been removed entirely.

export const NoteSourceTypeSchema = z.enum([
  'own_thought',
  'reading_response',
  'meeting_note',
  'brainstorm',
  'observation',
  'other',
]);

export const NoteSchema = z.object({
  id: z.string().uuid(),
  body: z.string().min(1),
  source_type: NoteSourceTypeSchema,
  source_reference: z.string().nullable().optional(),
  tags: z.array(z.string()).default([]),
  related_project_id: z.string().uuid().nullable().optional(),
  related_person_id: z.string().uuid().nullable().optional(),
  related_quote_id: z.string().uuid().nullable().optional(),
  needs_review: z.boolean().default(false),
  created_at: z.string().datetime({ offset: true }),
});

export const CreateNoteSchema = z.object({
  body: z.string().min(1),
  source_type: NoteSourceTypeSchema.default('own_thought'),
  source_reference: z.string().optional(),
  tags: z.array(z.string()).optional(),
  related_project_id: z.string().uuid().optional(),
  related_person_id: z.string().uuid().optional(),
  related_quote_id: z.string().uuid().optional(),
  needs_review: z.boolean().optional(),
});

export const UpdateNoteSchema = CreateNoteSchema.partial();
