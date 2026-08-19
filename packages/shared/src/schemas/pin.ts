import { z } from 'zod';

// Briefing pins (migration 0044) — durable, manually ordered pointers at any
// of ten entity types, surfaced as the Pinned panel on the homepage. Distinct
// from tasks.top3_for_date (the ephemeral day-pin): a pin stays until unpinned.
//
// The pointer is polymorphic (no FK), so referential integrity is app-side:
// POST verifies the target exists, and GET lazily deletes pins whose target
// has since been deleted.

export const PIN_TARGET_TYPES = [
  'task',
  'project', // includes kind='area'
  'domain',
  'person',
  'company',
  'content_item',
  'book',
  'note',
  'quote',
  'routine',
] as const;

export const PinTargetTypeSchema = z.enum(PIN_TARGET_TYPES);
export type PinTargetType = z.infer<typeof PinTargetTypeSchema>;

export const CreatePinSchema = z.object({
  target_type: PinTargetTypeSchema,
  target_id: z.string().uuid(),
});
export type CreatePin = z.infer<typeof CreatePinSchema>;

// Reorder takes the FULL ordered pin-id list (not a single move): the up/down
// UI computes the next order trivially, and a full list has no ambiguity.
// Pins missing from the list keep their relative order after the listed ones
// (defensive — a stale client must not vanish pins).
export const ReorderPinsSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(100),
});
export type ReorderPins = z.infer<typeof ReorderPinsSchema>;

// ── Resolved pin (GET /api/pins response rows) ────────────────────────────
// Server-resolved display summary: title/subtitle/href are formatted API-side
// (precedent: briefing next_event), plus exactly one per-type payload for
// cards that carry inline actions.

export interface ResolvedPinTask {
  status: string;
  due_date: string | null;
  due_time: string | null;
  priority: number;
  project: { id: string; name: string } | null;
}

export interface ResolvedPin {
  id: string; // pinned_items row id
  target_type: PinTargetType;
  target_id: string;
  position: number;
  title: string; // note/quote: server-truncated excerpt
  subtitle: string | null;
  href: string; // web route to the entity
  /** Urgency hint for the card pill; task-only today ('over' | 'due'). */
  state: 'over' | 'due' | null;
  task?: ResolvedPinTask;
  project?: { kind: string; status: string; color: string | null };
  company?: { relationship_type: string | null; silent_days: number | null };
  content_item?: { type: string; status: string };
  book?: { author: string | null; status: string };
  routine?: { done_today: boolean; active: boolean };
}
