import { z } from 'zod';

// Full base values for editable fields and routing. Sent in the request body,
// not headers (notes can be large). Old clients retain strict version checks.
export const OfflineTaskBase = z.object({
  title: z.string(), notes: z.string().nullable(), due_date: z.string().nullable(),
  priority: z.number().int(), status: z.string(), workflow_status_id: z.string().nullable(),
  project_id: z.string().uuid().nullable(), domain_id: z.string().uuid(),
}).strict();

export function conflictingTaskFields(
  base: z.infer<typeof OfflineTaskBase>, current: Record<string, unknown>, patch: Record<string, unknown>,
): string[] {
  // Moving a record changes workflow semantics. Completions and custom status
  // transitions can cause recurrence/maintenance effects: never auto-rebase.
  if (current.project_id !== base.project_id || current.domain_id !== base.domain_id) return ['location'];
  if ('status' in patch || 'workflow_status_id' in patch) return ['status'];
  return Object.keys(patch).filter(key => {
    if (!['title', 'notes', 'due_date', 'priority'].includes(key)) return true;
    const before = base[key as keyof typeof base];
    return current[key] !== before && current[key] !== patch[key];
  });
}
