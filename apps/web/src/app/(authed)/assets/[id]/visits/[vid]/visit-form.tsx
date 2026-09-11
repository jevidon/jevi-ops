'use client';

import { useActionState, useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';
import type { Attachment, MaintenanceItem } from '@/lib/api';
import { ImageUploader } from '@/components/ImageUploader';
import { completeVisitAction, type SaveResult } from '../../actions';

// The visit form (0051): one date, one odometer, one invoice, and a line
// per item done — each line carrying the evidence its policy needs (an
// expiry renewal at the workshop still needs its new expiry). Everything
// posts as one FormData; the action turns it into one visit, one
// transaction.

const inputCls = 'border border-line bg-surface px-2 py-1.5 font-sans text-[13px] text-ink';
const labelCls = 'font-mono text-[9px] uppercase tracking-[0.08em] text-ink-3';

function mintKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="bg-ink text-bg px-5 py-2.5 font-sans font-semibold text-[12px] uppercase tracking-wider hover:bg-ink-2 transition-colors disabled:opacity-50">
      {pending ? 'Recording…' : label}
    </button>
  );
}

export function VisitForm({
  assetId,
  assetName,
  visitId,
  today,
  unit,
  latestReading,
  items,
  preselected,
  lineNotes,
  provider,
  notes,
}: {
  assetId: string;
  assetName: string;
  visitId: string | null;
  today: string;
  unit: string | null;
  latestReading: number | null;
  items: MaintenanceItem[];
  preselected: string[];
  lineNotes: Record<string, string>;
  provider: string | null;
  notes: string | null;
}) {
  const [state, formAction] = useActionState<SaveResult | null, FormData>(completeVisitAction, null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [done, setDone] = useState<Set<string>>(() => new Set(preselected));
  const [key, setKey] = useState('');
  useEffect(() => {
    setKey(mintKey());
  }, []);

  const toggle = (id: string) =>
    setDone((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <form action={formAction} className="flex flex-col gap-6 max-w-[720px]">
      <input type="hidden" name="asset_id" value={assetId} />
      {visitId && <input type="hidden" name="visit_id" value={visitId} />}
      <input type="hidden" name="item_ids" value={JSON.stringify(items.map((i) => i.id))} />
      {visitId && <input type="hidden" name="planned_ids" value={JSON.stringify(preselected)} />}
      <input type="hidden" name="attachments" value={JSON.stringify(attachments)} />
      <input type="hidden" name="event_key" value={key ? `web:${key}` : ''} />

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className={labelCls}>Visited on</span>
          <input type="date" name="visited_on" defaultValue={today} max={today} required className={inputCls} />
        </label>
        {unit && (
          <>
            <label className="flex flex-col gap-1">
              <span className={labelCls}>{unit} at the visit</span>
              <input type="number" name="meter" min="0" step="any" placeholder={latestReading != null ? String(latestReading) : ''} className={`${inputCls} w-32`} />
            </label>
            <label className="flex items-center gap-2 pb-2 font-sans text-[12px] text-ink-3" title="Allow a lower reading than the last one — only if the meter was replaced.">
              <input type="checkbox" name="allow_decrease" className="accent-accent" />
              meter replaced
            </label>
          </>
        )}
        <label className="flex flex-col gap-1 flex-1 min-w-[160px]">
          <span className={labelCls}>Provider</span>
          <input type="text" name="provider" defaultValue={provider ?? ''} placeholder="who did the work" className={inputCls} />
        </label>
      </div>

      <div>
        <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3 mb-2">What was done</div>
        {items.length === 0 ? (
          <p className="font-sans text-[13px] italic text-ink-3">No tracked items on this asset yet.</p>
        ) : (
          <ul className="border-t border-line">
            {items.map((item) => {
              const on = done.has(item.id);
              const status = item.due_state?.status;
              return (
                <li key={item.id} className="border-b border-line py-3">
                  <label className="flex items-baseline gap-3 cursor-pointer">
                    <input type="checkbox" name={`done_${item.id}`} checked={on} onChange={() => toggle(item.id)} className="accent-accent translate-y-px" />
                    <span className="font-sans text-[14px] text-ink">{item.name}</span>
                    {item.system && <span className="font-mono text-[9px] uppercase tracking-[0.05em] text-ink-4">{item.system}</span>}
                    {status && status !== 'ok' && (
                      <span className={`font-mono text-[9.5px] uppercase tracking-[0.06em] ${status === 'due_soon' ? 'text-ink-3' : 'text-accent'}`}>
                        {status === 'overdue' ? 'Overdue' : status === 'due' ? 'Due' : 'Due soon'}
                      </span>
                    )}
                  </label>
                  {!on && visitId && preselected.includes(item.id) && (
                    <label className="mt-2 ml-7 flex flex-col gap-1 max-w-[420px]">
                      <span className={labelCls}>Skipped — why? (kept on the visit; the item stays due)</span>
                      <input type="text" name={`skip_reason_${item.id}`} placeholder="no time · part on order · not needed yet" className={inputCls} />
                    </label>
                  )}
                  {on && (
                    <div className="mt-2 ml-7 flex flex-wrap items-end gap-3">
                      {item.policy === 'expiry' && (
                        <label className="flex flex-col gap-1">
                          <span className={labelCls}>New expiry</span>
                          <input type="date" name={`issued_until_${item.id}`} required className={inputCls} />
                        </label>
                      )}
                      {item.policy === 'prepaid_meter' && (
                        <label className="flex flex-col gap-1">
                          <span className={labelCls}>Purchased to ({unit})</span>
                          <input type="number" name={`purchased_to_${item.id}`} min="0" step="any" required className={`${inputCls} w-32`} />
                        </label>
                      )}
                      {item.policy === 'on_condition' && (
                        <>
                          <label className="flex flex-col gap-1 flex-1 min-w-[160px]">
                            <span className={labelCls}>Finding</span>
                            <input type="text" name={`finding_${item.id}`} placeholder="pads at 40%" className={inputCls} />
                          </label>
                          <label className="flex flex-col gap-1">
                            <span className={labelCls}>Next review (date)</span>
                            <input type="date" name={`next_review_on_${item.id}`} min={today} className={inputCls} />
                          </label>
                          {unit && (
                            <label className="flex flex-col gap-1">
                              <span className={labelCls}>…or at ({unit})</span>
                              <input type="number" name={`next_review_meter_${item.id}`} min="0" step="any" className={`${inputCls} w-28`} />
                            </label>
                          )}
                        </>
                      )}
                      <label className="flex flex-col gap-1">
                        <span className={labelCls}>Line cost</span>
                        <input type="number" name={`cost_${item.id}`} min="0" step="any" placeholder="—" className={`${inputCls} w-24`} />
                      </label>
                      <label className="flex flex-col gap-1 flex-1 min-w-[160px]">
                        <span className={labelCls}>Notes</span>
                        <input type="text" name={`notes_${item.id}`} defaultValue={lineNotes[item.id] ?? ''} placeholder="parts, what they said" className={inputCls} />
                      </label>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div>
        <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3 mb-2">Invoice</div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className={labelCls}>Invoice number</span>
            <input type="text" name="invoice_number" className={`${inputCls} w-36`} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelCls}>Total</span>
            <input type="number" name="total" min="0" step="any" placeholder="—" className={`${inputCls} w-28`} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelCls}>Currency</span>
            <input type="text" name="currency" maxLength={3} placeholder="NZD" className={`${inputCls} w-20 uppercase`} />
          </label>
        </div>
        <p className="mt-1.5 font-sans text-[12px] text-ink-4">The invoice total is what you paid; the line costs above are how you split it. Spend reports use the total.</p>
        <div className="mt-3">
          <ImageUploader attachments={attachments} onChange={setAttachments} prefix="assets" label="Add invoice photo" titleHint={() => `${assetName} invoice`} />
        </div>
      </div>

      <label className="flex flex-col gap-1">
        <span className={labelCls}>Notes</span>
        <textarea name="notes" rows={2} defaultValue={notes ?? ''} placeholder="what they found, what to watch" className={inputCls} />
      </label>

      {state && !state.ok && <p role="alert" className="font-sans text-[12px] text-accent">{state.error}</p>}

      <div className="flex items-center gap-4">
        <Submit label={visitId ? 'Record the visit' : 'Log the visit'} />
        <a href={`/assets/${assetId}#visits`} className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3 hover:text-ink-2">Cancel</a>
      </div>
    </form>
  );
}
