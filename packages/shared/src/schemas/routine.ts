import { z } from 'zod';

// Routines = daily habits. The DB layout is simple on purpose: the
// routine row is just metadata + a sort position, and a completion is
// a (routine_id, completed_date) pair. Everything else (current streak,
// longest streak, rate) is derived from the completion log.

export const TimeOfDayBucketSchema = z.enum(['morning', 'afternoon', 'evening', 'anytime']);
export type TimeOfDayBucket = z.infer<typeof TimeOfDayBucketSchema>;

export const TIME_OF_DAY_LABELS: Record<TimeOfDayBucket, string> = {
  morning: 'Morning',
  afternoon: 'Afternoon',
  evening: 'Evening',
  anytime: 'Anytime',
};

// Display + sort order. 'anytime' last because it's the catch-all.
export const TIME_OF_DAY_ORDER: TimeOfDayBucket[] = ['morning', 'afternoon', 'evening', 'anytime'];

// HH:MM (with optional :SS) — what an <input type="time"> emits and what
// the Postgres TIME column accepts. We accept either form on the wire so
// the form doesn't have to pad seconds.
const timeOfDayString = z
  .string()
  .regex(/^\d{2}:\d{2}(?::\d{2})?$/, 'Use HH:MM (24-hour).');

export const RoutineSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  position: z.number().int(),
  active: z.boolean(),
  time_of_day: TimeOfDayBucketSchema.default('anytime'),
  specific_time: z.string().nullable().optional(),
  reminder_enabled: z.boolean().default(false),
  last_reminder_sent_date: z.string().date().nullable().optional(),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
});

export const CreateRoutineSchema = z.object({
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  position: z.number().int().optional(),
  time_of_day: TimeOfDayBucketSchema.optional(),
  specific_time: timeOfDayString.nullable().optional(),
  reminder_enabled: z.boolean().optional(),
});

export const UpdateRoutineSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  position: z.number().int().optional(),
  active: z.boolean().optional(),
  time_of_day: TimeOfDayBucketSchema.optional(),
  specific_time: timeOfDayString.nullable().optional(),
  reminder_enabled: z.boolean().optional(),
});

export const RoutineCompletionSchema = z.object({
  id: z.string().uuid(),
  routine_id: z.string().uuid(),
  completed_date: z.string().date(),
  created_at: z.string().datetime({ offset: true }),
});

// Toggle endpoint payload: pass a date to mark done; omit to default
// to "today" on the server. The server reads the request-time clock so
// the client doesn't have to guess what the server thinks today is.
export const ToggleCompletionSchema = z.object({
  date: z.string().date().optional(),
  // explicit done=false to delete; default true.
  done: z.boolean().optional(),
});
