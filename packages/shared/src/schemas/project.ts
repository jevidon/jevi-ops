import { z } from 'zod';

export const ProjectStatusSchema = z.enum(['active', 'paused', 'done', 'archived']);
export const ProjectTypeSchema = z.enum(['client', 'internal', 'content']);
export const EngagementTypeSchema = z.enum(['project', 'retainer']);
export type EngagementType = z.infer<typeof EngagementTypeSchema>;
// kind: 'project' (finite, has an outcome) vs 'area' (ongoing context like
// Home, Garage, Health). Orthogonal to engagement_type — a 'project' kind
// can still be a retainer, and areas are always 'project' engagement_type
// since they have no client.
export const ProjectKindSchema = z.enum(['project', 'area']);
export type ProjectKind = z.infer<typeof ProjectKindSchema>;

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
  engagement_type: EngagementTypeSchema.default('project'),
  kind: ProjectKindSchema.default('project'),
  completed_at: z.string().datetime({ offset: true }).nullable().optional(),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
});

// All optional fields are .nullable() so the client can explicitly clear
// them via PATCH (or send null on create to mean "leave empty"). Without
// nullable, sending null would fail Zod validation and force the action
// to branch per-field on "omit vs include" — a footgun.
export const CreateProjectSchema = z.object({
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  domain_id: z.string().uuid().nullable().optional(),
  type: ProjectTypeSchema.nullable().optional(),
  client_id: z.string().uuid().nullable().optional(),
  quoted_hours: z.number().nullable().optional(),
  start_date: z.string().date().nullable().optional(),
  target_date: z.string().date().nullable().optional(),
  color: HexColorSchema.nullable().optional(),
  engagement_type: EngagementTypeSchema.optional(),
  kind: ProjectKindSchema.optional(),
});

export const UpdateProjectSchema = CreateProjectSchema.partial().extend({
  status: ProjectStatusSchema.optional(),
  hours_logged: z.number().optional(),
});
