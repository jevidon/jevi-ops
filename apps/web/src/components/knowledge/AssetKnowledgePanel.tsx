'use client';

import { createClientId } from '../../lib/client-id';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { KnowledgeChangeInput, KnowledgeEffectiveTime, ResponsibilityVersionInput, VehicleTrackingDraft } from '@jevi-ops/shared';
import type { MaintenanceItem } from '@/lib/api';
import { ManualKnowledgeFields, newManualKnowledgeDraft } from './ManualKnowledgeFields';
import { ChangeReview, ReadableValues } from '../onboarding/ChangeReview';
import {
  acceptKnowledgeAction, cancelKnowledgeTransitionAction, createKnowledgeFollowupAction, knowledgeHistoryAction,
  loadKnowledgePanelAction, previewKnowledgeAction, processKnowledgeTransitionsAction, responsibilityHistoryAction, saveResponsibilityAction,
} from './actions';
import type { KnowledgeHistory, KnowledgePanelData, KnowledgePreview, KnowledgeTransition, ResponsibilityRow, ResponsibilityVersion, VehicleAssessment } from './types';

const button = 'rounded border border-line px-3 py-2 text-sm disabled:opacity-50';
const input = 'block w-full rounded border border-line bg-transparent px-3 py-2 text-sm';
const timeLabel = (value: string | null | undefined) => value ? new Date(value).toLocaleString() : 'Not recorded';
const utcInput = (value: string | null | undefined) => value ? new Date(value).toISOString().slice(0, 16) : '';
const asInstant = (value: string) => value ? `${value}:00Z` : undefined;

export function AssetKnowledgePanel({ assetId, meterUnit, items = [], factKeys = [] }: {
  assetId: string; meterUnit?: string | null; items?: MaintenanceItem[]; factKeys?: string[];
}) {
  const [data, setData] = useState<KnowledgePanelData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ assessment?: VehicleAssessment; transition?: KnowledgeTransition } | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    const result = await loadKnowledgePanelAction(assetId);
    if (result.ok) { setData(result.value); setError(null); } else setError(result.error);
  }, [assetId]);
  async function openEditor(choice: { assessment?: VehicleAssessment; transition?: KnowledgeTransition }) {
    if (editing || busy) return;
    setBusy(true); setError(null);
    try {
      // Source originals and assessments may change through another panel on
      // this page. Load them at entry, without replacing an editor already open.
      const result = await loadKnowledgePanelAction(assetId);
      if (!result.ok) { setError(result.error); return; }
      setData(result.value);
      const assessment = choice.assessment ? result.value.assessments.find((row) => row.id === choice.assessment!.id) : undefined;
      const transition = choice.transition ? result.value.transitions.find((row) => row.id === choice.transition!.id) : undefined;
      if ((choice.assessment && !assessment) || (choice.transition && !transition)) { setError('This decision changed. Review the refreshed records before opening it again.'); return; }
      setEditing({ assessment, transition });
    } finally { setBusy(false); }
  }
  useEffect(() => { void refresh(); }, [refresh]);
  return <div className="space-y-4">
    <p className="text-sm">Responsibility references, applicability and maintenance tracking are separate. Unknown information does not block manual records. A tracked reminder is not proof of legal compliance.</p>
    <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={!data || busy || Boolean(editing)} onClick={() => void openEditor({})}>Add a responsibility or reminder</button>
      <button type="button" className={button} disabled={busy} onClick={() => void refresh()}>Refresh knowledge</button>
      <button type="button" className={button} disabled={busy} onClick={async () => { setBusy(true); try { const result = await processKnowledgeTransitionsAction(assetId); if (result.ok) { setNotice('Checked approved pending changes against their effective times and current facts.'); await refresh(); } else setError(result.error); } finally { setBusy(false); } }}>Check due approved changes</button>
    </div>
    {notice && <p role="status">{notice}</p>}{error && <p role="alert">{error}</p>}
    {!data && !error && <p role="status">Loading responsibility records…</p>}
    {editing && data && <KnowledgeEditor key={editing.assessment?.id ?? editing.transition?.id ?? 'new'} assetId={assetId} meterUnit={meterUnit} items={items} factKeys={factKeys} data={data}
      initialAssessment={editing.assessment} initialTransition={editing.transition} onCancel={() => setEditing(null)}
      onSaved={async (message) => { setEditing(null); setNotice(message); await refresh(); }} onDefinitionSaved={refresh} />}
    {data && !data.assessments.length && <p>Applicability has not been established. You can record what you know, leave it unknown or create a reminder without waiting for research.</p>}
    {data?.assessments.map((assessment) => {
      const rule = data.rules.find((r) => r.rule.id === assessment.rule_id);
      const sources = data.sources.filter((s) => assessment.source_ids.includes(s.source_id));
      return <article key={assessment.id} className="space-y-3 rounded border border-line p-4">
        <h3 className="font-semibold">{rule?.version.title ?? 'Retained responsibility reference'}</h3>
        <p><strong>{assessment.applicability === 'unknown' ? 'Applicability not established' : assessment.applicability === 'not_applicable' ? 'Assessed as not applicable' : 'Assessed as applicable'}</strong> · {assessment.review_state.replaceAll('_', ' ')}</p>
        <p className="text-sm">{assessment.knowledge_label}</p><p>{assessment.rationale}</p>
        <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2"><div><dt>Assessed</dt><dd>{timeLabel(assessment.assessed_at)}</dd></div>
          <div><dt>Last meaningful check</dt><dd>{timeLabel(assessment.last_checked_at)}</dd></div><div><dt>Review due</dt><dd>{timeLabel(assessment.review_due_at)}</dd></div>
          <div><dt>Freshness</dt><dd>{assessment.freshness.replaceAll('_', ' ')}</dd></div></dl>
        {assessment.applicability === 'not_applicable' && <p className="text-sm">This is a dated assessment, not a permanent exemption. Review it when relevant facts or references change.</p>}
        {assessment.invalidation_reason && <p role="status">Review needed: {assessment.invalidation_reason}</p>}
        {Object.keys(assessment.relevant_facts).length > 0 && <details><summary>Facts used for this assessment</summary><ReadableValues value={assessment.relevant_facts} /></details>}
        {sources.length > 0 && <ul>{sources.map((source) => <li key={source.id}><a className="underline" href={`/api/sources/${source.id}/content`}>{source.label}</a></li>)}</ul>}
        {assessment.source_ids.length > sources.length && <p className="text-sm">Additional retained evidence remains linked to this reference.</p>}
        {assessment.item_id ? <Link className="underline" href={`/maintenance/${assessment.item_id}`}>Open linked maintenance tracking</Link> : <p className="text-sm">No operational tracking is linked.</p>}
        <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={busy || Boolean(editing)} onClick={() => void openEditor({ assessment })}>Review or update information</button>
          <button type="button" className={button} disabled={busy} onClick={async () => { setBusy(true); try { const result = await createKnowledgeFollowupAction(assetId, assessment.id); if (result.ok) setNotice('A follow-up task is available. Repeating this action reuses the same task.'); else setError(result.error); } finally { setBusy(false); } }}>Create follow-up task</button>
        </div><HistoryPanel kind="assessment" id={assessment.id} />
      </article>;
    })}
    {data && data.transitions.length > 0 && <section className="space-y-3"><h3 className="font-semibold">Approved future changes</h3>
      <p className="text-sm">A pending change activates only when its effective time arrives and the accepted preconditions still match. No worker is needed for that local check. An unknown time stays pending for review.</p>
      {data.transitions.map((transition) => <article key={transition.id} className="space-y-2 rounded border border-line p-3">
        <strong>{data.rules.find((r) => r.rule.id === transition.preconditions?.rule.id || r.version.id === transition.operation.rule_version_id)?.version.title ?? 'Retained responsibility change'}: {transition.status.replaceAll('_', ' ')}</strong>
        <p>Effective: {transition.effective.kind === 'date' ? `${transition.effective.date} · ${transition.effective.timezone ?? 'timezone not established'}` : transition.effective.kind === 'instant' ? timeLabel(transition.effective.at) : 'Time not established'}</p>
        <p className="text-sm">Approved {timeLabel(transition.approved_at)}. {transition.reason}</p>
        {['pending', 'needs_review'].includes(transition.status) && <><button type="button" className={button} disabled={busy || Boolean(editing)} onClick={() => void openEditor({ transition })}>Review against current facts</button>
          <CancelTransition assetId={assetId} transition={transition} refresh={refresh} /></>}
        <HistoryPanel kind="transition" id={transition.id} />
      </article>)}
    </section>}
  </div>;
}

function KnowledgeEditor({ assetId, meterUnit, items, factKeys, data, initialAssessment, initialTransition, onCancel, onSaved, onDefinitionSaved }: {
  assetId: string; meterUnit?: string | null; items: MaintenanceItem[]; factKeys: string[]; data: KnowledgePanelData;
  initialAssessment?: VehicleAssessment; initialTransition?: KnowledgeTransition; onCancel(): void;
  onSaved(message: string): Promise<void>; onDefinitionSaved(): Promise<void>;
}) {
  const existingRule = initialAssessment ? data.rules.find((r) => r.rule.id === initialAssessment.rule_id)
    : data.rules.find((r) => r.rule.id === initialTransition?.preconditions?.rule.id || r.version.id === initialTransition?.operation.rule_version_id);
  const assessment = initialAssessment ?? initialTransition?.operation.assessment;
  const pendingTracking = initialTransition?.operation.tracking;
  const linkedItemId = pendingTracking && pendingTracking.action !== 'create' ? pendingTracking.item_id : initialAssessment?.item_id;
  const linkedItem = items.find((item) => item.id === linkedItemId);
  const trackingSeed = pendingTracking?.action === 'create' ? pendingTracking.item : pendingTracking?.action === 'update' ? { ...linkedItem, ...pendingTracking.patch } : linkedItem;
  const [selected, setSelected] = useState<ResponsibilityRow | null>(existingRule ?? null);
  const [definition, setDefinition] = useState<ResponsibilityVersion | null>(null);
  const [editingDefinition, setEditingDefinition] = useState(!existingRule);
  const [draft, setDraft] = useState<VehicleTrackingDraft>(() => ({ ...newManualKnowledgeDraft(),
    name: existingRule?.version.title ?? '', kind: existingRule?.version.kind ?? 'user_reminder',
    applicability: assessment?.applicability ?? 'unknown', evidence_basis: assessment?.evidence_basis ?? 'user_reported',
    source_ids: assessment?.source_ids ?? [], source_note: assessment?.rationale ?? '',
    track: Boolean(pendingTracking || linkedItem), ...(trackingSeed ? { name: trackingSeed.name ?? existingRule?.version.title ?? '', policy: trackingSeed.policy ?? 'expiry', interval_days: trackingSeed.interval_days,
      interval_months: trackingSeed.interval_months, interval_meter: trackingSeed.interval_meter, next_due_date: trackingSeed.next_due_date, next_due_meter: trackingSeed.next_due_meter,
      lead_days: trackingSeed.lead_days, lead_meter: trackingSeed.lead_meter } : {}),
  }));
  const [referenceStatus, setReferenceStatus] = useState<'accepted' | 'proposed' | 'withdrawn'>('accepted');
  const [country, setCountry] = useState('');
  const [scope, setScope] = useState('');
  const [publishedAt, setPublishedAt] = useState('');
  const [retrievedAt, setRetrievedAt] = useState('');
  const [referenceEffective, setReferenceEffective] = useState<KnowledgeEffectiveTime | undefined>(undefined);
  const [referenceUntil, setReferenceUntil] = useState<KnowledgeEffectiveTime | undefined>(undefined);
  const [reason, setReason] = useState(initialTransition?.operation.reason ?? '');
  const [relevantKeys, setRelevantKeys] = useState(initialAssessment ? Object.keys(initialAssessment.relevant_facts).join(', ') : initialTransition?.operation.assessment.relevant_fact_keys.join(', ') ?? '');
  const [reviewState, setReviewState] = useState<'accepted' | 'unreviewed' | 'needs_review'>(assessment?.review_state ?? 'accepted');
  const [lastCheckedAt, setLastCheckedAt] = useState(utcInput(assessment?.last_checked_at));
  const [reviewDueAt, setReviewDueAt] = useState(utcInput(assessment?.review_due_at));
  const [effective, setEffective] = useState<KnowledgeEffectiveTime | undefined>(initialTransition?.effective);
  const [trackingMode, setTrackingMode] = useState<'create' | 'update' | 'link'>(pendingTracking?.action ?? (linkedItem ? 'update' : 'create'));
  const [itemId, setItemId] = useState(linkedItemId ?? '');
  const [trackingNotes, setTrackingNotes] = useState(trackingSeed?.notes ?? '');
  const [trackingActive, setTrackingActive] = useState(pendingTracking?.action === 'update' ? pendingTracking.patch.active ?? linkedItem?.active ?? true : linkedItem?.active ?? true);
  const [preview, setPreview] = useState<KnowledgePreview | null>(null);
  const key = useRef<string | null>(null);
  const creationKey = useRef<string>(createClientId());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!dirty) return;
    const unload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    const click = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if ((event.target as Element | null)?.closest?.('a[href]') && !window.confirm('Leave with unsaved responsibility inputs?')) { event.preventDefault(); event.stopPropagation(); }
    };
    window.addEventListener('beforeunload', unload); document.addEventListener('click', click, true);
    return () => { window.removeEventListener('beforeunload', unload); document.removeEventListener('click', click, true); };
  }, [dirty]);
  useEffect(() => {
    if (!selected) { setDefinition(null); return; }
    let cancelled = false;
    void (async () => { const result = await responsibilityHistoryAction(selected.rule.id); if (cancelled) return;
      if (result.ok) setDefinition(result.value.versions.find((v) => v.version === selected.rule.current_version) ?? null); else setError(result.error);
    })();
    return () => { cancelled = true; };
  }, [selected]);
  const change = (next: VehicleTrackingDraft) => { setDraft(next); setPreview(null); key.current = null; setDirty(true); };
  const sources = [...new Map([...data.sources.map((source) => [source.source_id, { id: source.source_id, label: source.label }] as const),
    ...draft.source_ids.filter((id) => !data.sources.some((source) => source.source_id === id)).map((id) => [id, { id, label: `Previously retained evidence (${id.slice(0, 8)})` }] as const)]).values()];
  function selectRule(id: string) {
    const rule = data.rules.find((r) => r.rule.id === id) ?? null;
    setSelected(rule); setEditingDefinition(!rule); setDefinition(null); setPreview(null); setDirty(true);
    if (!rule) creationKey.current = createClientId();
    if (rule) setDraft((current) => ({ ...current, name: rule.version.title, kind: rule.version.kind }));
  }
  function selectTrackingItem(id: string) {
    setItemId(id);
    const item = items.find((candidate) => candidate.id === id);
    if (!item) return;
    setTrackingNotes(item.notes ?? ''); setTrackingActive(item.active);
    change({ ...draft, name: item.name, policy: item.policy, interval_days: item.interval_days,
      interval_months: item.interval_months, interval_meter: item.interval_meter, next_due_date: item.next_due_date,
      next_due_meter: item.next_due_meter, lead_days: item.lead_days, lead_meter: item.lead_meter });
  }
  function startEditingReference() {
    if (!definition) return;
    setEditingDefinition(true); setReferenceStatus(definition.status); setCountry(definition.scope?.country ?? ''); setScope(definition.scope?.description ?? '');
    setPublishedAt(utcInput(definition.published_at)); setRetrievedAt(utcInput(definition.retrieved_at));
    setReferenceEffective(definition.effective_from); setReferenceUntil(definition.effective_until);
    change({ ...draft, name: definition.title, kind: definition.kind, source_ids: definition.source_ids ?? [], source_note: definition.source_note ?? '' });
  }
  function makeChange(): KnowledgeChangeInput {
    if (!selected || editingDefinition) throw new Error('Save or select a responsibility reference first.');
    const item = { name: draft.name, asset_id: assetId, policy: draft.policy,
      interval_days: draft.interval_days, interval_months: draft.interval_months, interval_meter: draft.interval_meter,
      next_due_date: draft.next_due_date, next_due_meter: draft.next_due_meter, lead_days: draft.lead_days ?? 0, lead_meter: draft.lead_meter,
      notes: trackingNotes };
    return { asset_id: assetId, rule_version_id: selected.version.id, assessment: {
      applicability: draft.applicability, evidence_basis: draft.evidence_basis, review_state: reviewState,
      rationale: draft.source_note, relevant_fact_keys: relevantKeys.split(',').map((k) => k.trim()).filter(Boolean), source_ids: draft.source_ids,
      last_checked_at: asInstant(lastCheckedAt) ?? null, review_due_at: asInstant(reviewDueAt) ?? null,
    }, ...(draft.track ? { tracking: trackingMode === 'create' ? { action: 'create', item: { ...(pendingTracking?.action === 'create' ? pendingTracking.item : {}), ...item, metadata: { ...(pendingTracking?.action === 'create' ? pendingTracking.item.metadata : {}), evidence_basis: draft.evidence_basis, source_ids: draft.source_ids } } }
      : trackingMode === 'link' ? { action: 'link', item_id: itemId } : { action: 'update', item_id: itemId, patch: { ...(pendingTracking?.action === 'update' && pendingTracking.item_id === itemId ? pendingTracking.patch : {}), ...item, active: trackingActive } } } : {}), reason,
      ...(effective ? { effective } : {}) };
  }
  return <section className="space-y-4 rounded border border-line p-4" aria-label="Edit responsibility" onChange={() => { setDirty(true); setPreview(null); key.current = null; }}>
    <h3 className="font-semibold">{initialAssessment ? 'Update responsibility information' : 'Add a responsibility or reminder'}</h3>
    {initialTransition && <p>This creates a newly reviewed decision from current records. The previous pending or review-needed transition remains visible until you cancel it.</p>}
    {initialTransition && existingRule?.version.id !== initialTransition.operation.rule_version_id && <p>The responsibility reference has a newer version. Review the current definition and retained proposed tracking before approving this replacement decision.</p>}
    <fieldset disabled={busy || Boolean(preview)} className="space-y-4">
      <legend className="sr-only">Responsibility form</legend>
      <label className="block">Responsibility reference<select className={input} value={selected?.rule.id ?? ''} onChange={(event) => selectRule(event.target.value)}><option value="">Create a new reference</option>{data.rules.map((rule) => <option key={rule.rule.id} value={rule.rule.id}>{rule.version.title} — version {rule.rule.current_version}</option>)}</select></label>
      {selected && !editingDefinition && <div className="space-y-2"><p>Using {selected.version.title}, version {selected.version.version}. Its definition is shared across vehicles that reference it.</p>
        <button type="button" className={button} disabled={!definition} onClick={startEditingReference}>Edit shared reference as a new version</button>
        <details><summary>Reference dates and source basis</summary><p>{definition?.source_note ?? 'No source note'}</p><p>Published: {timeLabel(definition?.published_at)}. Retrieved: {timeLabel(definition?.retrieved_at)}.</p></details>
      </div>}
      <ManualKnowledgeFields value={draft} onChange={change} meterUnit={meterUnit} sources={sources} showReference={editingDefinition} showSchedule={trackingMode !== 'link'} />
      {editingDefinition && <div className="space-y-3 rounded border border-line p-3">
        <h4 className="font-semibold">Reference definition</h4><p className="text-sm">Saving creates a durable reference immediately. It does not activate a vehicle obligation. Assessment and tracking use the separate review below.</p>
        <label className="block">Reference status<select className={input} value={referenceStatus} onChange={(event) => setReferenceStatus(event.target.value as typeof referenceStatus)}><option value="accepted">Accepted reference</option><option value="proposed">Proposed or unconfirmed</option><option value="withdrawn">Withdrawn</option></select></label>
        <label className="block">Country scope, if known<input className={input} maxLength={2} value={country} onChange={(event) => setCountry(event.target.value.toUpperCase())} /></label>
        <label className="block">Scope description, if known<textarea className={input} value={scope} onChange={(event) => setScope(event.target.value)} /></label>
        <label className="block">Source published time (UTC, if known)<input className={input} type="datetime-local" value={publishedAt} onChange={(event) => setPublishedAt(event.target.value)} /></label>
        <label className="block">Source retrieved time (UTC, if known)<input className={input} type="datetime-local" value={retrievedAt} onChange={(event) => setRetrievedAt(event.target.value)} /></label>
        <EffectiveTime label="Reference effective from" value={referenceEffective} onChange={setReferenceEffective} />
        <EffectiveTime label="Reference effective until" value={referenceUntil} onChange={setReferenceUntil} />
      </div>}
      <label className="block">Reason for this decision or correction<textarea className={input} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
      {editingDefinition && <button type="button" className={button} onClick={async () => {
        setBusy(true); setError(null);
        try { const body: ResponsibilityVersionInput = { title: draft.name, kind: draft.kind, status: referenceStatus,
          source_ids: draft.source_ids, source_note: draft.source_note, scope: { ...(country ? { country } : {}), ...(scope ? { description: scope } : {}) },
          reason, published_at: asInstant(publishedAt) ?? null, retrieved_at: asInstant(retrievedAt) ?? null,
          ...(referenceEffective ? { effective_from: referenceEffective } : {}), ...(referenceUntil ? { effective_until: referenceUntil } : {}) };
          const result = await saveResponsibilityAction(body, selected ? { id: selected.rule.id, version: selected.rule.current_version } : undefined, creationKey.current);
          if (result.ok) { setSelected({ rule: { id: result.value.version.rule_id, current_version: result.value.version.version }, version: result.value.version }); setDefinition(result.value.version); setEditingDefinition(false); setNotice('Reference definition saved. Review the vehicle assessment and any tracking changes next.'); await onDefinitionSaved(); }
          else setError(result.error);
        } finally { setBusy(false); }
      }}>Save reference definition now</button>}
      <label className="block">Assessment review state<select className={input} value={reviewState} onChange={(event) => setReviewState(event.target.value as typeof reviewState)}><option value="accepted">I accept this assessment</option><option value="unreviewed">Unreviewed</option><option value="needs_review">Needs review</option></select></label>
      <label className="block">Relevant vehicle fact keys (optional, separated by commas)<input className={input} value={relevantKeys} onChange={(event) => setRelevantKeys(event.target.value)} list={`fact-keys-${assetId}`} /><datalist id={`fact-keys-${assetId}`}>{factKeys.map((fact) => <option key={fact} value={fact} />)}</datalist></label>
      <p className="text-sm">Changes to these facts flag the assessment for review. Leave out facts that do not affect this responsibility.</p>
      <label className="block">Last meaningful evidence check (UTC, if known)<input className={input} type="datetime-local" value={lastCheckedAt} onChange={(event) => setLastCheckedAt(event.target.value)} /></label>
      <label className="block">Next knowledge review (UTC, optional)<input className={input} type="datetime-local" value={reviewDueAt} onChange={(event) => setReviewDueAt(event.target.value)} /></label>
      {draft.track && <><label className="block">Tracking action<select className={input} value={trackingMode} onChange={(event) => setTrackingMode(event.target.value as typeof trackingMode)}><option value="create">Create new maintenance tracking</option><option value="update">Update existing tracking with these fields</option><option value="link">Link existing tracking without changing its schedule</option></select></label>
        {trackingMode !== 'create' && <label className="block">Existing maintenance item<select className={input} value={itemId} onChange={(event) => selectTrackingItem(event.target.value)}><option value="">Select tracking item</option>{items.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>}
        {trackingMode !== 'link' && <label className="block">Tracking notes<textarea className={input} value={trackingNotes} onChange={(event) => setTrackingNotes(event.target.value)} /></label>}
        {trackingMode === 'update' && <label className="block"><input type="checkbox" checked={trackingActive} onChange={(event) => setTrackingActive(event.target.checked)} /> Keep this tracking active</label>}
      </>}
      <EffectiveTime label="Apply this accepted vehicle change" value={effective} onChange={setEffective} immediate />
      <button type="button" className={button} disabled={!selected || editingDefinition} onClick={async () => {
        setBusy(true); setError(null);
        try { const result = await previewKnowledgeAction(makeChange()); if (result.ok) { setPreview(result.value.preview); key.current = createClientId(); } else setError(result.error); }
        catch (err) { setError(err instanceof Error ? err.message : 'Check your inputs.'); }
        finally { setBusy(false); }
      }}>Preview assessment and tracking changes</button>
    </fieldset>
    {notice && <p role="status">{notice}</p>}{error && <p role="alert">{error}</p>}
    {preview && <div className="space-y-3 rounded border border-line p-3" aria-label="Review responsibility changes"><h4 className="font-semibold">Review changes before applying</h4>
      <ChangeReview changes={preview.changes} />
      <p className="text-sm">Future changes retain this exact approval and activate only after the local precondition check. Changed facts or tracking require another review.</p>
      <button type="button" className={button} disabled={busy} onClick={async () => { setBusy(true); setError(null); try {
        const result = await acceptKnowledgeAction(assetId, preview, key.current!);
        if (result.ok) { setDirty(false); await onSaved(result.value.receipt.status === 'pending' ? 'Approved future change saved for local activation after its preconditions are checked.' : 'Reviewed assessment and tracking changes applied.'); } else setError(result.error);
      } finally { setBusy(false); } }}>Apply reviewed changes</button> <button type="button" className={button} disabled={busy} onClick={() => setPreview(null)}>Edit and review again</button>
    </div>}
    <button type="button" className={button} disabled={busy} onClick={() => { if (!dirty || window.confirm('Discard unsaved responsibility inputs? Saved reference definitions remain available.')) onCancel(); }}>Close editor</button>
  </section>;
}

function EffectiveTime({ label, value, onChange, immediate = false }: { label: string; value: KnowledgeEffectiveTime | undefined; onChange(value: KnowledgeEffectiveTime | undefined): void; immediate?: boolean }) {
  return <fieldset className="space-y-2 rounded border border-line p-3"><legend>{label}</legend>
    <select aria-label={`${label} time basis`} className={input} value={value?.kind ?? 'none'} onChange={(event) => onChange(event.target.value === 'none' ? undefined : event.target.value === 'date' ? { kind: 'date', date: '' } : event.target.value === 'instant' ? { kind: 'instant', at: '' } : { kind: 'unknown' })}>
      <option value="none">{immediate ? 'Apply now after review' : 'No established effective time'}</option><option value="date">Known date, with explicit timezone</option><option value="instant">Exact instant</option><option value="unknown">Time unknown — retain for review</option>
    </select>
    {value?.kind === 'date' && <><label className="block">Effective date<input className={input} type="date" value={value.date} onChange={(event) => onChange({ ...value, date: event.target.value })} /></label><label className="block">Jurisdiction timezone<input className={input} value={value.timezone ?? ''} placeholder="For example, Pacific/Auckland" onChange={(event) => onChange({ ...value, timezone: event.target.value || undefined })} /></label><p className="text-sm">No timezone is assumed. Automatic activation requires an established timezone.</p></>}
    {value?.kind === 'instant' && <label className="block">Exact effective time in UTC<input className={input} type="datetime-local" value={value.at ? utcInput(value.at) : ''} onChange={(event) => onChange({ kind: 'instant', at: asInstant(event.target.value) ?? '' })} /></label>}
  </fieldset>;
}

function CancelTransition({ assetId, transition, refresh }: { assetId: string; transition: KnowledgeTransition; refresh(): Promise<void> }) {
  const [reason, setReason] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  return <details><summary>Cancel this approved transition</summary><div className="space-y-2"><label className="block">Cancellation reason<input className={input} value={reason} onChange={(event) => setReason(event.target.value)} /></label><button type="button" className={button} disabled={!reason.trim() || busy} onClick={async () => {
    setBusy(true); try { const result = await cancelKnowledgeTransitionAction(assetId, transition.id, transition.revision, reason); if (result.ok) await refresh(); else setError(result.error); } finally { setBusy(false); }
  }}>Cancel pending change</button>{error && <p role="alert">{error}</p>}</div></details>;
}

function HistoryPanel({ kind, id }: { kind: 'assessment' | 'transition'; id: string }) {
  const [history, setHistory] = useState<KnowledgeHistory[] | null>(null); const [error, setError] = useState<string | null>(null);
  return <details onToggle={async (event) => { if (!event.currentTarget.open) return; const result = await knowledgeHistoryAction(kind, id); if (result.ok) setHistory(result.value.history); else setError(result.error); }}>
    <summary>Decision history</summary>{error && <p role="alert">{error}</p>}{history?.map((entry) => <article className="space-y-1 border-b border-line py-3" key={entry.id}>
      <strong>Revision {entry.revision} · {timeLabel(entry.created_at)}</strong><p>{entry.reason}</p><p className="text-sm">Recorded by {entry.actor.replace(/^session:/, '')}</p>
      <details><summary>Recorded decision</summary><ReadableValues value={entry.snapshot} /></details>
    </article>)}
  </details>;
}
