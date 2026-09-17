'use client';
import { createContext, useContext, useState, useTransition, type ReactNode } from 'react';
import Link from 'next/link';
import { effectiveWorkflowStatus, workflowForTask, type Task, type WorkflowRegistry } from '@jevi-ops/shared';
import { changeWorkflowStatus } from './actions';

const Context = createContext<WorkflowRegistry>({ scopes: [], presets: [] });
export function TaskWorkflowsProvider({ registry, children }: { registry: WorkflowRegistry; children: ReactNode }) {
  return <Context.Provider value={registry}>{children}</Context.Provider>;
}
export function useTaskWorkflows() { return useContext(Context); }
type StatusTask = Pick<Task, 'id' | 'domain_id' | 'project_id' | 'workflow_status_id'> & { status: string };
export function TaskStatusControl({ task, children }: { task: StatusTask; children?: ReactNode }) {
  const registry = useTaskWorkflows();
  const config = workflowForTask(task, registry);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ error?: string; detailsHref?: string }>({});
  if (!config?.definition) return <>{children}</>;
  const selected = effectiveWorkflowStatus(task, config.definition);
  return <div className="shrink-0 max-w-[180px]">
    <select aria-label="Task status" value={selected?.id ?? ''} disabled={pending}
      className="max-w-full rounded border border-line bg-surface px-2 py-1 text-[12px] text-ink disabled:opacity-60"
      onChange={e => { const id = e.target.value; startTransition(async () => { setResult({}); setResult(await changeWorkflowStatus(task.id, id, config.revision)); }); }}>
      {!selected && <option value="" disabled>{task.status === 'waiting' ? 'Waiting' : task.status === 'done' ? 'Done' : 'Open'}</option>}
      {config.definition.statuses.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
    </select>
    {pending && <span className="sr-only" role="status">Saving status</span>}
    {result.error && <p role="alert" className="mt-1 text-[12px] text-accent">{result.error} {result.detailsHref && <Link href={result.detailsHref} className="underline">Enter details</Link>}</p>}
  </div>;
}
export function TaskStatusLabel({ task, children }: { task: StatusTask; children?: ReactNode }) {
  const config = workflowForTask(task, useTaskWorkflows());
  return <>{config?.definition ? effectiveWorkflowStatus(task, config.definition)?.label ?? task.status : children ?? task.status}</>;
}
