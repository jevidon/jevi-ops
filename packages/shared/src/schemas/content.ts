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
  'video', 'article', 'short_clip', 'podcast_episode', 'newsletter', 'course',
]);
export type ContentItemType = z.infer<typeof ContentItemTypeSchema>;

// Short-clip distribution platforms (Addendum 07). App-validated; the DB
// column stays a plain text[].
export const CONTENT_PLATFORMS = [
  'yt_shorts', 'ig_reels', 'fb_reels', 'tiktok', 'threads', 'x',
] as const;
export const ContentPlatformSchema = z.enum(CONTENT_PLATFORMS);
export type ContentPlatform = z.infer<typeof ContentPlatformSchema>;

export const CONTENT_PLATFORM_LABELS: Record<ContentPlatform, string> = {
  yt_shorts: 'YouTube Shorts',
  ig_reels: 'Instagram Reels',
  fb_reels: 'Facebook Reels',
  tiktok: 'TikTok',
  threads: 'Threads',
  x: 'X',
};

// Type-specific scalars kept in the `meta` jsonb (Addendum 07) — episode /
// module numbers, guest name, newsletter platform, companion post url.
// Open-ended on purpose; promote a field to a real column only if it later
// needs cross-type filtering.
export const ContentMetaSchema = z.record(z.string(), z.unknown());
export type ContentMeta = z.infer<typeof ContentMetaSchema>;

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
  // Content Manager v2 (Addendum 07).
  meta: ContentMetaSchema.default({}),
  produced_on: z.string().date().nullable().optional(),
  target_publish_date: z.string().date().nullable().optional(),
  canonical_url: z.string().nullable().optional(),
  platforms: z.array(ContentPlatformSchema).nullable().optional(),
  body_rich: z.string().nullable().optional(),
  // Work Page (Addendum 08): holder + idea lifecycle.
  holder: z.enum(['me', 'editor']).default('me'),
  holder_since: z.string().datetime({ offset: true }).nullable().optional(),
  archived_at: z.string().datetime({ offset: true }).nullable().optional(),
  idea_reviewed_at: z.string().datetime({ offset: true }).nullable().optional(),
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
  // Content Manager v2 (Addendum 07).
  meta: ContentMetaSchema.optional(),
  produced_on: z.string().date().nullable().optional(),
  target_publish_date: z.string().date().nullable().optional(),
  canonical_url: z.string().nullable().optional(),
  platforms: z.array(ContentPlatformSchema).nullable().optional(),
  body_rich: z.string().nullable().optional(),
  holder: z.enum(['me', 'editor']).optional(),
  holder_since: z.string().datetime({ offset: true }).nullable().optional(),
  archived_at: z.string().datetime({ offset: true }).nullable().optional(),
  idea_reviewed_at: z.string().datetime({ offset: true }).nullable().optional(),
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
