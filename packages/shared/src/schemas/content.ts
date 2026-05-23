import { z } from 'zod';

// Content items — videos, articles, podcast episodes, etc. The lifecycle
// runs idea → outline → filming → editing → published → derivatives_pending
// → done. Migration 0008 moved the old `channel` enum to a `domain_id` FK
// against stewardship_domains.

export const ContentItemStatusSchema = z.enum([
  'idea', 'outline', 'filming', 'editing', 'published', 'derivatives_pending', 'done',
]);
export type ContentItemStatus = z.infer<typeof ContentItemStatusSchema>;

export const ContentItemTypeSchema = z.enum([
  'video', 'article', 'short_clip', 'podcast_episode', 'newsletter',
]);
export type ContentItemType = z.infer<typeof ContentItemTypeSchema>;

export const ContentItemSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1),
  domain_id: z.string().uuid().nullable().optional(),
  type: ContentItemTypeSchema,
  status: ContentItemStatusSchema,
  outline_md: z.string().nullable().optional(),
  video_url: z.string().nullable().optional(),
  article_url: z.string().nullable().optional(),
  published_at: z.string().datetime({ offset: true }).nullable().optional(),
  parent_id: z.string().uuid().nullable().optional(),
  derivative_type: z.string().nullable().optional(),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
});

// Create — title + type are practically required. Status defaults to 'idea'
// in DB. Domain is optional but the UI strongly nudges toward picking one.
export const CreateContentItemSchema = z.object({
  title: z.string().min(1),
  domain_id: z.string().uuid().nullable().optional(),
  type: ContentItemTypeSchema.default('video'),
  status: ContentItemStatusSchema.optional(),
  outline_md: z.string().nullable().optional(),
  video_url: z.string().nullable().optional(),
  article_url: z.string().nullable().optional(),
  published_at: z.string().nullable().optional(), // ISO date or datetime; DB column is timestamptz
  parent_id: z.string().uuid().nullable().optional(),
  derivative_type: z.string().nullable().optional(),
});

export const UpdateContentItemSchema = CreateContentItemSchema.partial();

// ─── Checklist items (one per content_item per step) ─────────────────

export const ContentChecklistItemSchema = z.object({
  id: z.string().uuid(),
  content_item_id: z.string().uuid(),
  position: z.number().int(),
  title: z.string().min(1),
  done: z.boolean(),
  done_at: z.string().datetime({ offset: true }).nullable().optional(),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
});

export const CreateContentChecklistItemSchema = z.object({
  title: z.string().min(1),
  position: z.number().int().optional(),
});

export const UpdateContentChecklistItemSchema = z.object({
  title: z.string().min(1).optional(),
  done: z.boolean().optional(),
  position: z.number().int().optional(),
});
