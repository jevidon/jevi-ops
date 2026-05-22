import { z } from 'zod';

export const NoteTypeSchema = z.enum(['note', 'quote', 'idea', 'personal_log']);

export const NoteSchema = z.object({
  id: z.string().uuid(),
  type: NoteTypeSchema,
  body: z.string().min(1),
  tags: z.array(z.string()).default([]),
  related_project_id: z.string().uuid().nullable().optional(),
  related_person_id: z.string().uuid().nullable().optional(),
  created_at: z.string().datetime({ offset: true }),
});

export const CreateNoteSchema = z.object({
  type: NoteTypeSchema.default('note'),
  body: z.string().min(1),
  tags: z.array(z.string()).optional(),
  related_project_id: z.string().uuid().optional(),
  related_person_id: z.string().uuid().optional(),
});
