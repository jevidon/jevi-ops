'use client';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { emptyState, scopeFor, visibleTasks, type TaskRecord, type Snapshot, type WorkspaceAdapter, type Edit } from './model';
import './workspace.css';

export function Workspace({ adapter }: { adapter: WorkspaceAdapter }) {
  const state = useSyncExternalStore(adapter.subscribe, adapter.getState, () => emptyState);
  const [domain, setDomain] = useState<string | null>(null);
  const [project, setProject] = useState<string | null>(null);
  const [taskID, setTaskID] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState(false);
  const [more, setMore] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [leaving, setLeaving] = useState<(() => void) | null>(null);
  useEffect(() => { void adapter.start(); return () => adapter.stop(); }, [adapter]);
  useEffect(() => {
    const leave = (e: BeforeUnloadEvent) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', leave); return () => window.removeEventListener('beforeunload', leave);
  }, [dirty]);
  const navigate = (action: () => void) => { if (dirty) setLeaving(() => action); else action(); };
  const reset = () => { setDomain(null); setProject(null); setTaskID(null); setMore(false); setQuery(''); setSearch(false); };
  const snapshot = state.snapshot;
  const tasks = visibleTasks(state);
  const task = tasks.find(t => t.id === taskID);
  const selectedDomain = snapshot?.domains.find(d => d.id === domain);
  const selectedProject = snapshot?.projects.find(p => p.id === project);
  const list = tasks.filter(t => project ? t.project_id === project : domain ? t.domain_id === domain && !t.project_id : false);
  const q = query.trim().toLowerCase();
  const taskButton = (t: TaskRecord) => <button key={t.id} className="lw-row" onClick={() => navigate(() => { setMore(false); setTaskID(t.id); })}><span>{t.title}<small>{t.due_date ? `Due ${t.due_date} · ` : ''}{t.status}{state.edits.some(e => e.task.id === t.id) ? ' · Pending sync' : ''}</small></span><span aria-hidden="true">→</span></button>;
  return <div className="local-workspace">
    {leaving && <div className="lw-modal"><section role="dialog" aria-modal="true" aria-labelledby="discard-title"><h2 id="discard-title">Discard the unsaved draft?</h2><p>Your previously saved changes will stay on this device.</p><button autoFocus onClick={() => setLeaving(null)}>Keep editing</button><button onClick={() => { setDirty(false); setLeaving(null); leaving(); }}>Discard draft</button></section></div>}
    <header className="lw-header" inert={leaving ? true : undefined}><button aria-label="All domains" onClick={() => navigate(reset)}>The Almanac</button><div><span role="status">{state.syncing ? 'Syncing…' : state.edits.length ? `${state.edits.length} pending` : snapshot ? 'Saved on this device' : 'Not downloaded'}</span><button aria-label="Search" onClick={() => navigate(() => { reset(); setSearch(true); })}>⌕</button><button onClick={() => void adapter.sync()} disabled={state.syncing}>Sync</button></div></header>
    <main inert={leaving ? true : undefined}>
      {state.error && <p role="alert">{state.error}</p>}
      {state.message && <p className="lw-notice" role="status">{state.message}</p>}
      {!state.loaded ? <p>Opening saved records…</p> : !snapshot ? <section><h1>Domains</h1><p>Connect and sync once to download your domains, projects and tasks.</p><button onClick={() => void adapter.sync()}>Download workspace</button><button onClick={() => adapter.action('settings')}>Connection settings</button></section> : more ? <section><h1>More</h1><button className="lw-row" onClick={() => adapter.action('captures')}>Saved captures →</button><button className="lw-row" onClick={() => adapter.action('settings')}>Settings →</button><button className="lw-row" onClick={() => adapter.action('online')}>Other tools on web →</button><h2>Pending changes</h2>{state.edits.length ? state.edits.map(e => taskButton(e.task)) : <p>All task changes synchronized.</p>}</section> : task ? <>
        <button className="lw-back" onClick={() => navigate(() => setTaskID(null))}>← {selectedProject?.name ?? selectedDomain?.name ?? 'Results'}</button>
        <TaskEditor key={task.id} task={task} snapshot={snapshot} edit={state.edits.find(e => e.task.id === task.id)} adapter={adapter} dirty={setDirty} />
      </> : <>
        {(domain || project) && <button className="lw-back" onClick={() => navigate(() => { if (project) setProject(null); else setDomain(null); })}>← {project ? selectedDomain?.name ?? 'Domains' : 'Domains'}</button>}
        <h1>{search ? 'Search' : selectedProject?.name ?? selectedDomain?.name ?? 'Domains'}</h1>
        {search ? <><label className="lw-field">Find records<input autoFocus type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Tasks, projects, domains…" /></label>{q && <>
          {snapshot.domains.filter(d => d.name.toLowerCase().includes(q)).map(d => <button key={d.id} className="lw-row" onClick={() => { setDomain(d.id); setSearch(false); }}>{d.name}<small>Domain →</small></button>)}
          {snapshot.projects.filter(p => p.name.toLowerCase().includes(q)).map(p => <button key={p.id} className="lw-row" onClick={() => { setDomain(p.domain_id ?? null); setProject(p.id); setSearch(false); }}>{p.name}<small>Project / area →</small></button>)}
          {tasks.filter(t => `${t.title} ${t.notes ?? ''}`.toLowerCase().includes(q)).map(taskButton)}
        </>}</> : !domain && !project ? <>
          {snapshot.domains.map(d => <button className="lw-row" key={d.id} onClick={() => setDomain(d.id)}><span>{d.name}<small>{d.description}</small></span><span>→</span></button>)}
          {snapshot.projects.filter(p => !p.domain_id).map(p => <button className="lw-row" key={p.id} onClick={() => setProject(p.id)}>{p.name}<small>Unassigned {p.kind ?? 'project'} →</small></button>)}
          {!snapshot.domains.length && <p>No domains downloaded yet.</p>}
        </> : <>
          {(selectedProject?.description ?? selectedDomain?.description) && <p>{selectedProject?.description ?? selectedDomain?.description}</p>}
          {!project && <><h2>Projects &amp; areas</h2>{snapshot.projects.filter(p => p.domain_id === domain).map(p => <button className="lw-row" key={p.id} onClick={() => setProject(p.id)}><span>{p.name}<small>{p.kind ?? 'project'}</small></span><span>→</span></button>)}{!snapshot.projects.some(p => p.domain_id === domain) && <p className="lw-muted">No projects or areas here yet.</p>}</>}
          <h2>{project ? 'Tasks' : 'Tasks in this domain'}</h2>{list.map(taskButton)}{!list.length && <p className="lw-muted">No tasks here yet.</p>}
          {(selectedProject?.doc_md ?? selectedDomain?.doc_md) && <details><summary>Overview</summary><div className="lw-text">{selectedProject?.doc_md ?? selectedDomain?.doc_md}</div></details>}
        </>}
        {snapshot.fetchedAt && <p className="lw-muted lw-freshness">Last downloaded {new Date(snapshot.fetchedAt).toLocaleString()}</p>}
      </>}
    </main>
    <nav aria-label="Primary navigation" inert={leaving ? true : undefined}><button onClick={() => navigate(() => adapter.action('agenda'))}>Agenda</button><button aria-current={!more && !search ? 'page' : undefined} onClick={() => navigate(reset)}>Domains</button><button onClick={() => navigate(() => adapter.action('capture'))}>＋ Capture</button><button onClick={() => navigate(() => { reset(); setSearch(true); })}>Search</button><button onClick={() => navigate(() => { reset(); setMore(true); })}>More</button></nav>
  </div>;
}

function TaskEditor({ task, snapshot, edit, adapter, dirty }: { task: TaskRecord; snapshot: Snapshot; edit?: Edit; adapter: WorkspaceAdapter; dirty: (value: boolean) => void }) {
  const [draft, setDraft] = useState(task);
  const [revision, setRevision] = useState(edit?.id ?? null);
  const [changed, setChanged] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);
  const scope = scopeFor(task, snapshot);
  const statuses = scope?.definition?.statuses;
  useEffect(() => { if (!changed) { setDraft(task); setRevision(edit?.id ?? null); } }, [task, edit?.id, changed]);
  function change(update: Partial<TaskRecord>) { setDraft(d => ({ ...d, ...update })); setChanged(true); dirty(true); setMessage(''); }
  async function save() {
    setSaving(true); setFailed(false);
    try { await adapter.save(draft, revision); setChanged(false); dirty(false); setMessage('Saved on this device.'); }
    catch (e) { setFailed(true); setMessage(e instanceof Error ? e.message : String(e)); }
    finally { setSaving(false); }
  }
  async function review() {
    if (!edit) return;
    try { await adapter.review(edit.id); setFailed(false); setMessage('Latest server version loaded. Your saved changes are preserved.'); }
    catch (e) { setFailed(true); setMessage(e instanceof Error ? e.message : String(e)); }
  }
  async function resolve(choice: 'server' | 'local') {
    if (!edit) return;
    try { await adapter.resolve(edit.id, choice); setFailed(false); setChanged(false); dirty(false); setMessage('Conflict resolved.'); }
    catch (e) { setFailed(true); setMessage(String(e)); }
  }
  return <section><h1>Task</h1>
    {edit && <p role="status">{edit.blocked ? 'Needs review' : 'Pending sync'}</p>}
    {edit?.error && <p className="lw-notice">{edit.error}</p>}
    {edit?.blocked && <p><button onClick={() => void review()}>Review latest server version</button>{edit.detailsPath && <button onClick={() => adapter.action(`details:${edit.detailsPath}`)}>Provide required details on web</button>}</p>}
    {edit?.blocked && <div className="lw-conflict"><h2>Your saved version</h2><p>{edit.task.title}</p><div className="lw-text">{edit.task.notes}</div><p>{edit.task.status} · {edit.task.due_date ?? 'No due date'}</p>{edit.serverTask && <><h2>Server version</h2><p>{edit.serverTask.title}</p><div className="lw-text">{edit.serverTask.notes}</div><p>{edit.serverTask.status} · {edit.serverTask.due_date ?? 'No due date'}</p><button onClick={() => void resolve('server')}>Use server version</button><button onClick={() => void resolve('local')}>Apply my changed fields</button></>}</div>}
    <form onSubmit={e => { e.preventDefault(); void save(); }}>
      <label className="lw-field">Title<input aria-label="Task title" required value={draft.title} onChange={e => change({ title: e.target.value })} /></label>
      <label className="lw-field">Notes<textarea value={draft.notes ?? ''} onChange={e => change({ notes: e.target.value || null })} /></label>
      <div className="lw-fields"><label className="lw-field">Due date<input type="date" value={draft.due_date ?? ''} onChange={e => change({ due_date: e.target.value || null })} /></label>
      <label className="lw-field">Status<select value={statuses ? draft.workflow_status_id ?? statuses.find(s => s.category === draft.status)?.id ?? '' : draft.status} onChange={e => { const selected = statuses?.find(s => s.id === e.target.value); change(selected ? { workflow_status_id: selected.id, status: selected.category } : { status: e.target.value }); }}>
        {statuses ? statuses.map(s => <option key={s.id} value={s.id}>{s.label}</option>) : ['open','waiting','done'].map(s => <option key={s}>{s}</option>)}
      </select></label></div>
      <button className="lw-primary" type="submit" disabled={saving || !!edit?.attempted}>{saving ? 'Saving…' : 'Save on device'}</button>
      {edit?.attempted && !edit.blocked && <p className="lw-muted">Waiting for server confirmation before another edit can be sent.</p>}
      {message && <p role={failed ? 'alert' : 'status'}>{message}</p>}
    </form>
  </section>;
}
