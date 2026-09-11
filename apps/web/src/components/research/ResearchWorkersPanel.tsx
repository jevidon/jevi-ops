'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  createHermesWorkerAction, loadResearchWorkersAction, mintResearchWorkerTokenAction, revokeResearchWorkerTokenAction, updateResearchWorkerAction,
} from './actions';
import type { ResearchToken, ResearchWorker } from './types';

const button = 'rounded border border-line px-3 py-2 text-sm disabled:opacity-50';
export function ResearchWorkersPanel() {
  const [workers, setWorkers] = useState<ResearchWorker[]>([]);
  const [tokens, setTokens] = useState<ResearchToken[]>([]);
  const [name, setName] = useState('Hermes vehicle research');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [credential, setCredential] = useState<{ workerId: string; id: string; token: string } | null>(null);
  const [showToken, setShowToken] = useState(false);
  const [copied, setCopied] = useState(false);
  const [uncertainRegistration, setUncertainRegistration] = useState(false);
  const refresh = useCallback(async () => {
    const result = await loadResearchWorkersAction();
    if (result.ok) { setWorkers(result.value.workers); setTokens(result.value.tokens); setError(null); } else setError(result.error);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  return <div className="space-y-5">
    <p>Research uses a separate Hermes installation with a restricted polling adapter. A worker can receive only its permitted vehicle context and submit evidence-backed proposals. It cannot approve changes, edit ordinary records or read provider credentials.</p>
    <ol className="list-decimal space-y-2 pl-5"><li>Download the <a className="underline" href="/api/research/setup-guide">Hermes worker setup guide</a> and install the pinned package from this repository.</li><li>Register the worker below, then create its scoped credential.</li><li>Store that credential in the worker’s protected environment file and start the adapter using the guide.</li><li>Request one bounded vehicle investigation and inspect its retained evidence. A health report alone does not prove research succeeded.</li></ol>
    <form className="space-y-3 rounded border border-line p-4" onSubmit={async (event) => {
      event.preventDefault(); if (busy) return; setBusy(true); setError(null);
      try { const result = await createHermesWorkerAction(name); if (result.ok) { setName(''); await refresh(); } else { setError(result.error); setUncertainRegistration(result.code === 'connection_failed'); } }
      finally { setBusy(false); }
    }}><h2 className="font-serif text-xl">Register a new Hermes worker</h2><label className="block">Worker name<input required className="block w-full rounded border border-line bg-transparent px-3 py-2" value={name} onChange={(event) => setName(event.target.value)} /></label>
      <p className="text-sm">This uses the adapter and runtime pinned in the delivered package. Its public web fetch capability is restricted by each job’s allowlist and budget. Search and document extraction are not advertised by this adapter.</p>
      <button className={button} disabled={busy || uncertainRegistration || !name.trim()}>Register worker</button>
      {uncertainRegistration && <p role="alert">The registration outcome is uncertain. Refresh the worker list and check whether it was created before choosing to register another instance. <button type="button" className="underline" onClick={async () => { await refresh(); setUncertainRegistration(false); }}>Refresh and check registrations</button></p>}
    </form>
    <button type="button" className={button} disabled={busy} onClick={() => void refresh()}>Refresh worker health</button>
    {error && <p role="alert">{error}</p>}
    {credential && <section className="space-y-3 rounded border border-line p-4" aria-label="New worker credential"><h2 className="font-semibold">Store this scoped credential</h2>
      <p>This value is shown only here after creation. Store it in the worker environment, then hide it. The app keeps only its hash.</p>
      <label className="block">New scoped worker token<input className="block w-full rounded border border-line bg-transparent px-3 py-2 font-mono text-sm" readOnly autoComplete="off" type={showToken ? 'text' : 'password'} value={credential.token} /></label>
      <label className="block"><input type="checkbox" checked={showToken} onChange={(event) => setShowToken(event.target.checked)} /> Show token</label>
      <button type="button" className={button} onClick={async () => { try { await navigator.clipboard.writeText(credential.token); setCopied(true); } catch { setError('Clipboard is unavailable. Reveal and copy the token manually.'); } }}>Copy token</button> <button type="button" className={button} onClick={() => { setCredential(null); setShowToken(false); setCopied(false); }}>I have stored it — hide token</button>
      {copied && <p role="status">Token copied.</p>}
    </section>}
    {!workers.length && <p>No worker is registered. Manual vehicle setup and maintenance remain available.</p>}
    {workers.map((worker) => <article className="space-y-3 rounded border border-line p-4" key={worker.id}>
      <h2 className="font-serif text-xl">{worker.name}</h2><p><strong>{worker.connection_state.replaceAll('_', ' ')}</strong></p>
      <p className="text-sm">Adapter: {worker.adapter} · {worker.adapter_version}. Capabilities: {worker.capabilities.join(', ').replaceAll('_', ' ')}.</p>
      <p className="text-sm">Worker ID for setup: <code>{worker.id}</code></p>
      <p>Last contact: {worker.last_seen_at ? new Date(worker.last_seen_at).toLocaleString() : 'Not yet reported'}. Last successful sourced check: {worker.last_successful_at ? new Date(worker.last_successful_at).toLocaleString() : 'None recorded'}.</p>
      {worker.health_detail && <p className="text-sm">{worker.health_detail}</p>}
      <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={busy} onClick={async () => { setBusy(true); try { const result = await updateResearchWorkerAction(worker.id, !worker.enabled); if (result.ok) await refresh(); else setError(result.error); } finally { setBusy(false); } }}>{worker.enabled ? 'Disable worker' : 'Enable worker'}</button>
        <button type="button" className={button} disabled={busy || Boolean(credential)} onClick={async () => { setBusy(true); setError(null); try {
          const result = await mintResearchWorkerTokenAction(worker.id, `${worker.name} research`.slice(0, 80));
          if (result.ok) { setCredential({ workerId: worker.id, ...result.value }); await refresh(); } else setError(result.error);
        } finally { setBusy(false); } }}>Create scoped worker credential</button>
      </div>
      <ul className="space-y-2">{tokens.filter((token) => token.worker_id === worker.id).map((token) => <li key={token.id} className="text-sm">
        {token.name} — {token.revoked_at ? 'revoked' : 'active'}; last used {token.last_used_at ? new Date(token.last_used_at).toLocaleString() : 'never'}.
        {!token.revoked_at && <button type="button" className="ml-2 underline" disabled={busy} onClick={async () => { setBusy(true); try { const result = await revokeResearchWorkerTokenAction(token.id); if (result.ok) { if (credential?.id === token.id) setCredential(null); await refresh(); } else setError(result.error); } finally { setBusy(false); } }}>Revoke credential</button>}
      </li>)}</ul>
    </article>)}
  </div>;
}
