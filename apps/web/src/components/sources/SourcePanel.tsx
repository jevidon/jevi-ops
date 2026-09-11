'use client';
import { createContext, useContext, useId, useCallback, useEffect, useRef, useState, useTransition } from 'react';
import type { CompleteVisitBody, MaintenanceItem, Visit, VisitLineInput } from '@/lib/api';
import type { SourceCandidate, SourceCandidateRow, SourceSubject, SourceWithCandidates } from './types';
import { acceptSourceCandidateAction, addSourceAction, loadSourcesAction, removeSourceAction, removeSourceCandidateAction, saveSourceCandidateAction } from './actions';

const input = 'block w-full border border-line bg-transparent px-2 py-1.5 text-sm text-ink';
const button = 'border border-line px-3 py-2 text-sm text-ink disabled:opacity-40 hover:border-ink';
const numberOrNull = (value: string) => value.trim() === '' ? null : Number(value);
const newKey = () => crypto.randomUUID();
type Guard = { dirty?: boolean; busy?: boolean };
const SourceGuardContext = createContext<(id: string, patch: Guard | null) => void>(() => {});
function useSourceGuard(pending: boolean) {
  const id = useId();
  const update = useContext(SourceGuardContext);
  useEffect(() => { update(id, { busy: pending }); }, [id, pending, update]);
  useEffect(() => () => update(id, null), [id, update]);
  return { markDirty: () => update(id, { dirty: true }), markClean: () => update(id, { dirty: false }) };
}
export interface SourcePanelProps {
  subject: SourceSubject;
  meterUnit?: string | null;
  items?: MaintenanceItem[];
  visits?: Visit[];
  today?: string;
  initialSources?: SourceWithCandidates[];
  onDirtyChange?: (dirty: boolean) => void;
  onBusyChange?: (busy: boolean) => void;
}
/** The same source/candidate workflow attaches to a draft session or a saved
 *  asset. Draft sources are retained immediately; actual history waits for
 *  the vehicle commit and an explicit reviewed import. */
export function SourcePanel({ subject, meterUnit = null, items = [], visits = [], today, initialSources, onDirtyChange, onBusyChange }: SourcePanelProps) {
  const [guards, setGuards] = useState<Record<string, Guard>>({});
  const updateGuard = useCallback((id: string, patch: Guard | null) => setGuards((old) => {
    if (patch === null) { if (!(id in old)) return old; const next = { ...old }; delete next[id]; return next; }
    if (Object.entries(patch).every(([key, value]) => old[id]?.[key as keyof Guard] === value)) return old;
    return { ...old, [id]: { ...old[id], ...patch } };
  }), []);
  const anyDirty = Object.values(guards).some((g) => g.dirty);
  const anyBusy = Object.values(guards).some((g) => g.busy);
  useEffect(() => { onDirtyChange?.(anyDirty); }, [anyDirty, onDirtyChange]);
  useEffect(() => { onBusyChange?.(anyBusy); }, [anyBusy, onBusyChange]);
  const callbacks = useRef({ onDirtyChange, onBusyChange }); callbacks.current = { onDirtyChange, onBusyChange };
  useEffect(() => () => { callbacks.current.onDirtyChange?.(false); callbacks.current.onBusyChange?.(false); }, []);
  useEffect(() => {
    if (!anyDirty && !anyBusy) return;
    const leaving = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', leaving);
    return () => window.removeEventListener('beforeunload', leaving);
  }, [anyDirty, anyBusy]);
  const [sources, setSources] = useState<SourceWithCandidates[]>(initialSources ?? []);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(Boolean(initialSources));
  const assetId = subject.asset_id;
  const sessionId = subject.session_id;
  const refresh = useCallback(async () => {
    const result = await loadSourcesAction(assetId ? { asset_id: assetId } : { session_id: sessionId! });
    if (result.sources) { setSources(result.sources); setError(null); } else setError(result.error ?? 'Sources are unavailable.');
    setLoaded(true);
  }, [assetId, sessionId]);
  useEffect(() => { if (!initialSources) void refresh(); }, [initialSources, refresh]);
  return <SourceGuardContext.Provider value={updateGuard}><div className="flex flex-col gap-5">
    <p className="text-sm text-ink-3">Keep original receipts, manuals and notes here. Files stay private and require your signed-in session to download. Automatic extraction is unavailable; you can enter and review historical records yourself. External links are retained without fetching their contents.</p>
    <AddSource subject={subject} onSaved={refresh} />
    {error && <p role="alert" className="text-accent text-sm">{error} <button type="button" onClick={() => void refresh()} className="underline">Reload sources</button></p>}
    {!loaded ? <p className="text-sm">Loading retained sources…</p> : sources.length === 0 && !error ? <p className="text-sm text-ink-3">No sources retained yet. Missing history is valid; add evidence whenever you have it.</p> : null}
    {sources.map((source) => <SourceCard key={source.id} source={source} subject={subject} meterUnit={meterUnit} items={items} visits={visits} today={today} onChanged={refresh} />)}
  </div></SourceGuardContext.Provider>;
}
function AddSource({ subject, onSaved }: { subject: SourceSubject; onSaved: () => Promise<void> }) {
  const [kind, setKind] = useState<'file' | 'text' | 'link'>('file');
  const [label, setLabel] = useState('');
  const [content, setContent] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const guard = useSourceGuard(pending);
  const fileInput = useRef<HTMLInputElement>(null);
  function submit(event: React.FormEvent) {
    event.preventDefault();
    start(async () => {
      try {
        if (kind === 'file') {
          if (!file || file.size === 0 || file.size > 25 * 1024 * 1024) { setMessage('Choose a nonempty file up to 25 MB.'); return; }
          const body = new FormData();
          const suffix = file.name.split('.').pop()?.toLowerCase();
          const fallbackMime = suffix === 'md' ? 'text/markdown' : suffix === 'txt' ? 'text/plain' : file.type;
          const upload = !file.type && fallbackMime ? new File([file], file.name, { type: fallbackMime }) : file;
          body.append('file', upload, file.name);
          const response = await fetch(`/api/sources/upload?${new URLSearchParams(subject as Record<string, string>)}`, { method: 'POST', body });
          const result = await response.json() as { error?: string; message?: string };
          if (!response.ok) { setMessage(result.message ?? result.error ?? 'Upload failed.'); return; }
        } else {
          const result = await addSourceAction({ subject, label, kind, ...(kind === 'text' ? { text: content } : { url: content }) });
          if ('error' in result) { setMessage(result.error ?? 'Source could not be saved.'); return; }
        }
        setLabel(''); setContent(''); setFile(null);
        if (fileInput.current) fileInput.current.value = '';
        guard.markClean();
        setMessage('Original source retained. Review its historical records below.');
        await onSaved();
      } catch { setMessage('Connection interrupted. Reload the sources to check whether this upload was retained before retrying.'); }
    });
  }
  return <form onSubmit={submit} onChange={guard.markDirty} className="border border-line p-4 flex flex-col gap-3">
    <fieldset disabled={pending} className="flex flex-col gap-3">
      <legend className="font-semibold">Retain a source</legend>
      <label>Source type<select className={input} value={kind} onChange={(e) => { setKind(e.target.value as typeof kind); setContent(''); setMessage(null); }}><option value="file">Upload a file</option><option value="text">Paste source text</option><option value="link">Retain a reference link</option></select></label>
      {kind === 'file' ? <label>Original file<input ref={fileInput} className={input} type="file" accept="application/pdf,image/jpeg,image/png,image/webp,text/plain,text/markdown,.md,.txt" onChange={(e) => setFile(e.target.files?.[0] ?? null)} required /><span className="text-xs text-ink-3">PDF, JPEG, PNG, WebP, UTF-8 text or Markdown. Maximum 25 MB.</span></label> : <>
        <label>Source label<input className={input} maxLength={255} value={label} onChange={(e) => setLabel(e.target.value)} required /></label>
        <label>{kind === 'text' ? 'Original source text' : 'Reference URL'}{kind === 'text' ? <textarea className={input} rows={5} maxLength={200000} value={content} onChange={(e) => setContent(e.target.value)} required /> : <input className={input} type="url" value={content} onChange={(e) => setContent(e.target.value)} required />}</label>
      </>}
      <button className={button} type="submit">{pending ? 'Retaining…' : 'Retain original source'}</button>
    </fieldset>
    {message && <p role="status" className="text-sm">{message}</p>}
  </form>;
}
function SourceCard({ source, subject, meterUnit, items, visits, today, onChanged }: { source: SourceWithCandidates; subject: SourceSubject; meterUnit: string | null; items: MaintenanceItem[]; visits: Visit[]; today?: string; onChanged: () => Promise<void> }) {
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const guard = useSourceGuard(pending);
  return <article className="border border-line p-4 flex flex-col gap-3">
    <div className="flex justify-between gap-3"><h4 className="font-semibold break-words">{source.label}</h4><a className="text-sm underline shrink-0" href={`/api/sources/${source.id}/content`}>Download original</a></div>
    <p className="text-xs text-ink-3">Retained {new Date(source.received_at).toLocaleString()} · {source.media_type} · {source.size_bytes.toLocaleString()} bytes · {source.processing_status}</p>
    <details><summary className="text-xs cursor-pointer">Source identity</summary><p className="text-xs break-all">Source {source.source_id}<br />Association {source.id}<br />SHA-256 {source.content_hash}</p></details>
    {source.kind === 'link' && source.url && <a href={source.url} target="_blank" rel="noreferrer noopener" className="underline text-sm break-all">Open the retained external reference</a>}
    {source.candidates.length === 0 && <p className="text-sm text-ink-3">No historical records proposed from this source.</p>}
    {source.candidates.map((candidate) => <CandidateCard key={`${candidate.id}:${candidate.revision}`} candidate={candidate} source={source} subject={subject} meterUnit={meterUnit} items={items} visits={visits} today={today} onChanged={onChanged} />)}
    {adding ? <CandidateEditor sourceId={source.id} subject={subject} onSaved={async () => { setAdding(false); await onChanged(); }} onCancel={() => setAdding(false)} /> : <button type="button" className={button} onClick={() => setAdding(true)}>Propose a historical record</button>}
    {removing ? <div className="text-sm"><p>Remove this source association and its unaccepted drafts? Accepted historical evidence must remain linked.</p><button type="button" className={button} disabled={pending} onClick={() => start(async () => { const result = await removeSourceAction(source.id, subject); if ('error' in result) setMessage(result.error ?? 'Remove failed.'); else await onChanged(); })}>Remove association</button> <button type="button" className={button} onClick={() => setRemoving(false)}>Keep source</button></div> : <button type="button" className="text-xs underline self-start" onClick={() => setRemoving(true)}>Remove source association…</button>}
    {message && <p role="alert" className="text-sm text-accent">{message}</p>}
  </article>;
}
function CandidateEditor({ sourceId, subject, existing, onSaved, onCancel }: { sourceId: string; subject: SourceSubject; existing?: SourceCandidateRow; onSaved: () => Promise<void>; onCancel: () => void }) {
  const initial = existing?.candidate;
  const [label, setLabel] = useState(initial?.label ?? '');
  const [dateText, setDateText] = useState(initial?.date_text ?? '');
  const [precision, setPrecision] = useState<SourceCandidate['date_precision']>(initial?.date_precision ?? 'unknown');
  const [reading, setReading] = useState(initial?.original_reading == null ? '' : String(initial.original_reading));
  const [unit, setUnit] = useState(initial?.original_unit ?? '');
  const [location, setLocation] = useState(initial?.source_location ?? '');
  const [span, setSpan] = useState(initial?.original_span ?? '');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [key] = useState(newKey);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const guard = useSourceGuard(pending);
  function submit(event: React.FormEvent) {
    event.preventDefault();
    start(async () => {
      const candidate: SourceCandidate = { ...initial, label, date_text: dateText || null, date_precision: precision,
        original_reading: numberOrNull(reading), original_unit: unit === 'km' || unit === 'mi' ? unit : null,
        source_location: location || null, original_span: span || null, notes: notes || null };
      const result = await saveSourceCandidateAction(sourceId, subject, candidate, key, existing ? { id: existing.id, revision: existing.revision } : undefined);
      if ('error' in result) setMessage(result.error ?? 'Candidate save failed.'); else { guard.markClean(); await onSaved(); }
    });
  }
  return <form onSubmit={submit} onChange={guard.markDirty} className="border border-line p-3 flex flex-col gap-3"><fieldset disabled={pending} className="flex flex-col gap-3"><legend className="font-semibold">{existing ? 'Edit retained evidence' : 'Propose historical evidence'}</legend>
    <p className="text-sm text-ink-3">This saves a reviewable draft. It does not complete maintenance or create a reading.</p>
    <label>Work described<input className={input} value={label} onChange={(e) => setLabel(e.target.value)} required maxLength={255} /></label>
    <div className="grid sm:grid-cols-2 gap-3"><label>Date written on the source<input className={input} value={dateText} onChange={(e) => setDateText(e.target.value)} placeholder="For example March 2024; leave blank if unknown" /></label><label>Date precision<select className={input} value={precision} onChange={(e) => setPrecision(e.target.value as typeof precision)}><option value="unknown">Unknown</option><option value="year">Year only</option><option value="month">Month only</option><option value="exact">Exact date</option></select></label></div>
    <div className="grid sm:grid-cols-2 gap-3"><label>Original odometer reading<input className={input} type="number" min="0" step="0.01" value={reading} onChange={(e) => setReading(e.target.value)} /></label><label>Unit written on the source<select className={input} value={unit} onChange={(e) => setUnit(e.target.value)}><option value="">Unknown</option><option value="km">Kilometres</option><option value="mi">Miles</option></select></label></div>
    <label>Source page, line or section<input className={input} value={location} onChange={(e) => setLocation(e.target.value)} /></label>
    <label>Original supporting text<textarea className={input} rows={3} value={span} onChange={(e) => setSpan(e.target.value)} /></label>
    <label>Uncertainty and review notes<textarea className={input} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
    <div className="flex gap-2"><button className={button} type="submit">Save candidate</button><button className={button} type="button" onClick={onCancel}>Cancel</button></div>
  </fieldset>{message && <p role="alert" className="text-accent text-sm">{message}</p>}</form>;
}
function CandidateCard({ candidate, source, subject, meterUnit, items, visits, today, onChanged }: { candidate: SourceCandidateRow; source: SourceWithCandidates; subject: SourceSubject; meterUnit: string | null; items: MaintenanceItem[]; visits: Visit[]; today?: string; onChanged: () => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const guard = useSourceGuard(pending);
  const c = candidate.candidate;
  return <div className="border-t border-line pt-3 flex flex-col gap-2">
    <h5 className="font-semibold">{c.label} <span className="text-xs font-normal">{candidate.status} · revision {candidate.revision}</span></h5>
    <p className="text-sm">Source date: {c.date_text || 'unknown'} ({c.date_precision}). Original reading: {c.original_reading == null ? 'unknown' : `${c.original_reading.toLocaleString()} ${c.original_unit ?? '(unit unknown)'}`}.</p>
    {c.source_location && <p className="text-sm">Source location: {c.source_location}</p>}
    {c.original_span && <blockquote className="border-l-2 border-line pl-3 text-sm whitespace-pre-wrap">{c.original_span}</blockquote>}
    {c.notes && <p className="text-sm whitespace-pre-wrap">{c.notes}</p>}
    {candidate.receipt && <p className="text-sm">Historical work recorded{candidate.receipt.accepted_at ? ` on ${new Date(candidate.receipt.accepted_at).toLocaleString()}` : ''}. {candidate.receipt.visit_id && subject.asset_id && <a className="underline" href={`/assets/${subject.asset_id}/visits/${candidate.receipt.visit_id}`}>Open recorded service visit</a>} The same source cannot create that event again.</p>}
    {candidate.status === 'pending' && !editing && !reviewing && <div className="flex flex-wrap gap-2"><button type="button" className={button} onClick={() => setEditing(true)}>Edit evidence</button><button type="button" className={button} disabled={!subject.asset_id} onClick={() => setReviewing(true)}>Review for historical recording</button><button type="button" className={button} disabled={pending} onClick={() => start(async () => { const result = await removeSourceCandidateAction(candidate.id, candidate.revision, subject); if ('error' in result) setMessage(result.error ?? 'Remove failed.'); else await onChanged(); })}>Discard candidate</button></div>}
    {!subject.asset_id && candidate.status === 'pending' && <p className="text-sm text-ink-3">Save the vehicle first, then review and record this history from its Sources panel. The original evidence stays with your setup draft.</p>}
    {editing && <CandidateEditor sourceId={source.id} subject={subject} existing={candidate} onSaved={onChanged} onCancel={() => setEditing(false)} />}
    {reviewing && <HistoricalReview candidate={candidate} subject={subject} meterUnit={meterUnit} items={items} visits={visits} today={today} onAccepted={onChanged} onCancel={() => setReviewing(false)} />}
    {message && <p role="alert" className="text-sm text-accent">{message}</p>}
  </div>;
}
function HistoricalReview({ candidate, subject, meterUnit, items, visits, today, onAccepted, onCancel }: { candidate: SourceCandidateRow; subject: SourceSubject; meterUnit: string | null; items: MaintenanceItem[]; visits: Visit[]; today?: string; onAccepted: () => Promise<void>; onCancel: () => void }) {
  const c = candidate.candidate;
  const mixed = c.original_unit != null && c.original_unit !== meterUnit;
  const [visitedOn, setVisitedOn] = useState(c.date_precision === 'exact' && /^\d{4}-\d{2}-\d{2}$/.test(c.date_text ?? '') ? c.date_text! : '');
  const [dateConfirmed, setDateConfirmed] = useState(false);
  const [meter, setMeter] = useState(!mixed && c.original_reading != null ? String(c.original_reading) : '');
  const [conversionConfirmed, setConversionConfirmed] = useState(false);
  const [provider, setProvider] = useState(c.visit?.provider ?? '');
  const [invoice, setInvoice] = useState(c.visit?.invoice_number ?? '');
  const [currency, setCurrency] = useState(c.visit?.currency ?? '');
  const [total, setTotal] = useState(c.visit?.total == null ? '' : String(c.visit.total));
  const [notes, setNotes] = useState(c.visit?.notes ?? '');
  const [lines, setLines] = useState<VisitLineInput[]>(c.visit?.lines ?? []);
  const [reviewed, setReviewed] = useState(false);
  const [receiptKey] = useState(newKey);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const guard = useSourceGuard(pending);
  const duplicateVisits = visits.filter((v) => v.status === 'done' && ((visitedOn && v.visited_on === visitedOn) || (invoice && v.invoice_number?.toLowerCase() === invoice.toLowerCase())));
  const conversion = c.original_reading == null || !mixed ? null : c.original_unit === 'mi' && meterUnit === 'km' ? c.original_reading * 1.609344 : c.original_unit === 'km' && meterUnit === 'mi' ? c.original_reading / 1.609344 : null;
  const dateNeedsConfirm = c.date_precision !== 'exact' || visitedOn !== c.date_text;
  function updateLine(id: string, patch: Partial<VisitLineInput>) { setLines((old) => old.map((line) => line.item_id === id ? { ...line, ...patch } : line)); setReviewed(false); }
  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!reviewed) { setMessage('Review the selected work and possible duplicates before recording.'); return; }
    if ((total !== '' || lines.some((line) => line.cost != null)) && !/^[A-Z]{3}$/.test(currency)) { setMessage('Enter the original invoice currency before recording a known cost. Leave unknown costs blank.'); return; }
    start(async () => {
      const visit: CompleteVisitBody & { visited_on: string } = { visited_on: visitedOn, meter: numberOrNull(meter), provider: provider || null,
        invoice_number: invoice || null, currency: currency || null, total: numberOrNull(total), notes: notes || null, lines };
      const result = await acceptSourceCandidateAction(candidate.id, subject, { expected_revision: candidate.revision, operation_key: receiptKey, visit, date_confirmed: dateConfirmed, unit_conversion_confirmed: conversionConfirmed });
      if ('error' in result) setMessage(result.error ?? 'History could not be recorded.'); else { guard.markClean(); await onAccepted(); }
    });
  }
  return <form onSubmit={submit} className="border border-line p-3 flex flex-col gap-3" onChange={() => { setReviewed(false); guard.markDirty(); }}><fieldset disabled={pending} className="flex flex-col gap-3"><legend className="font-semibold">Review historical recording</legend>
    <p className="text-sm">Record only work evidenced by this source. Existing schedules and current tasks are preserved. One visit shares one actual date and reading across every selected line.</p>
    <label>Actual service date<input className={input} type="date" max={today} value={visitedOn} onChange={(e) => { setVisitedOn(e.target.value); setDateConfirmed(false); }} required /></label>
    {dateNeedsConfirm && <label className="text-sm"><input type="checkbox" checked={dateConfirmed} onChange={(e) => setDateConfirmed(e.target.checked)} required /> I confirmed this exact service date; the original source date remains approximate or different.</label>}
    <label>Accepted odometer ({meterUnit ?? 'unit not set'})<input className={input} type="number" min="0" step="0.01" disabled={!meterUnit} value={meter} onChange={(e) => { setMeter(e.target.value); setConversionConfirmed(false); }} /><span className="text-xs text-ink-3">Leave blank to retain the original reading only as evidence.</span></label>
    {mixed && <div className="text-sm"><p>Original: {c.original_reading ?? 'unknown'} {c.original_unit}. Vehicle ledger: {meterUnit ?? 'not set'}. {conversion != null ? `Converted: ${conversion.toFixed(2)} ${meterUnit}.` : 'A compatible conversion is unavailable.'}</p>{conversion != null && <button type="button" className={button} onClick={() => { setMeter(conversion.toFixed(2)); setConversionConfirmed(false); guard.markDirty(); }}>Use this converted value</button>}{meter !== '' && <label className="block"><input type="checkbox" checked={conversionConfirmed} onChange={(e) => setConversionConfirmed(e.target.checked)} required /> I reviewed the original units and this conversion.</label>}</div>}
    <div className="grid sm:grid-cols-2 gap-3"><label>Service provider<input className={input} value={provider} onChange={(e) => setProvider(e.target.value)} /></label><label>Invoice number<input className={input} value={invoice} onChange={(e) => setInvoice(e.target.value)} /></label><label>Original currency<input className={input} maxLength={3} placeholder="Unknown until confirmed" value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} /></label><label>Invoice total<input className={input} type="number" min="0" step="0.01" value={total} onChange={(e) => setTotal(e.target.value)} placeholder="Blank means unknown" /></label></div>
    <p className="text-sm text-ink-3">Invoice total and allocated line costs are separate. Foreign currency is preserved and never converted.</p>
    <fieldset className="flex flex-col gap-3"><legend className="font-semibold">Work evidenced by this source</legend>{items.length === 0 && <p className="text-sm">Create the relevant maintenance items in the vehicle’s Service schedule first, then return to this candidate. Its evidence is retained.</p>}{items.map((item) => {
      const line = lines.find((l) => l.item_id === item.id);
      return <div key={item.id} className="border border-line p-2"><label><input type="checkbox" checked={Boolean(line)} onChange={(e) => setLines((old) => e.target.checked ? [...old, { item_id: item.id }] : old.filter((l) => l.item_id !== item.id))} /> {item.name} <span className="text-xs">({item.policy})</span></label>{line && <div className="grid sm:grid-cols-2 gap-2 mt-2">
        <label>Allocated cost<input className={input} type="number" min="0" step="0.01" value={line.cost ?? ''} onChange={(e) => updateLine(item.id, { cost: numberOrNull(e.target.value) })} /></label><label>Line notes<input className={input} value={line.notes ?? ''} onChange={(e) => updateLine(item.id, { notes: e.target.value || null })} /></label>
        {item.policy === 'expiry' && <label>Expiry issued by this historical renewal<input className={input} type="date" value={line.issued_until ?? ''} onChange={(e) => updateLine(item.id, { issued_until: e.target.value || null })} required /></label>}
        {item.policy === 'prepaid_meter' && <label>Coverage purchased through ({meterUnit})<input className={input} type="number" min="0" step="0.01" value={line.purchased_to ?? ''} onChange={(e) => updateLine(item.id, { purchased_to: numberOrNull(e.target.value) })} required /></label>}
        {item.policy === 'on_condition' && <><label>Inspection finding<input className={input} value={line.finding ?? ''} onChange={(e) => updateLine(item.id, { finding: e.target.value || null })} required /></label><label>Review date stated at that inspection<input className={input} type="date" value={line.next_review_on ?? ''} onChange={(e) => updateLine(item.id, { next_review_on: e.target.value || null })} /></label><label>Review reading stated at that inspection<input className={input} type="number" min="0" step="0.01" value={line.next_review_meter ?? ''} onChange={(e) => updateLine(item.id, { next_review_meter: numberOrNull(e.target.value) })} /></label></>}
      </div>}</div>;
    })}</fieldset>
    <label>Visit notes<textarea className={input} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
    <div className="border border-line p-3 text-sm"><h6 className="font-semibold">Duplicate review</h6>{duplicateVisits.length ? <><p>Existing visits share this date or invoice. Review them before adding another event:</p><ul>{duplicateVisits.map((v) => <li key={v.id}><a className="underline" href={`/assets/${v.asset_id}/visits/${v.id}`}>{v.visited_on} · {v.invoice_number || v.provider || 'Service visit'}</a> · {v.meter ?? 'unknown reading'} {meterUnit} · {v.lines.map((line) => line.item?.name).filter(Boolean).join(', ')}</li>)}</ul></> : <p>No existing visit shares the entered date or invoice. This is a comparison aid; review the original evidence for duplicates.</p>}</div>
    <p className="text-sm">Ready to record: {lines.length} work line(s), date {visitedOn || 'not set'}, reading {meter || 'not supplied'} {meterUnit}, invoice {total || 'unknown'} {currency || '(currency unspecified)'}.</p>
    <label className="text-sm" onChange={(event) => event.stopPropagation()}><input type="checkbox" checked={reviewed} onChange={(e) => { setReviewed(e.target.checked); guard.markDirty(); }} required /> I reviewed the source, selected work, date, units and possible duplicate visits. Record this historical event.</label>
    <div className="flex gap-2"><button type="submit" className={button} disabled={!reviewed || lines.length === 0 || !visitedOn || (dateNeedsConfirm && !dateConfirmed) || (mixed && meter !== '' && !conversionConfirmed)}>Record reviewed history</button><button type="button" className={button} onClick={onCancel}>Keep candidate for later</button></div>
  </fieldset>{message && <p role="alert" className="text-accent text-sm">{message}</p>}</form>;
}
