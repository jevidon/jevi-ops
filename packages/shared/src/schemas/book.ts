import { z } from 'zod';

// Books — reading log + highlights container. The schema mirrors the 0001
// SQL table; status/format strings match the DB CHECK constraints.

export const BookStatusSchema = z.enum([
  'reading', 'finished', 'abandoned', 'want_to_read',
]);
export type BookStatus = z.infer<typeof BookStatusSchema>;

export const BookFormatSchema = z.enum([
  'physical', 'kindle', 'audiobook',
]);
export type BookFormat = z.infer<typeof BookFormatSchema>;

export const BookSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1),
  author: z.string().nullable().optional(),
  isbn: z.string().nullable().optional(),
  cover_image_url: z.string().url().nullable().optional(),
  status: BookStatusSchema,
  format: BookFormatSchema.nullable().optional(),
  started_at: z.string().nullable().optional(),   // YYYY-MM-DD
  finished_at: z.string().nullable().optional(),
  rating: z.number().int().min(1).max(5).nullable().optional(),
  my_summary: z.string().nullable().optional(),
  created_at: z.string().datetime({ offset: true }),
});

// Create payload — title required; everything else gets sensible defaults.
export const CreateBookSchema = z.object({
  title: z.string().min(1),
  author: z.string().nullable().optional(),
  isbn: z.string().nullable().optional(),
  cover_image_url: z.string().url().nullable().optional(),
  status: BookStatusSchema.optional(),    // defaults to want_to_read in DB
  format: BookFormatSchema.nullable().optional(),
  started_at: z.string().nullable().optional(),
  finished_at: z.string().nullable().optional(),
  rating: z.number().int().min(1).max(5).nullable().optional(),
  my_summary: z.string().nullable().optional(),
});

export const UpdateBookSchema = CreateBookSchema.partial();
