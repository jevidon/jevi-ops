import { z } from 'zod';

export const ProjectStatusSchema = z.enum(['active', 'paused', 'done', 'archived']);
export const ProjectTypeSchema = z.enum(['client', 'internal', 'content']);

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
});

export const UpdateProjectSchema = CreateProjectSchema.partial().extend({
  status: ProjectStatusSchema.optional(),
  hours_logged: z.number().optional(),
});
