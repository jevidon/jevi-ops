import { z } from 'zod';

export const TaskTemplateEntrySchema = z.object({
  key: z.string().uuid(),
  title: z.string().trim().min(1).max(500),
  notes: z.string().max(200_000).nullable().default(null),
  parent_key: z.string().uuid().nullable().default(null),
}).strict();
export type TaskTemplateEntry = z.infer<typeof TaskTemplateEntrySchema>;

const EntriesSchema = z.array(TaskTemplateEntrySchema).min(1).max(200).superRefine((entries, ctx) => {
  const byKey = new Map(entries.map(entry => [entry.key, entry]));
  if (byKey.size !== entries.length) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Task keys must be unique.' });
  for (const entry of entries) {
    const visited = new Set([entry.key]);
    let parent = entry.parent_key;
    while (parent) {
      if (!byKey.has(parent) || visited.has(parent)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Each parent must be a task in this template, with no circular relationships.' });
        break;
      }
      visited.add(parent);
      parent = byKey.get(parent)!.parent_key;
    }
  }
});

export const TaskTemplateInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  entries: EntriesSchema,
}).strict();

export const UpdateTaskTemplateSchema = TaskTemplateInputSchema.extend({
  expected_revision: z.number().int().positive(),
});

export const ProjectFromTemplateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  domain_id: z.string().uuid().nullable().optional(),
}).strict();

export interface TaskTemplate {
  id: string;
  name: string;
  entries: TaskTemplateEntry[];
  revision: number;
  created_at: string;
  updated_at: string;
}
