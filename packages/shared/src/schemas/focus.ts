import { z } from 'zod';

// Tomorrow's Focus (Addendum 09) — the one piece of the retired Daily Rule
// that survives, transformed. A single optional pointer per day at a PROJECT
// or CONTENT ITEM: the two container objects on the Work page.
//
// Deliberately absent, permanently: any status, completion, streak, set-rate,
// adherence metric, or notion of a "missed" day. Setting a focus is five
// seconds and optional; nothing anywhere counts whether you did. That guardrail
// is what keeps this from regrowing into the scoring apparatus being retired.

export const FocusTargetTypeSchema = z.enum(['project', 'content_item']);

export const DailyFocusSchema = z.object({
  date: z.string().date(),
  target_type: FocusTargetTypeSchema,
  target_id: z.string().uuid(),
  note: z.string().nullable().optional(),
  created_at: z.string().datetime({ offset: true }),
});

// What the API returns: the row plus the target's resolved title, so the
// consumer renders one line without a second lookup.
export const ResolvedFocusSchema = DailyFocusSchema.extend({
  title: z.string(),
});

// Upsert. `date` defaults to tomorrow (app tz) server-side when omitted —
// "tomorrow's focus" is the common case; voice can say "today's focus" too.
export const SetFocusSchema = z.object({
  date: z.string().date().optional(),
  target_type: FocusTargetTypeSchema,
  target_id: z.string().uuid(),
  note: z.string().trim().max(280).nullable().optional(),
});

export type FocusTargetType = z.infer<typeof FocusTargetTypeSchema>;
export type DailyFocus = z.infer<typeof DailyFocusSchema>;
export type ResolvedFocus = z.infer<typeof ResolvedFocusSchema>;
export type SetFocus = z.infer<typeof SetFocusSchema>;
