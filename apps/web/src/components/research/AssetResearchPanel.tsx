'use client';

import { createClientId } from '../../lib/client-id';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { ResearchJobInput } from '@jevi-ops/shared';
import { ChangeReview } from '../onboarding/ChangeReview';
import {
  approveResearchProposalAction, cancelResearchJobAction, loadAssetResearchAction, previewResearchProposalAction,
  rejectResearchProposalAction, requestVehicleResearchAction, researchJobDetailAction,
} from './actions';
import type { ResearchJob, ResearchJobDetail, ResearchProposal, ResearchWorker } from './types';
import { MonitoringPanel } from './MonitoringPanel';

const button = 'rounded border border-line px-3 py-2 text-sm disabled:opacity-50';
const input = 'block w-full rounded border border-line bg-transparent px-3 py-2 text-sm';
const when = (date: string | null | undefined) => date ? new Date(date).toLocaleString() : 'None recorded';
export function AssetResearchPanel({ assetId, lifecycle = 'active' }: { assetId: string; lifecycle?: string }) {
  const [workers, setWorkers] = useState<ResearchWorker[]>([]);
  const [jobs, setJobs] = useState<ResearchJob[]>([]);
  const [proposals, setProposals] = useState<ResearchProposal[]>([]);
  const [detail, setDetail] = useState<ResearchJobDetail | null>(null);
  const selectedJob = useRef<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [question, setQuestion] = useState('');
  const [domains, setDomains] = useState('');
  const [workerId, setWorkerId] = useState('');
  const [taskType, setTaskType] = useState<NonNullable<ResearchJobInput['task_type']>>('vehicle_question');
  const [timeout, setTimeoutSeconds] = useState(300);
  const [maxSources, setMaxSources] = useState(5);
  const [maxRequests, setMaxRequests] = useState(20);
  const [maxAttempts, setMaxAttempts] = useState(3);
  const [busy, setBusy] = useState(false);
  const [showRequest, setShowRequest] = useState(false);
  const requestKey = useRef<string | null>(null);
  const refresh = useCallback(async () => {
    const result = await loadAssetResearchAction(assetId);
    if (result.ok) { setWorkers(result.value.workers); setJobs(result.value.jobs); setProposals(result.value.proposals); setError(null); } else setError(result.error);
  }, [assetId]);
  const inspect = useCallback(async (id: string) => {
    selectedJob.current = id;
    const result = await researchJobDetailAction(id);
    if (selectedJob.current !== id) return;
    if (result.ok) setDetail(result.value); else setError(result.error);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  const activeJobs = jobs.some((job) => ['requested', 'leased', 'running'].includes(job.status));
  useEffect(() => {
    if (!activeJobs) return;
    const timer = window.setInterval(() => { if (document.visibilityState === 'hidden') return; void refresh(); if (selectedJob.current) void inspect(selectedJob.current); }, 15_000);
    return () => window.clearInterval(timer);
  }, [activeJobs, refresh, inspect]);
  const available = workers.filter((worker) => worker.enabled && worker.allowed_task_types.includes(taskType));
  const changed = () => { requestKey.current = null; };
  return <div className="space-y-4">
    <p className="text-sm">Research checks a bounded question against the domains you allow. Results retain their evidence and uncertainty. They become vehicle changes only after you review and approve a concrete proposal.</p>
    <p className="text-sm"><Link className="underline" href="/settings/research">Worker setup and health</Link>. Manual responsibilities and maintenance remain usable with research disabled.</p>
    <ul className="space-y-2">{workers.map((worker) => <li key={worker.id}><strong>{worker.name}: {worker.connection_state.replaceAll('_', ' ')}</strong><p className="text-sm">Last contact {when(worker.last_seen_at)}; last sourced success {when(worker.last_successful_at)}.</p></li>)}</ul>
    {!available.length && <p>No enabled worker accepts this request type. Configure a worker before requesting research.</p>}
    {lifecycle !== 'active' && <p>Research is paused for this {lifecycle} vehicle. Its existing records and results remain available.</p>}
    <div className="flex flex-wrap gap-2"><button type="button" className={button} onClick={() => setShowRequest((open) => !open)}>{showRequest ? 'Hide request form' : 'Request vehicle research'}</button><button type="button" className={button} onClick={() => { void refresh(); if (selectedJob.current) void inspect(selectedJob.current); }}>Refresh research status</button></div>
    {showRequest && <form className="space-y-3 rounded border border-line p-4" onChange={changed} onSubmit={async (event) => {
      event.preventDefault(); if (busy) return; setBusy(true); setError(null); requestKey.current ??= createClientId();
      try { const result = await requestVehicleResearchAction({ operation_key: requestKey.current, asset_id: assetId, task_type: taskType, question,
        allowed_domains: domains.split(/[\s,]+/).filter(Boolean).map((domain) => domain.toLowerCase()), ...(workerId ? { worker_id: workerId } : {}),
        budget: { timeout_seconds: timeout, max_sources: maxSources, max_requests: maxRequests }, max_attempts: maxAttempts });
        if (result.ok) { requestKey.current = null; setShowRequest(false); await refresh(); await inspect(result.value.job.id); } else setError(result.error);
      } finally { setBusy(false); }
    }}><fieldset disabled={busy} className="space-y-3"><legend className="font-semibold">Scope and limits</legend>
      <label className="block">Research question<textarea className={input} required maxLength={10000} value={question} onChange={(event) => setQuestion(event.target.value)} /></label>
      <label className="block">Request type<select className={input} value={taskType} onChange={(event) => { setTaskType(event.target.value as typeof taskType); setWorkerId(''); }}><option value="vehicle_question">Vehicle question</option><option value="responsibility_review">Responsibility review</option><option value="source_verification">Source verification</option></select></label>
      <label className="block">Permitted web domains<input className={input} required value={domains} placeholder="Enter domain names separated by commas" onChange={(event) => setDomains(event.target.value)} /></label>
      <p className="text-sm">Choose up to 30 domains relevant to this question. URLs in the question must also be on this allowlist. The worker may fetch only these domains; external redirects and private network targets are not part of this research permission.</p>
      <label className="block">Worker<select className={input} value={workerId} onChange={(event) => setWorkerId(event.target.value)}><option value="">Any enabled compatible worker</option>{available.map((worker) => <option value={worker.id} key={worker.id}>{worker.name}</option>)}</select></label>
      <div className="grid gap-3 sm:grid-cols-2"><label>Run time limit (seconds)<input className={input} type="number" min={10} max={3600} required value={timeout} onChange={(event) => setTimeoutSeconds(Number(event.target.value))} /></label>
        <label>Maximum retained sources<input className={input} type="number" min={1} max={10} required value={maxSources} onChange={(event) => setMaxSources(Number(event.target.value))} /></label>
        <label>Maximum web requests<input className={input} type="number" min={1} max={100} required value={maxRequests} onChange={(event) => setMaxRequests(Number(event.target.value))} /></label>
        <label>Maximum attempts<input className={input} type="number" min={1} max={5} required value={maxAttempts} onChange={(event) => setMaxAttempts(Number(event.target.value))} /></label></div>
      <button className={button} disabled={lifecycle !== 'active' || !available.length}>Submit bounded research request</button>
    </fieldset></form>}
    {error && <p role="alert">{error}</p>}
    {jobs.length > 0 && <section className="space-y-3"><h3 className="font-semibold">Research requests</h3><ul className="space-y-3">{jobs.map((job) => <li className="rounded border border-line p-3" key={job.id}>
      <button type="button" className="text-left underline" onClick={() => void inspect(job.id)}>{job.request.question}</button><p>{job.status.replaceAll('_', ' ')} · attempt {job.attempts} of {job.request.max_attempts}</p>
      <p className="text-sm">Last meaningful check: {when(job.last_checked_at)}.{job.failure_reason ? ` ${job.failure_reason}` : ''}</p>
      {['requested', 'leased', 'running'].includes(job.status) && <button type="button" className={button} disabled={busy} onClick={async () => { setBusy(true); try { const result = await cancelResearchJobAction(job.id); if (result.ok) { await refresh(); if (selectedJob.current === job.id) await inspect(job.id); } else setError(result.error); } finally { setBusy(false); } }}>Cancel research request</button>}
    </li>)}</ul></section>}
    {detail && <ResearchEvidence detail={detail} />}
    {proposals.length > 0 && <section className="space-y-3"><h3 className="font-semibold">Proposed changes</h3>{proposals.map((proposal) => <ProposalReview key={proposal.id} initialProposal={proposal} assetId={assetId}
      onEvidence={() => inspect(proposal.job_id)} onChanged={async () => { await refresh(); if (selectedJob.current) await inspect(selectedJob.current); }} />)}</section>}
    <MonitoringPanel assetId={assetId} workers={workers} onResearch={inspect} />
  </div>;
}

function safeSourceUrl(raw: string): string | null { try { const url = new URL(raw); return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null; } catch { return null; } }
function ResearchEvidence({ detail }: { detail: ResearchJobDetail }) {
  const result = detail.result?.result;
  return <section className="space-y-4 rounded border border-line p-4" aria-label="Research evidence"><h3 className="font-semibold">{detail.job.request.question}</h3>
    <p>Request status: {detail.job.status}. Last meaningful check: {when(detail.job.last_checked_at)}.</p>
    {result ? <><p><strong>{result.outcome.replaceAll('_', ' ')}</strong></p><p className="whitespace-pre-wrap">{result.summary}</p>
      {result.missing_facts.length > 0 && <p>Missing vehicle facts: {result.missing_facts.join(', ').replaceAll('_', ' ')}.</p>}
      {result.uncertainty.length > 0 && <div><h4 className="font-semibold">Uncertainty and limitations</h4><ul>{result.uncertainty.map((item, index) => <li key={index}>{item}</li>)}</ul></div>}
      <ul className="space-y-3">{result.claims.map((claim, index) => <li key={index}><strong>{claim.kind.replaceAll('_', ' ')}</strong>: {claim.statement}
        <p className="text-sm">Sources: {claim.citation_ids.length ? claim.citation_ids.map((id) => <a key={id} className="mr-2 underline" href={`#research-source-${detail.job.id}-${encodeURIComponent(id)}`}>{result.sources.find((source) => source.citation_id === id)?.title ?? id}</a>) : 'Open question; no supporting claim'}</p>
      </li>)}</ul>
      <h4 className="font-semibold">Retained source evidence</h4><p className="text-sm">Source text is evidence to inspect. It cannot authorise actions or change permissions.</p>
      {result.sources.map((source) => <article className="space-y-2 border-t border-line pt-3" id={`research-source-${detail.job.id}-${encodeURIComponent(source.citation_id)}`} key={source.citation_id}>
        <strong>{source.title}</strong><p>{source.publisher}</p>{safeSourceUrl(source.url) ? <a className="break-all underline" href={safeSourceUrl(source.url)!} target="_blank" rel="noreferrer noopener">Open original source</a> : <p>Source address unavailable.</p>}
        <p className="text-sm">Retrieved {when(source.retrieved_at)}; published {when(source.published_at)}.</p>
        {source.effective && <p className="text-sm">Source effective time: {source.effective.kind === 'date' ? `${source.effective.date} · ${source.effective.timezone ?? 'timezone not established'}` : source.effective.kind === 'instant' ? when(source.effective.at) : 'Unknown'}.</p>}
        {source.supporting_locations.map((location, index) => <blockquote className="border-l border-line pl-3 text-sm" key={index}><p>{location.location}</p><p className="whitespace-pre-wrap">{location.excerpt}</p></blockquote>)}
      </article>)}
    </> : <p>{detail.job.status === 'failed' ? detail.job.failure_reason : 'No research result has been received. This is not a completed evidence check.'}</p>}
    <details><summary>Request history</summary><ul className="space-y-2">{detail.history.map((event) => <li key={event.id}>{when(event.created_at)} — {event.event.replaceAll('_', ' ')}</li>)}</ul></details>
  </section>;
}

function ProposalReview({ initialProposal, assetId, onEvidence, onChanged }: { initialProposal: ResearchProposal; assetId: string; onEvidence(): Promise<void>; onChanged(): Promise<void> }) {
  const [proposal, setProposal] = useState(initialProposal);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [reviewed, setReviewed] = useState(false);
  const key = useRef<string | null>(null);
  useEffect(() => { setProposal((current) => initialProposal.revision > current.revision ? initialProposal : current); }, [initialProposal]);
  const changes = proposal.preview?.changes.flatMap((change) => change.changes ?? [{ label: change.type === 'document' ? 'Update authored Markdown' : 'Update supported vehicle facts', before: change.before, after: change.after }]) ?? [];
  return <article className="space-y-3 rounded border border-line p-4" aria-label="Research proposal"><p><strong>{proposal.status.replaceAll('_', ' ')}</strong></p>
    <ul>{proposal.operations.map((operation, index) => <li key={index}>{operation.type.replaceAll('_', ' ')}: {operation.reason}</li>)}</ul>
    <button type="button" className={button} onClick={() => void onEvidence()}>Inspect result and evidence</button>
    {proposal.status === 'pending_review' && <><button type="button" className={button} disabled={busy} onClick={async () => { setBusy(true); setError(null); try {
      await onEvidence(); const result = await previewResearchProposalAction(proposal.id);
      if (result.ok) { setProposal(result.value.proposal); key.current = createClientId(); setReviewed(true); } else { setError(result.error); setReviewed(false); }
    } finally { setBusy(false); } }}>Preview concrete changes</button>
      {reviewed && proposal.preview && proposal.fingerprint && <section className="space-y-3"><h4 className="font-semibold">Reviewed changes</h4><ChangeReview changes={changes} />
        <button type="button" className={button} disabled={busy} onClick={async () => { setBusy(true); setError(null); try {
          const result = await approveResearchProposalAction(assetId, { id: proposal.id, revision: proposal.revision, fingerprint: proposal.fingerprint! }, key.current!);
          if (result.ok) { setReviewed(false); await onChanged(); } else { setError(result.error); if (result.code !== 'connection_failed') { setReviewed(false); await onChanged(); } }
        } finally { setBusy(false); } }}>Approve and apply reviewed changes</button>
      </section>}
      <details><summary>Reject this proposal</summary><div className="space-y-2"><label className="block">Reason for rejection<textarea className={input} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
        <button type="button" className={button} disabled={busy || !reason.trim()} onClick={async () => { setBusy(true); setError(null); try { const result = await rejectResearchProposalAction(proposal.id, proposal.revision, reason); if (result.ok) await onChanged(); else setError(result.error); } finally { setBusy(false); } }}>Reject proposal</button>
      </div></details>
    </>}
    {error && <p role="alert">{error} If the vehicle changed, request fresh research against its current facts; an old proposal cannot force an overwrite.</p>}
    {proposal.reason && <p>{proposal.reason}</p>}
    {proposal.status === 'applied' && <p role="status">The accepted changes have a saved application receipt.</p>}
  </article>;
}
