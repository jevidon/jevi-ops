import { emptyState, reapply, taskPatch, type Edit, type Snapshot, type TaskRecord, type ViewState, type WorkspaceAdapter } from './model';
import { createClientId } from '@/lib/client-id';

interface Stored { snapshot: Snapshot | null; edits: Edit[] }
export interface Storage {
  read(): Promise<Stored>;
  update(change: (current: Stored) => Stored): Promise<Stored>;
}
// Read-modify-write is a single IndexedDB transaction, including acknowledgments.
// Quota/write failures abort it and never report a successful save.
export function indexedStorage(account: string): Storage {
  let database: Promise<IDBDatabase> | undefined;
  const open = () => database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('jevi-local-workspace', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('accounts');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  async function transact(change?: (current: Stored) => Stored): Promise<Stored> {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('accounts', change ? 'readwrite' : 'readonly');
      const store = tx.objectStore('accounts');
      const request = store.get(account);
      let result: Stored;
      let failure: unknown;
      request.onsuccess = () => {
        try {
          result = request.result ?? { snapshot: null, edits: [] };
          if (change) { result = change(result); store.put(result, account); }
        } catch (error) { failure = error; tx.abort(); }
      };
      tx.oncomplete = () => resolve(result);
      tx.onabort = tx.onerror = () => reject(failure ?? tx.error ?? new Error('Local storage failed.'));
    });
  }
  return { read: () => transact(), update: change => transact(change) };
}

export class BrowserWorkspace implements WorkspaceAdapter {
  private state: ViewState = emptyState;
  private listeners = new Set<() => void>();
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private stopped = false;
  constructor(private storage: Storage, private account: string, private request = fetch) {}
  getState = () => this.state;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private publish(change: Partial<ViewState>) { this.state = { ...this.state, ...change }; this.listeners.forEach(fn => fn()); }
  private async update(change: (current: Stored) => Stored) { const value = await this.storage.update(change); this.publish(value); return value; }
  private reload = async () => { try { this.publish(await this.storage.read()); } catch (e) { this.publish({ error: String(e) }); } };
  private connected = () => { void this.sync(); };
  async start() {
    this.stopped = false;
    try { this.publish({ ...await this.storage.read(), loaded: true }); }
    catch (e) { this.publish({ loaded: true, error: `Local storage unavailable: ${String(e)}` }); return; }
    window.addEventListener('online', this.connected);
    window.addEventListener('focus', this.reload);
    this.timer = setInterval(this.connected, 60_000);
    void this.sync();
  }
  stop() { this.stopped = true; clearInterval(this.timer); window.removeEventListener('online', this.connected); window.removeEventListener('focus', this.reload); }
  async save(task: TaskRecord, revision: string | null = null) {
    if (!task.title.trim()) throw new Error('Give the task a title.');
    await this.update(current => {
      if (!current.snapshot) throw new Error('Download your workspace first.');
      const existing = current.edits.find(e => e.task.id === task.id);
      if ((existing?.id ?? null) !== revision) throw new Error('A newer edit was saved on this device. Your draft is still here; reopen the task to review it.');
      if (existing?.attempted) throw new Error('This edit is awaiting confirmation or conflict review. Your draft is preserved.');
      const base = existing?.base ?? current.snapshot.tasks.find(t => t.id === task.id);
      if (!base || (existing?.task.updated_at ?? base.updated_at) !== task.updated_at) throw new Error('The task changed while you were editing. Reopen it to review; your draft is still here.');
      const body = taskPatch(base, task, current.snapshot);
      const edit: Edit = { id: createClientId(), base, task, body, attempted: false, blocked: false };
      return { ...current, edits: [...current.edits.filter(e => e.task.id !== task.id), edit] };
    });
    void this.sync();
  }
  async resolve(id: string, choice: 'server' | 'local') {
    await this.update(current => {
      const edit = current.edits.find(e => e.id === id);
      if (!edit?.blocked || !edit.serverTask || !current.snapshot) throw new Error('No server version is available for this operation.');
      const snapshot = { ...current.snapshot, tasks: [...current.snapshot.tasks.filter(t => t.id !== edit.task.id), edit.serverTask] };
      const edits = current.edits.filter(e => e.id !== id);
      if (choice === 'local') {
        const task = reapply(edit);
        edits.push({ id: createClientId(), base: edit.serverTask, task, body: taskPatch(edit.serverTask, task, snapshot), attempted: false, blocked: false });
      }
      return { snapshot, edits };
    });
    void this.sync();
  }
  async review(id: string) {
    const current = await this.storage.read();
    const edit = current.edits.find(e => e.id === id);
    if (!edit?.blocked || !current.snapshot) throw new Error('This operation is still awaiting confirmation.');
    const probe = await this.json('identity');
    if (!probe.response.ok || probe.body.dataSpaceId !== current.snapshot.identity.dataSpaceId || probe.body.serverEpoch !== current.snapshot.identity.serverEpoch) throw new Error('Reconnect to the original server to review this edit.');
    const result = await this.json(`tasks/${edit.task.id}`);
    if (!result.response.ok) throw new Error(result.response.status === 404 ? 'This task was deleted on the server. Your local version is preserved.' : 'Reconnect and sign in to review the latest version.');
    if (result.body.id !== edit.task.id || typeof result.body.updated_at !== 'string') throw new Error('Invalid server version. Your local work is preserved.');
    await this.update(s => ({ ...s, edits: s.edits.map(e => e.id === id ? { ...e, serverTask: result.body } : e) }));
  }
  action(name: string) {
    const routes: Record<string, string> = { agenda: '/', capture: '/inbox', settings: '/settings', captures: '/inbox', online: '/work' };
    if (routes[name]) window.location.assign(routes[name]);
    else if (/^details:\/maintenance\/[0-9a-f-]{36}$/i.test(name)) window.location.assign(name.slice('details:'.length));
  }
  private async json(path: string, init?: RequestInit) {
    const response = await this.request(`/api/local-workspace/${path}`, { ...init, cache: 'no-store', headers: { 'Content-Type': 'application/json', ...init?.headers } });
    if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('Sign in again to synchronize. Saved data is still available.');
    const body = await response.json();
    return { response, body };
  }
  async sync() {
    if (this.running || this.stopped || !navigator.onLine) return;
    // One sender per account across tabs. Keep edits usable if this browser
    // cannot provide the locking primitive; never risk parallel completions.
    if (!navigator.locks) { this.publish({ message: 'This browser cannot safely synchronize local edits. Use a browser with Web Locks support.' }); return; }
    this.running = true;
    this.publish({ syncing: true });
    try {
      await navigator.locks.request(`jevi-workspace:${this.account}`, async () => {
        let current = await this.storage.read();
        if (current.snapshot) {
          const probe = await this.json('identity');
          if (!probe.response.ok) throw new Error('Sign in and reconnect to synchronize.');
          if (probe.body.dataSpaceId !== current.snapshot.identity.dataSpaceId || probe.body.serverEpoch !== current.snapshot.identity.serverEpoch) throw new Error('Server identity changed. Local work is preserved; synchronization is paused.');
          for (const queued of current.edits) {
            if (queued.blocked) continue;
            let frozen: Edit | undefined;
            current = await this.update(s => {
              const latest = s.edits.find(e => e.id === queued.id);
              if (latest) { latest.attempted = true; frozen = structuredClone(latest); }
              return s;
            });
            if (!frozen) continue;
            const identity = current.snapshot!.identity;
            const { response, body } = await this.json(`tasks/${frozen.task.id}`, { method: 'PATCH', headers: {
              'x-operation-id': frozen.id, 'x-task-version': frozen.base.updated_at,
              'x-sync-identity': `${identity.dataSpaceId}:${identity.serverEpoch}`,
            }, body: JSON.stringify(frozen.body) });
            if (response.ok) {
              if (body.id !== frozen.task.id || typeof body.updated_at !== 'string') throw new Error('Invalid acknowledgment; the original operation will be retried.');
              await this.update(s => ({ snapshot: s.snapshot && { ...s.snapshot, tasks: [...s.snapshot.tasks.filter(t => t.id !== body.id), body] }, edits: s.edits.filter(e => e.id !== frozen!.id) }));
            } else if ([401, 403, 429].includes(response.status) || response.status >= 500) {
              throw new Error('Synchronization paused. Pending changes are safe and will retry.');
            } else {
              await this.update(s => ({ ...s, edits: s.edits.map(e => e.id === frozen!.id ? { ...e, blocked: true, serverTask: body.current, detailsPath: typeof body.item_id === 'string' ? `/maintenance/${body.item_id}` : undefined, error: body.message ?? (response.status === 404 ? 'Deleted on the server. Your local version is preserved.' : `Server rejected this edit (${body.error ?? response.status}).`) } : e) }));
            }
          }
        }
        const result = await this.json('snapshot');
        if (!result.response.ok || result.body.protocol_version !== 1 || !Array.isArray(result.body.domains) || !Array.isArray(result.body.projects) || !Array.isArray(result.body.tasks)) throw new Error('The server needs local-workspace support. Saved records remain available.');
        const snapshot: Snapshot = { ...result.body, fetchedAt: new Date().toISOString() };
        if (current.snapshot && (snapshot.identity.dataSpaceId !== current.snapshot.identity.dataSpaceId || snapshot.identity.serverEpoch !== current.snapshot.identity.serverEpoch)) throw new Error('Server identity changed. Local data was preserved.');
        await this.update(s => ({ ...s, snapshot }));
        this.publish({ message: undefined });
      });
    } catch (e) { this.publish({ message: e instanceof Error ? e.message : String(e) }); }
    finally { this.running = false; this.publish({ syncing: false }); }
  }
}
