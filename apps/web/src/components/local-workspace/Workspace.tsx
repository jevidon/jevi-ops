'use client';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Icon } from '../Icon';
import { Pill } from '../Pill';
import { ScreenHeader } from '../ScreenHeader';
import { domainColor } from '../../lib/domain-colors';
import { DomainRow, MenuRow, ProjectRow, WorkspaceNavigation, WorkspaceSection } from './WorkspaceChrome';
import { emptyState, scopeFor, visibleTasks, type TaskRecord, type Snapshot, type WorkspaceAdapter, type Edit, type ContainerRecord } from './model';
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
  const projects = snapshot?.projects.filter(p => p.domain_id === domain) ?? [];
  const q = query.trim().toLowerCase();
  const taskButton = (t: TaskRecord) => {
    const edit = state.edits.find(e => e.task.id === t.id);
    const status = snapshot && scopeFor(t, snapshot)?.definition?.statuses.find(s => s.id === t.workflow_status_id)?.label || t.status;
    return <button key={t.id} className="lw-row" onClick={() => navigate(() => { setMore(false); setTaskID(t.id); })}>
      <span className="lw-task-ring" data-status={t.status} aria-hidden="true">{t.status === 'done' && <Icon name="check" size={12} />}</span>
      <span className="lw-row-copy"><span className="lw-row-title">{t.title}</span><span className="lw-row-meta"><span className="lw-meta">{t.due_date ? `Due ${t.due_date} · ` : ''}{status}</span>{edit && <Pill state={edit.blocked ? 'over' : 'due'}>{edit.blocked ? 'Needs review' : 'Pending sync'}</Pill>}</span></span>
      <Icon name="chev" size={14} className="text-ink-3 mt-1 shrink-0" />
    </button>;
  };
  const projectCard = (p: ContainerRecord) => <ProjectRow key={p.id} project={p} count={tasks.filter(t => t.project_id === p.id).length} color={domainColor(snapshot?.domains.find(d => d.id === p.domain_id)?.name ?? p.name)} onOpen={() => { setDomain(p.domain_id ?? null); setProject(p.id); setSearch(false); }} />;
  const back = (label: string, action: () => void) => <button className="lw-back" aria-label={`← ${label}`} onClick={() => navigate(action)}><Icon name="arrow" size={14} className="rotate-180" />{label}</button>;
  function navigateTab(name: string) {
    navigate(() => {
      if (name === 'domains') reset();
      else if (name === 'search') { reset(); setSearch(true); }
      else if (name === 'more') { reset(); setMore(true); }
      else adapter.action(name);
    });
  }
  return <div className="local-workspace">
    {leaving && <div className="lw-modal"><section role="dialog" aria-modal="true" aria-labelledby="discard-title"><h2 id="discard-title">Discard the unsaved draft?</h2><p>Your previously saved changes will stay on this device.</p><div className="lw-actions"><button className="lw-button lw-primary" autoFocus onClick={() => setLeaving(null)}>Keep editing</button><button className="lw-button" onClick={() => { setDirty(false); setLeaving(null); leaving(); }}>Discard draft</button></div></section></div>}
    <header className="lw-toolbar" inert={leaving ? true : undefined}>
      <button className="lw-home" aria-label="All domains" onClick={() => navigate(reset)}>Almanac</button>
      <div className="lw-toolbar-actions"><span className="lw-toolbar-status" role="status">{state.syncing ? 'Syncing…' : state.edits.length ? `${state.edits.length} pending` : snapshot ? 'On this device' : 'Not downloaded'}</span><button className="lw-icon-button" aria-label="Search" onClick={() => navigateTab('search')}><Icon name="search" size={18} /></button><button className="lw-sync" onClick={() => void adapter.sync()} disabled={state.syncing}>Sync</button></div>
    </header>
    <main className="lw-main" inert={leaving ? true : undefined}>
      {state.error && <p className="lw-notice" role="alert">{state.error}</p>}
      {state.message && <p className="lw-notice" role="status">{state.message}</p>}
      {!state.loaded ? <p className="lw-content lw-empty">Opening saved records…</p> : !snapshot ? <section>
        <ScreenHeader eyebrow="Workspace" title="Domains" />
        <div className="lw-content"><p className="lw-description">Connect and sync once to download your domains, projects and tasks.</p><div className="lw-actions"><button className="lw-button lw-primary" onClick={() => void adapter.sync()}>Download workspace</button><button className="lw-button" onClick={() => adapter.action('settings')}>Connection settings</button></div></div>
      </section> : more ? <section>
        <ScreenHeader eyebrow="Workspace" title="More" />
        <div className="lw-content"><MenuRow icon="note" onClick={() => adapter.action('captures')}>Saved captures</MenuRow><MenuRow icon="gear" onClick={() => adapter.action('settings')}>Settings</MenuRow><MenuRow icon="work" onClick={() => adapter.action('online')}>Other tools on web</MenuRow><WorkspaceSection title="Pending changes" count={state.edits.length}>{state.edits.length ? state.edits.map(e => taskButton(e.task)) : <p className="lw-empty">All task changes synchronized.</p>}</WorkspaceSection></div>
      </section> : task ? <>
        {back(selectedProject?.name ?? selectedDomain?.name ?? 'Results', () => setTaskID(null))}
        <TaskEditor key={task.id} task={task} snapshot={snapshot} edit={state.edits.find(e => e.task.id === task.id)} adapter={adapter} dirty={setDirty} />
      </> : <>
        {(domain || project) && back(project ? selectedDomain?.name ?? 'Domains' : 'Domains', () => { if (project) setProject(null); else setDomain(null); })}
        <ScreenHeader eyebrow={search ? 'Saved records' : project ? selectedProject?.kind ?? 'Project / area' : domain ? 'Domain' : 'Workspace'} title={search ? 'Search' : selectedProject?.name ?? selectedDomain?.name ?? 'Domains'} meta={!domain && !project && !search ? `${snapshot.domains.length} domains · ${snapshot.projects.length} projects & areas` : undefined} />
        <div className="lw-content">
          {search ? <><label className="lw-field">Find records<input autoFocus type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Tasks, projects, domains…" /></label>{q && <>
            {snapshot.domains.filter(d => d.name.toLowerCase().includes(q)).map(d => <DomainRow key={d.id} domain={d} tasks={tasks} onOpen={() => { setDomain(d.id); setSearch(false); }} />)}
            <div className="lw-projects">{snapshot.projects.filter(p => p.name.toLowerCase().includes(q)).map(projectCard)}</div>
            {tasks.filter(t => `${t.title} ${t.notes ?? ''}`.toLowerCase().includes(q)).map(taskButton)}
          </>}</> : !domain && !project ? <>
            <div className="lw-domain-list">{snapshot.domains.map(d => <DomainRow key={d.id} domain={d} tasks={tasks} onOpen={() => setDomain(d.id)} />)}</div>
            {snapshot.projects.some(p => !p.domain_id) && <WorkspaceSection title="Unassigned projects & areas"><div className="lw-projects">{snapshot.projects.filter(p => !p.domain_id).map(projectCard)}</div></WorkspaceSection>}
            {!snapshot.domains.length && <p className="lw-empty">No domains downloaded yet.</p>}
          </> : <>
            {(selectedProject?.description ?? selectedDomain?.description) && <p className="lw-description">{selectedProject?.description ?? selectedDomain?.description}</p>}
            {!project && <WorkspaceSection title="Projects & areas" count={projects.length}><div className="lw-projects">{projects.map(projectCard)}</div>{!projects.length && <p className="lw-empty">No projects or areas here yet.</p>}</WorkspaceSection>}
            <WorkspaceSection title={project ? 'Tasks' : 'Tasks in this domain'} count={list.length}>{list.map(taskButton)}{!list.length && <p className="lw-empty">No tasks here yet.</p>}</WorkspaceSection>
            {(selectedProject?.doc_md ?? selectedDomain?.doc_md) && <details className="lw-overview"><summary>Overview</summary><div className="lw-text">{selectedProject?.doc_md ?? selectedDomain?.doc_md}</div></details>}
          </>}
          {snapshot.fetchedAt && <p className="lw-freshness">Last downloaded {new Date(snapshot.fetchedAt).toLocaleString()}</p>}
        </div>
      </>}
    </main>
    <WorkspaceNavigation active={more ? 'more' : search ? 'search' : 'domains'} navigate={navigateTab} inert={leaving ? true : undefined} />
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
  return <section>
    <ScreenHeader eyebrow="Task" title={task.title} />
    <div className="lw-content">
      {edit && <div role="status" className="lw-editor-state"><Pill state={edit.blocked ? 'over' : 'due'}>{edit.blocked ? 'Needs review' : 'Pending sync'}</Pill></div>}
      {edit?.error && <p className="lw-notice">{edit.error}</p>}
      {edit?.blocked && <div className="lw-actions"><button className="lw-button" onClick={() => void review()}>Review latest server version</button>{edit.detailsPath && <button className="lw-button" onClick={() => adapter.action(`details:${edit.detailsPath}`)}>Provide required details on web</button>}</div>}
      {edit?.blocked && <div className="lw-conflict"><h2>Your saved version</h2><p>{edit.task.title}</p><div className="lw-text">{edit.task.notes}</div><p>{edit.task.status} · {edit.task.due_date ?? 'No due date'}</p>{edit.serverTask && <><h2>Server version</h2><p>{edit.serverTask.title}</p><div className="lw-text">{edit.serverTask.notes}</div><p>{edit.serverTask.status} · {edit.serverTask.due_date ?? 'No due date'}</p><div className="lw-actions"><button className="lw-button" onClick={() => void resolve('server')}>Use server version</button><button className="lw-button lw-primary" onClick={() => void resolve('local')}>Apply my changed fields</button></div></>}</div>}
      <form onSubmit={e => { e.preventDefault(); void save(); }}>
        <label className="lw-field">Title<input aria-label="Task title" required value={draft.title} onChange={e => change({ title: e.target.value })} /></label>
        <label className="lw-field">Notes<textarea value={draft.notes ?? ''} onChange={e => change({ notes: e.target.value || null })} /></label>
        <div className="lw-fields">
          <label className="lw-field">Due date<input type="date" value={draft.due_date ?? ''} onChange={e => change({ due_date: e.target.value || null })} /></label>
          <label className="lw-field">Status<select value={statuses ? draft.workflow_status_id ?? statuses.find(s => s.category === draft.status)?.id ?? '' : draft.status} onChange={e => { const selected = statuses?.find(s => s.id === e.target.value); change(selected ? { workflow_status_id: selected.id, status: selected.category } : { status: e.target.value }); }}>
            {statuses ? statuses.map(s => <option key={s.id} value={s.id}>{s.label}</option>) : ['open','waiting','done'].map(s => <option key={s}>{s}</option>)}
          </select></label>
        </div>
        <div className="lw-save">
          <button className="lw-button lw-primary" type="submit" disabled={saving || !!edit?.attempted}>{saving ? 'Saving…' : 'Save on device'}</button>
          {message && <p className="lw-save-message" role={failed ? 'alert' : 'status'}>{message}</p>}
        </div>
        {edit?.attempted && !edit.blocked && <p className="lw-empty">Waiting for server confirmation before another edit can be sent.</p>}
      </form>
    </div>
  </section>;
}
