import { z } from 'zod';

// Milestones — coarse, weighted, ordered checklist items inside a project.
// They drive the project's "% complete" rollup on /projects and the
// per-project header on /projects/[id]. Status is binary (open/done);
// progress is tracked by checking items off, not by sliding a slider.

export const MilestoneStatusSchema = z.enum(['open', 'done']);

export const MilestoneSchema = z.object({
  id: z.string().uuid(),
  project_id: z.string().uuid(),
  title: z.string().min(1),
  status: MilestoneStatusSchema,
  weight: z.number().int().positive(),
  position: z.number().int(),
  completed_at: z.string().datetime({ offset: true }).nullable().optional(),
  created_at: z.string().datetime({ offset: true }),
});

// project_id is taken from the URL path so it isn't in the body.
export const CreateMilestoneSchema = z.object({
  title: z.string().min(1),
  weight: z.number().int().positive().optional(),
  position: z.number().int().optional(),
});

// Status flips are common (the user just clicked the checkbox). All other
// fields are still optional because the form lets you rename or reweight.
export const UpdateMilestoneSchema = z.object({
  title: z.string().min(1).optional(),
  status: MilestoneStatusSchema.optional(),
  weight: z.number().int().positive().optional(),
  position: z.number().int().optional(),
});

// ─── Project checklist items ─────────────────────────────────────────
//
// Separate from milestones (which roll up into project %) and from tasks
// (which have due dates, reminders, statuses). These are the ad-hoc
// granular TODOs inside a project — same shape as content_checklist_items.

export const ProjectChecklistItemSchema = z.object({
  id: z.string().uuid(),
  project_id: z.string().uuid(),
  position: z.number().int(),
  title: z.string().min(1),
  done: z.boolean(),
  done_at: z.string().datetime({ offset: true }).nullable().optional(),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
});

export const CreateProjectChecklistItemSchema = z.object({
  title: z.string().min(1),
  position: z.number().int().optional(),
});

export const UpdateProjectChecklistItemSchema = z.object({
  title: z.string().min(1).optional(),
  done: z.boolean().optional(),
  position: z.number().int().optional(),
});
