import type { ContentItemType } from '@jerad-ops/shared';

// Default checklist items per content type. Inserted alongside a fresh
// content_items row so the user lands on a populated workflow. Items are
// ordered — the array index becomes the `position` column.
//
// Keep the lists tight: every item should be a real step you'd actually
// check off. If "Edit" is too vague, split into "Rough cut" + "Final cut".
// Better to ship a working baseline and tune from there.

export const CONTENT_CHECKLIST_TEMPLATES: Record<ContentItemType, readonly string[]> = {
  video: [
    'Outline',
    'Film',
    'Rough cut',
    'Final edit',
    'Thumbnail',
    'Title + description',
    'Publish',
    'Promote (Shorts, socials)',
  ],
  article: [
    'Outline',
    'First draft',
    'Edit',
    'Header image',
    'Publish',
    'Share / promote',
  ],
  short_clip: [
    'Identify clip from long-form',
    'Edit',
    'Caption / hook',
    'Publish',
  ],
  podcast_episode: [
    'Outline / questions',
    'Record',
    'Edit',
    'Show notes',
    'Publish',
    'Promote',
  ],
  newsletter: [
    'Draft',
    'Edit',
    'Header image',
    'Send',
  ],
};

export function defaultChecklistItemsFor(type: ContentItemType): string[] {
  return [...(CONTENT_CHECKLIST_TEMPLATES[type] ?? CONTENT_CHECKLIST_TEMPLATES.video)];
}
