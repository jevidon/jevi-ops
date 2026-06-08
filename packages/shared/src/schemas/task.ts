import { z } from 'zod';

export const TaskStatusSchema = z.enum(['open', 'done']);
export const TaskSourceSchema = z.enum(['manual', 'voice', 'email', 'observation', 'import']);

// Fields that can be explicitly cleared in updates need .nullable() —
// .optional() alone only accepts undefined (omit the field). Sending null
// clears it server-side.
const nullableString = () => z.string().nullable().optional();
const nullableDate = () => z.string().date().nullable().optional();

export const TaskSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1),
  notes: nullableString(),
  status: TaskStatusSchema,
  due_date: nullableDate(),
  due_time: nullableString(),
  priority: z.number().int().min(1).max(4),
  project_id: z.string().uuid().nullable().optional(),
  domain_id: z.string().uuid(),
  content_item_id: z.string().uuid().nullable().optional(),
  parent_task_id: z.string().uuid().nullable().optional(),
  recurrence_rule: nullableString(),
  reminder_offsets: z.array(z.number()).default([]),
  source: TaskSourceSchema,
  top3_for_date: nullableDate(),
  created_at: z.string().datetime({ offset: true }),
  completed_at: z.string().datetime({ offset: true }).nullable().optional(),
  updated_at: z.string().datetime({ offset: true }),
  // Optional joins — present when API returns linked entity metadata.
  project: z.object({
    id: z.string().uuid(),
    name: z.string(),
    color: z.string().nullable().optional(),
  }).nullable().optional(),
  content_item: z.object({
    id: z.string().uuid(),
    title: z.string(),
    type: z.string(),
    status: z.string(),
  }).nullable().optional(),
});

export const CreateTaskSchema = z.object({
  title: z.string().min(1),
  notes: nullableString(),
  due_date: nullableDate(),
  due_time: nullableString(),
  priority: z.number().int().min(1).max(4).default(4),
  project_id: z.string().uuid().nullable().optional(),
  // domain_id is optional at the schema level so frictionless capture works
  // (no domain picked → server defaults to Inbox). When project_id is set,
  // the server overwrites domain_id with the project's domain. When both
  // are passed explicitly and mismatched, the server returns 400.
  domain_id: z.string().uuid().nullable().optional(),
  content_item_id: z.string().uuid().nullable().optional(),
  parent_task_id: z.string().uuid().nullable().optional(),
  recurrence_rule: nullableString(),
  reminder_offsets: z.array(z.number()).optional(),
  source: TaskSourceSchema.default('manual'),
  top3_for_date: nullableDate(),
});

export const UpdateTaskSchema = CreateTaskSchema.partial().extend({
  status: TaskStatusSchema.optional(),
});
