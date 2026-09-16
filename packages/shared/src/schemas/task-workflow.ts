import { z } from 'zod';

export const WorkflowStatusSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
  label: z.string().trim().min(1).max(60),
  category: z.enum(['open', 'waiting', 'done']),
});
export const TaskWorkflowSchema = z.object({
  statuses: z.array(WorkflowStatusSchema).min(2).max(20),
}).superRefine(({ statuses }, ctx) => {
  if (new Set(statuses.map(s => s.id)).size !== statuses.length) ctx.addIssue({ code: 'custom', message: 'Status IDs must be unique.' });
  if (new Set(statuses.map(s => s.label.toLowerCase())).size !== statuses.length) ctx.addIssue({ code: 'custom', message: 'Status names must be unique.' });
  if (!statuses.some(s => s.category === 'open')) ctx.addIssue({ code: 'custom', message: 'Include an actionable status for new and reopened tasks.' });
});
export type TaskWorkflow = z.infer<typeof TaskWorkflowSchema>;
export type WorkflowStatus = z.infer<typeof WorkflowStatusSchema>;
export type WorkflowScope = 'project' | 'domain';
export type WorkflowConfig = { id: string; scope: WorkflowScope; definition: TaskWorkflow | null; revision: number };
export type WorkflowPreset = { id: string; name: string; definition: TaskWorkflow };
export type WorkflowRegistry = { scopes: WorkflowConfig[]; presets: WorkflowPreset[] };
export const ConfigureTaskWorkflowSchema = z.object({
  definition: TaskWorkflowSchema.nullable(),
  expected_revision: z.number().int().min(0),
});
export const CreateWorkflowPresetSchema = z.object({
  name: z.string().trim().min(1).max(80),
  definition: TaskWorkflowSchema,
});

/** A project/area opts in independently. Domain workflows cover direct tasks only. */
export function workflowForTask(task: { project_id?: string | null; domain_id: string }, registry: WorkflowRegistry): WorkflowConfig | undefined {
  const scope = task.project_id ? 'project' : 'domain';
  const id = task.project_id || task.domain_id;
  return registry.scopes.find(s => s.scope === scope && s.id === id && s.definition);
}
export function effectiveWorkflowStatus(task: { status: string; workflow_status_id?: string | null }, definition: TaskWorkflow): WorkflowStatus | undefined {
  return definition.statuses.find(s => s.id === task.workflow_status_id && s.category === task.status)
    ?? definition.statuses.find(s => s.category === task.status);
}
export const BUILTIN_WORKFLOW_PRESETS: WorkflowPreset[] = [
  { id: 'groceries', name: 'Groceries', definition: { statuses: [
    { id: 'need', label: 'Need to buy', category: 'open' },
    { id: 'enough', label: 'Have enough', category: 'done' },
  ] } },
  { id: 'kit', name: 'Kit readiness', definition: { statuses: [
    { id: 'buy', label: 'Need to buy', category: 'open' },
    { id: 'pack', label: 'Need to pack', category: 'open' },
    { id: 'packed', label: 'Packed', category: 'done' },
  ] } },
];
