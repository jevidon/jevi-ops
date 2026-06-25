import { z } from 'zod';

// Spec Addendum 02 §3 — quotes lose `my_notes` (replaced by
// quote_annotations) and gain source_reference for non-DB sources.

export const QuoteSourceTypeSchema = z.enum([
  'book',
  'article',
  'podcast',
  'sermon',
  'video',
  'conversation',
  'other',
]);

export const QuoteAddedViaSchema = z.enum([
  'voice',
  'kindle_import',
  'readwise_import',
  'manual',
  'journal_extraction',
]);

export const QuoteSchema = z.object({
  id: z.string().uuid(),
  book_id: z.string().uuid().nullable().optional(),
  text: z.string().min(1),
  page_number: z.union([z.number().int(), z.string()]).nullable().optional(),
  chapter: z.string().nullable().optional(),
  source_type: QuoteSourceTypeSchema.nullable().optional(),
  source_reference: z.string().nullable().optional(),
  source_url: z.string().url().nullable().optional(),
  source_author: z.string().nullable().optional(),
  tags: z.array(z.string()).default([]),
  added_via: QuoteAddedViaSchema.default('manual'),
  last_surfaced_at: z.string().datetime({ offset: true }).nullable().optional(),
  created_at: z.string().datetime({ offset: true }),
});

// Source types and added_via values that the DB CHECK constraint accepts.
// Migration 0029 added 'sermon' + renamed source_ref → source_reference.
// Migration 0030 added 'video' + a source_url column.
const DB_SOURCE_TYPES = ['book', 'article', 'podcast', 'sermon', 'video', 'conversation', 'other'] as const;
const DB_ADDED_VIA = ['voice', 'readwise_import', 'manual', 'journal_extraction'] as const;

export const CreateQuoteSchema = z.object({
  text: z.string().min(1),
  book_id: z.string().uuid().nullable().optional(),
  page_number: z.number().int().nullable().optional(),
  chapter: z.string().nullable().optional(),
  source_type: z.enum(DB_SOURCE_TYPES).nullable().optional(),
  source_reference: z.string().nullable().optional(),
  source_url: z.string().url().nullable().optional(),
  source_author: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
  added_via: z.enum(DB_ADDED_VIA).optional(),
});

export const UpdateQuoteSchema = CreateQuoteSchema.partial().extend({
  resurface_weight: z.number().min(0).optional(),
});

// ─── Quote annotations ──────────────────────────────────────────────────

export const AnnotationContextSchema = z.enum([
  'on_capture',
  'on_revisit',
  'on_surface',
  'unspecified',
]);

export const QuoteAnnotationSchema = z.object({
  id: z.string().uuid(),
  quote_id: z.string().uuid(),
  body: z.string().min(1),
  annotated_at: z.string().datetime({ offset: true }),
  context: AnnotationContextSchema.default('unspecified'),
  tags: z.array(z.string()).default([]),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
});

export const CreateQuoteAnnotationSchema = z.object({
  quote_id: z.string().uuid(),
  body: z.string().min(1),
  context: AnnotationContextSchema.optional(),
  tags: z.array(z.string()).optional(),
});

export const UpdateQuoteAnnotationSchema = z.object({
  body: z.string().min(1).optional(),
  context: AnnotationContextSchema.optional(),
  tags: z.array(z.string()).optional(),
});
