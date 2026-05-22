import { z } from 'zod';

export const ProjectStatusSchema = z.enum(['active', 'paused', 'done', 'archived']);
export const ProjectTypeSchema = z.enum(['client', 'internal', 'content']);

// Curated palette. Picked to read well on the warm linen background
// (#F6F2EA). Keep this list short — paradox of choice — and stable so
// every project picker shows the same swatches in the same order.
export const PROJECT_COLOR_PALETTE = [
  '#B8442B', // rust (matches our accent)
  '#3F5B47', // pine
  '#3A4663', // indigo
  '#C9A063', // ochre
  '#7A2E36', // burgundy
  '#3F6968', // teal
  '#7A6A8E', // lavender
  '#7A726B', // stone
] as const;

const HexColorSchema = z.string().regex(/^#[0-9A-Fa-f]{6}$/);

export const ProjectSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  domain_id: z.string().uuid().nullable().optional(),
  status: ProjectStatusSchema,
  type: ProjectTypeSchema.nullable().optional(),
  client_id: z.string().uuid().nullable().optional(),
  quoted_hours: z.number().nullable().optional(),
  hours_logged: z.number(),
  start_date: z.string().date().nullable().optional(),
  target_date: z.string().date().nullable().optional(),
  color: HexColorSchema.nullable().optional(),
  completed_at: z.string().datetime({ offset: true }).nullable().optional(),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
});

export const CreateProjectSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  domain_id: z.string().uuid().optional(),
  type: ProjectTypeSchema.optional(),
  client_id: z.string().uuid().optional(),
  quoted_hours: z.number().optional(),
  start_date: z.string().date().optional(),
  target_date: z.string().date().optional(),
  color: HexColorSchema.nullable().optional(),
});

export const UpdateProjectSchema = CreateProjectSchema.partial().extend({
  status: ProjectStatusSchema.optional(),
  hours_logged: z.number().optional(),
});
