'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { MonitoringPolicyConfig } from '@jevi-ops/shared';
import { loadMonitoringPoliciesAction, monitoringChoicesAction, monitoringDetailAction, readMonitoringNotificationAction, saveMonitoringPolicyAction, setMonitoringEnabledAction, signalMonitoringAction } from './actions';
import type { MonitoringDetail, MonitoringPolicy, ResearchWorker } from './types';

const button = 'rounded border border-line px-3 py-2 text-sm disabled:opacity-50';
const input = 'block w-full rounded border border-line bg-transparent px-3 py-2 text-sm';
const when = (value: string | null) => value ? new Date(value).toLocaleString() : 'None recorded';
type Choices = { assets: { id: string; name: string; lifecycle: string }[]; rules: { id: string; title: string }[] };
export function MonitoringPanel({ assetId, workers, onResearch }: { assetId: string; workers: ResearchWorker[]; onResearch(id: string): Promise<void> }) {
  const [policies, setPolicies] = useState<MonitoringPolicy[]>([]);
  const [choices, setChoices] = useState<Choices>({ assets: [], rules: [] });
  const [editing, setEditing] = useState<MonitoringPolicy | 'new' | null>(null);
  const [detail, setDetail] = useState<MonitoringDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    const result = await loadMonitoringPoliciesAction(assetId);
    if (result.ok) setPolicies(result.value.policies); else setError(result.error);
  }, [assetId]);
  const inspect = useCallback(async (id: string) => { const result = await monitoringDetailAction(id); if (result.ok) setDetail(result.value); else setError(result.error); }, []);
  useEffect(() => { void refresh(); void monitoringChoicesAction().then((result) => { if (result.ok) setChoices(result.value); else setError(result.error); }); }, [refresh]);
  useEffect(() => {
    if (!policies.some((policy) => policy.monitoring_state === 'review_in_progress')) return;
    const timer = window.setInterval(() => { if (document.visibilityState === 'hidden') return; void refresh(); if (detail) void inspect(detail.policy.id); }, 15_000);
    return () => window.clearInterval(timer);
  }, [policies, detail, inspect, refresh]);
  return <section className="space-y-4 border-t border-line pt-5" aria-label="Optional vehicle monitoring">
    <h3 className="font-semibold">Optional monitoring</h3>
    <p className="text-sm">Choose the vehicles, sources, question, cadence and budget for each policy. Monitoring gathers evidence and proposes changes; you approve any operational change. Failed checks retain the previous successful-check time and retry with backoff.</p>
    <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={editing !== null} onClick={() => setEditing('new')}>Add monitoring policy</button><button type="button" className={button} onClick={() => { void refresh(); if (detail) void inspect(detail.policy.id); }}>Refresh monitoring status</button></div>
    {editing && <PolicyEditor key={editing === 'new' ? 'new' : `${editing.id}-${editing.revision}`} assetId={assetId} existing={editing === 'new' ? undefined : editing} workers={workers} choices={choices}
      onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await refresh(); }} />}
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    {!policies.length && <p>No monitoring policy includes this vehicle. Its manually entered records remain available.</p>}
    {policies.map((policy) => <article className="space-y-2 rounded border border-line p-4" key={policy.id}>
      <h4 className="font-semibold">{policy.config.name}</h4><p><strong>{policy.monitoring_state.replaceAll('_', ' ')}</strong> · Worker connection: {policy.connection_state.replaceAll('_', ' ')}</p>
      <p className="text-sm">Last successful check: {when(policy.last_successful_at)}. Last attempt: {when(policy.last_attempt_at)}.</p>
      <p className="text-sm">Next due: {when(policy.next_due_at)}.{policy.retry_after_at ? ` Retry after: ${when(policy.retry_after_at)}.` : ''} {policy.failure_count > 0 ? `${policy.failure_count} failed check(s).` : ''}</p>
      {policy.last_outcome && <p className="text-sm">Latest outcome: {policy.last_outcome.replaceAll('_', ' ')}.</p>}
      <p className="text-sm">Every {policy.config.cadence_hours} hours · {policy.config.asset_ids.length} vehicle(s) · Notifications: {policy.config.notifications.replaceAll('_', ' ')}.</p>
      <p className="text-sm">{policy.config.question}</p>
      <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={busy || editing !== null} onClick={() => setEditing(policy)}>Edit policy</button>
        <button type="button" className={button} disabled={busy} onClick={async () => { setBusy(true); setError(null); try { const result = await setMonitoringEnabledAction(policy.id, policy.revision, !policy.config.enabled); if (result.ok) { await refresh(); if (detail?.policy.id === policy.id) await inspect(policy.id); } else { setError(result.error); await refresh(); } } finally { setBusy(false); } }}>{policy.config.enabled ? 'Pause monitoring' : 'Enable monitoring'}</button>
        <button type="button" className={button} onClick={() => void inspect(policy.id)}>Review runs and notifications</button></div>
      <SignalForm policy={policy} onSaved={async () => { setMessage('Review signal saved. The local scheduler will evaluate it when this policy is enabled and its worker is available.'); await refresh(); await inspect(policy.id); }} />
    </article>)}
    {detail && <section className="space-y-3 rounded border border-line p-4" aria-label="Monitoring history"><h4 className="font-semibold">{detail.policy.config.name}: history</h4>
      {detail.notifications.length > 0 && <ul className="space-y-3">{detail.notifications.map((notification) => <li key={notification.id}><strong>{notification.title}</strong><p>{notification.detail}</p><p className="text-sm">{when(notification.created_at)} · {notification.read_at ? 'Read' : 'Unread'}</p>
        {!notification.read_at && <button type="button" className={button} onClick={async () => { const result = await readMonitoringNotificationAction(notification.id); if (result.ok) await inspect(detail.policy.id); else setError(result.error); }}>Mark notification read</button>}</li>)}</ul>}
      <h5 className="font-semibold">Review runs</h5>{!detail.runs.length && <p>No review run has started.</p>}
      {detail.runs.map((run) => <article className="space-y-2 border-t border-line pt-3" key={run.id}><p>{run.status.replaceAll('_', ' ')} · {when(run.created_at)}</p><ul>{run.reasons.map((reason, index) => <li key={index}>{reason.replaceAll('_', ' ')}</li>)}</ul>
        {run.shared_job_id && <button type="button" className="underline" onClick={() => void onResearch(run.shared_job_id!)}>Inspect shared source research</button>}
        <ul className="space-y-2">{run.asset_reviews.map((review) => <li key={review.asset_id}><Link className="underline" href={`/assets/${review.asset_id}`}>{choices.assets.find((asset) => asset.id === review.asset_id)?.name ?? 'Monitored vehicle'}</Link>: {review.status}{review.outcome ? ` · ${review.outcome.replaceAll('_', ' ')}` : ''}. {review.proposal_id && <span>Proposal available on this vehicle.</span>} {review.job_id && <button type="button" className="underline" onClick={() => void onResearch(review.job_id!)}>Inspect vehicle assessment evidence</button>}</li>)}</ul>
      </article>)}
      <details><summary>Submitted review signals</summary><ul className="space-y-2">{detail.signals.map((signal) => <li key={signal.id}>{when(signal.created_at)} — {signal.kind.replaceAll('_', ' ')}: {signal.reason}. {signal.processed_at ? 'Processed' : 'Waiting for scheduler'}</li>)}</ul></details>
    </section>}
  </section>;
}

function PolicyEditor({ assetId, existing, workers, choices, onClose, onSaved }: { assetId: string; existing?: MonitoringPolicy; workers: ResearchWorker[]; choices: Choices; onClose(): void; onSaved(): Promise<void> }) {
  const available = workers.filter((worker) => worker.capabilities.includes('external_fetch') && worker.allowed_task_types.includes('source_verification') && worker.allowed_task_types.includes('responsibility_review'));
  const [config, setConfig] = useState<MonitoringPolicyConfig>(() => existing?.config ?? { name: '', asset_ids: [assetId], worker_id: available[0]?.id ?? '', enabled: false, question: '', allowed_domains: [], cadence_hours: 720, budget: { timeout_seconds: 300, max_sources: 5, max_requests: 20 }, scope: { rule_ids: [], categories: ['regulatory'] }, notifications: 'meaningful_changes' });
  const [domains, setDomains] = useState(config.allowed_domains.join(', '));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false);
  const creationKey = useRef<string | null>(null);
  const change = (patch: Partial<MonitoringPolicyConfig>) => setConfig((current) => ({ ...current, ...patch }));
  return <form className="space-y-3 rounded border border-line p-4" aria-label="Monitoring policy editor" onChange={() => { creationKey.current = null; }} onSubmit={async (event) => { event.preventDefault(); if (busy) return; setBusy(true); setError(null); creationKey.current ??= crypto.randomUUID(); try {
    const result = await saveMonitoringPolicyAction({ ...config, allowed_domains: domains.split(/[\s,]+/).filter(Boolean).map((domain) => domain.toLowerCase()), ...(!existing ? { creation_key: creationKey.current } : {}) }, existing ? { id: existing.id, revision: existing.revision } : undefined);
    if (result.ok) await onSaved(); else { setError(result.error); setConflict(result.code === 'monitoring_conflict'); }
  } finally { setBusy(false); } }}><fieldset disabled={busy} className="space-y-3"><legend className="font-semibold">{existing ? 'Edit monitoring scope' : 'Create a paused monitoring policy'}</legend>
    <label className="block">Policy name<input className={input} value={config.name} maxLength={200} required onChange={(event) => change({ name: event.target.value })} /></label>
    <label className="block">Question to review<textarea className={input} value={config.question} required maxLength={10000} onChange={(event) => change({ question: event.target.value })} /></label>
    <label className="block">Monitoring worker<select className={input} required value={config.worker_id} onChange={(event) => change({ worker_id: event.target.value })}><option value="">Select a worker</option>{available.map((worker) => <option key={worker.id} value={worker.id}>{worker.name}{worker.enabled ? '' : ' (disabled)'}</option>)}</select></label>
    <label className="block">Allowed source domains<input className={input} value={domains} required onChange={(event) => setDomains(event.target.value)} /></label>
    <fieldset className="space-y-1"><legend>Vehicles to assess separately</legend>{choices.assets.map((asset) => <label className="block" key={asset.id}><input type="checkbox" checked={config.asset_ids.includes(asset.id)} disabled={asset.id === assetId} onChange={(event) => change({ asset_ids: event.target.checked ? [...config.asset_ids, asset.id] : config.asset_ids.filter((id) => id !== asset.id) })} /> {asset.name}{asset.lifecycle === 'active' ? '' : ` (${asset.lifecycle}; checks paused)`}</label>)}<p className="text-sm">Shared source research is retained once; each vehicle receives its own applicability decision and proposal. This page’s vehicle remains included.</p></fieldset>
    <label className="block">Country scope (two-letter code, optional)<input className={input} maxLength={2} pattern="[A-Z]{2}" value={config.scope.country ?? ''} onChange={(event) => change({ scope: { ...config.scope, country: event.target.value.toUpperCase() || undefined } })} /></label>
    <fieldset><legend>Responsibility categories</legend>{(['regulatory', 'service_recommendation', 'user_reminder'] as const).map((category) => <label key={category} className="mr-3 inline-block"><input type="checkbox" checked={config.scope.categories.includes(category)} onChange={(event) => change({ scope: { ...config.scope, categories: event.target.checked ? [...config.scope.categories, category] : config.scope.categories.filter((value) => value !== category) } })} /> {category.replaceAll('_', ' ')}</label>)}</fieldset>
    {choices.rules.length > 0 && <details><summary>Limit to specific responsibility references (optional)</summary>{choices.rules.map((rule) => <label className="block" key={rule.id}><input type="checkbox" checked={config.scope.rule_ids.includes(rule.id)} onChange={(event) => change({ scope: { ...config.scope, rule_ids: event.target.checked ? [...config.scope.rule_ids, rule.id] : config.scope.rule_ids.filter((id) => id !== rule.id) } })} /> {rule.title}</label>)}</details>}
    <div className="grid gap-3 sm:grid-cols-2"><label>Cadence in hours<input className={input} type="number" min={1} max={8760} required value={config.cadence_hours} onChange={(event) => change({ cadence_hours: Number(event.target.value) })} /></label>
      <label>Monitoring run time limit (seconds)<input className={input} type="number" min={10} max={3600} required value={config.budget.timeout_seconds} onChange={(event) => change({ budget: { ...config.budget, timeout_seconds: Number(event.target.value) } })} /></label>
      <label>Monitoring source limit<input className={input} type="number" min={1} max={10} required value={config.budget.max_sources} onChange={(event) => change({ budget: { ...config.budget, max_sources: Number(event.target.value) } })} /></label>
      <label>Monitoring web request limit<input className={input} type="number" min={1} max={100} required value={config.budget.max_requests} onChange={(event) => change({ budget: { ...config.budget, max_requests: Number(event.target.value) } })} /></label></div>
    <label className="block">Monitoring notifications<select className={input} value={config.notifications} onChange={(event) => change({ notifications: event.target.value as typeof config.notifications })}><option value="meaningful_changes">Meaningful changes and failures</option><option value="off">Off</option></select></label>
    <p className="text-sm">Saving {existing ? 'updates this shared policy for every selected vehicle' : 'creates a paused policy; enable it explicitly after reviewing its scope'}. Worker availability and the last successful check are shown separately.</p>
    <button className={button} disabled={conflict || !available.length || !config.asset_ids.length}>Save monitoring policy</button> <button type="button" className={button} onClick={onClose}>Cancel editing</button>
    {conflict && <p role="alert">Your draft is preserved. Refresh monitoring status to inspect the current policy; cancel this draft and reopen the policy before applying a revised choice.</p>}
    {error && <p role="alert">{error}</p>}
  </fieldset></form>;
}

function SignalForm({ policy, onSaved }: { policy: MonitoringPolicy; onSaved(): Promise<void> }) {
  const [kind, setKind] = useState<'manual_review' | 'user_report' | 'source_change'>('manual_review');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = useRef<string | null>(null);
  return <details><summary>Request a review or report a change</summary><form className="space-y-3 pt-3" onChange={() => { key.current = null; }} onSubmit={async (event) => { event.preventDefault(); if (busy) return; setBusy(true); setError(null); key.current ??= crypto.randomUUID(); try { const result = await signalMonitoringAction(policy.id, { operation_key: key.current, kind, reason }); if (result.ok) { setReason(''); key.current = null; await onSaved(); } else setError(result.error); } finally { setBusy(false); } }}>
    <fieldset disabled={busy} className="space-y-2"><label className="block">Review signal<select className={input} value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}><option value="manual_review">Run a review</option><option value="user_report">I learned something new</option><option value="source_change">A source changed</option></select></label>
      <label className="block">Reason for this review<textarea className={input} value={reason} required maxLength={10000} onChange={(event) => setReason(event.target.value)} /></label>
      <button className={button}>Queue review signal</button><p className="text-sm">This records an explicit signal for the local scheduler. A paused policy keeps the signal until you enable it.</p>
      {error && <p role="alert">{error}</p>}
    </fieldset>
  </form></details>;
}
