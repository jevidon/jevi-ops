export interface TaskRecord {
  id: string; title: string; notes?: string | null; status: string; due_date?: string | null;
  priority: number; updated_at: string; domain_id?: string | null; project_id?: string | null;
  workflow_status_id?: string | null;
  domain?: { id: string; name: string }; project?: { id: string; name: string };
}
export interface ContainerRecord { id: string; name: string; description?: string | null; doc_md?: string | null; domain_id?: string | null; kind?: string | null; illustration?: { svg: string } | null }
export interface Scope { id: string; scope: string; revision: number; definition?: { statuses: { id: string; label: string; category: string }[] } | null }
export interface Identity { task_edit_protocol: number; dataSpaceId: string; serverEpoch: number }
export interface Snapshot {
  protocol_version?: number; identity: Identity; fetchedAt?: string; domains: ContainerRecord[];
  projects: ContainerRecord[]; tasks: TaskRecord[]; scopes: Scope[];
}
export interface Edit {
  id: string; base: TaskRecord; task: TaskRecord; attempted: boolean; blocked: boolean;
  error?: string; serverTask?: TaskRecord; body?: Record<string, unknown>; detailsPath?: string;
}
export interface ViewState { snapshot: Snapshot | null; edits: Edit[]; syncing: boolean; message?: string; error?: string; loaded: boolean }
export interface WorkspaceAdapter {
  getState(): ViewState;
  subscribe(listener: () => void): () => void;
  start(): Promise<void>;
  stop(): void;
  save(task: TaskRecord, revision?: string | null): Promise<void>;
  sync(): Promise<void>;
  resolve(id: string, choice: 'server' | 'local'): Promise<void>;
  review(id: string): Promise<void>;
  action(name: string): void;
}
export const emptyState: ViewState = { snapshot: null, edits: [], syncing: false, loaded: false };
export function scopeFor(task: TaskRecord, snapshot: Snapshot) {
  return snapshot.scopes.find(s => s.scope === (task.project_id ? 'project' : 'domain') && s.id === (task.project_id || task.domain_id));
}
export function taskPatch(base: TaskRecord, task: TaskRecord, snapshot: Snapshot): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const key of ['title', 'notes', 'due_date', 'priority'] as const) {
    if ((base[key] ?? null) !== (task[key] ?? null)) patch[key] = task[key] ?? null;
  }
  if (base.workflow_status_id !== task.workflow_status_id && task.workflow_status_id) {
    patch.workflow_status_id = task.workflow_status_id;
    patch.workflow_revision = scopeFor(base, snapshot)?.revision;
  } else if (base.status !== task.status) patch.status = task.status;
  patch._offline_base = Object.fromEntries(['title','notes','due_date','priority','status','workflow_status_id','project_id','domain_id'].map(k => [k, base[k as keyof TaskRecord] ?? null]));
  return patch;
}
export function visibleTasks(state: ViewState): TaskRecord[] {
  const tasks = new Map(state.snapshot?.tasks.map(t => [t.id, t]));
  for (const edit of state.edits) tasks.set(edit.task.id, edit.task);
  return [...tasks.values()];
}
export function reapply(edit: Edit): TaskRecord {
  if (!edit.serverTask) throw new Error('The server version is unavailable. Your local changes are preserved.');
  const task = { ...edit.serverTask };
  for (const key of ['title','notes','due_date','priority','status','workflow_status_id'] as const) {
    if ((edit.base[key] ?? null) !== (edit.task[key] ?? null)) Object.assign(task, { [key]: edit.task[key] ?? null });
  }
  return task;
}
