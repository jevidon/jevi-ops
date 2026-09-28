import React from 'react';
import { createRoot } from 'react-dom/client';
import { Workspace } from '../../web/src/components/local-workspace/Workspace';
import { emptyState, type ViewState, type WorkspaceAdapter, type TaskRecord } from '../../web/src/components/local-workspace/model';

declare global { interface Window { webkit: { messageHandlers: { workspace: { postMessage(message: unknown): Promise<ViewState> } } } } }
class NativeAdapter implements WorkspaceAdapter {
  private state = emptyState;
  private listeners = new Set<() => void>();
  private publish = (state: ViewState) => { this.state = state; this.listeners.forEach(fn => fn()); };
  private changed = (event: Event) => this.publish((event as CustomEvent<ViewState>).detail);
  getState = () => this.state;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  async call(action: string, payload?: unknown) { this.publish(await window.webkit.messageHandlers.workspace.postMessage({ action, payload })); }
  async start() { window.addEventListener('workspace-state', this.changed); try { await this.call('load'); } catch (e) { this.publish({ ...this.state, loaded: true, error: String(e) }); } }
  stop() { window.removeEventListener('workspace-state', this.changed); }
  save = (task: TaskRecord, revision: string | null = null) => this.call('save', { task, revision });
  review = (id: string) => this.call('review', { id });
  sync = () => this.call('sync');
  resolve = (id: string, choice: 'server' | 'local') => this.call('resolve', { id, choice });
  action = (name: string) => { void this.call('action', name).catch(e => this.publish({ ...this.state, error: String(e) })); };
}
document.body.style.margin = '0';
createRoot(document.getElementById('root')!).render(<Workspace adapter={new NativeAdapter()} />);
