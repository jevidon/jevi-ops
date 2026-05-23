import { z } from 'zod';

// Routines = daily habits. The DB layout is simple on purpose: the
// routine row is just metadata + a sort position, and a completion is
// a (routine_id, completed_date) pair. Everything else (current streak,
// longest streak, rate) is derived from the completion log.

export const RoutineSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  position: z.number().int(),
  active: z.boolean(),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
});

export const CreateRoutineSchema = z.object({
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  position: z.number().int().optional(),
});

export const UpdateRoutineSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  position: z.number().int().optional(),
  active: z.boolean().optional(),
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
