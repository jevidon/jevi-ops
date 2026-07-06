import type { ContentItemType, ContentItemStatus } from '@jevi-ops/shared';

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

// ─── Status auto-progression ────────────────────────────────────────
//
// When the user checks off a checklist item with one of these titles, we
// advance content_item.status to the mapped value — but only if it's
// forward in the pipeline. Never regress on a check; never react to
// unchecking. Custom (renamed/added) items aren't in the map, so checking
// them off is purely cosmetic.

// Ordered pipeline. Lower index = earlier stage. Used to gate
// "forward-only" status moves.
const STATUS_ORDER: readonly ContentItemStatus[] = [
  'idea',
  'outline',
  'filming',
  'editing',
  'published',
  'derivatives_pending',
  'done',
] as const;

// Title → target status. Match the literal strings used in the template
// arrays above. If you rename a template entry, mirror it here.
const TITLE_TO_STATUS: Record<string, ContentItemStatus> = {
  // Outline phase
  'Outline': 'outline',
  'Outline / questions': 'outline',
  'Identify clip from long-form': 'outline',
  'First draft': 'outline',
  'Draft': 'outline',

  // Filming / recording
  'Film': 'filming',
  'Record': 'filming',

  // Editing phase (most items here)
  'Rough cut': 'editing',
  'Final edit': 'editing',
  'Edit': 'editing',
  'Thumbnail': 'editing',
  'Title + description': 'editing',
  'Header image': 'editing',
  'Caption / hook': 'editing',
  'Show notes': 'editing',

  // Publish phase
  'Publish': 'published',
  'Send': 'published',

  // Derivatives / promotion
  'Promote (Shorts, socials)': 'derivatives_pending',
  'Share / promote': 'derivatives_pending',
  'Promote': 'derivatives_pending',
};

export function targetStatusForTitle(title: string): ContentItemStatus | null {
  return TITLE_TO_STATUS[title] ?? null;
}

// Returns the more-advanced of two statuses. Used to enforce
// "forward-only" progression — if checking off "Outline" would
// regress a content_item already at 'editing', we keep 'editing'.
export function maxStatus(a: ContentItemStatus, b: ContentItemStatus): ContentItemStatus {
  const ai = STATUS_ORDER.indexOf(a);
  const bi = STATUS_ORDER.indexOf(b);
  if (ai === -1) return b;
  if (bi === -1) return a;
  return ai >= bi ? a : b;
}
