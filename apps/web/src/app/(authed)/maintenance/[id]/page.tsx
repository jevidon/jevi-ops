import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ApiError, assetsApi, domainsApi, maintenanceApi, type MaintenanceLog } from '@/lib/api';
import { ActionForm } from '../action-form';
import { deleteItemAction, deleteLogAction, setBaselineAction, setItemActiveAction } from '../actions';
import { CompleteForm } from '../complete-form';
import { POLICY_LABEL, cadenceLabel, dataLabel, dueDateLabel, meterLabel, statusLabel } from '../format';
import { ItemForm, type AssetOption, type DomainOption } from '../item-form';

// /maintenance/[id] — one item: current schedule state (urgency + data
// confidence), the policy-adapted completion form, the full evidence
// history (baseline + completions, with undo), and the edit form.

export default async function MaintenanceItemPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let data: Awaited<ReturnType<typeof maintenanceApi.get>>;
  try {
    data = await maintenanceApi.get(id);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }
  const { item, logs, today } = data;

  let assets: AssetOption[] = [];
  let domains: DomainOption[] = [];
  try {
    const [a, d] = await Promise.all([assetsApi.list(), domainsApi.list()]);
    assets = a.assets.map(({ id: aid, name, meter_unit }) => ({ id: aid, name, meter_unit }));
    domains = d.domains.map(({ id: did, name }) => ({ id: did, name }));
  } catch {
    /* edit form renders with empty pickers */
  }

  const dateLabel = dueDateLabel(item.next_due_date, today);
  const meter = meterLabel(item);
  const data_ = dataLabel(item);
  const unit = item.asset?.meter_unit ?? '';
  const urgent = item.due_state?.status === 'overdue' || item.due_state?.status === 'due';
  const baseline = logs.find((l) => l.is_baseline) ?? null;
  const needsBaseline = item.due_state?.data === 'needs_baseline' || logs.length === 0;

  return (
    <div className="pb-32">
      {/* ─── Masthead ─────────────────────────────────────────────── */}
      <div className="px-5 lg:px-0 pt-5">
        <Link
          href="/maintenance"
          className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3 hover:text-ink-2 transition-colors mb-2 w-fit"
        >
          <span className="h-[5px] w-[5px] rounded-full bg-accent" aria-hidden />
          From Maintenance
        </Link>
        <h1 className="font-serif text-[28px] font-medium tracking-[-0.4px] text-ink leading-none">
          {item.name}
        </h1>
        <div className="mt-1.5 flex items-center gap-2 flex-wrap font-sans text-[12px] text-ink-3">
          {item.asset && (
            <Link href={`/assets/${item.asset.id}`} className="hover:text-ink-2 transition-colors">
              {item.asset.name}
            </Link>
          )}
          {item.system && <span className="font-mono text-[9px] uppercase tracking-[0.05em] px-1.5 py-px bg-surface-2">{item.system}</span>}
          <span className="font-mono text-[9px] tracking-[0.05em] px-1.5 py-px bg-surface-2">
            ↻ {cadenceLabel(item)}
          </span>
          <span className="font-mono text-[9px] uppercase tracking-[0.05em] px-1.5 py-px bg-surface-2">
            {POLICY_LABEL[item.policy]}
          </span>
          {!item.active && (
            <span className="font-mono text-[9px] uppercase tracking-[0.05em] px-1.5 py-px bg-surface-2">
              paused
            </span>
          )}
        </div>
      </div>

      <div className="hairline mt-4 mx-5 lg:mx-0" />

      {/* ─── Schedule state + completion ──────────────────────────── */}
      <div className="px-5 lg:px-0 mt-5">
        <div className="flex items-baseline gap-4 flex-wrap">
          <span className={`font-mono text-[9.5px] uppercase tracking-[0.08em] ${urgent ? 'text-accent' : 'text-ink-3'}`}>
            {statusLabel(item)}
          </span>
          {dateLabel && <span className="font-mono text-[12px] tabular-nums text-ink">{dateLabel}</span>}
          {meter && <span className="font-mono text-[12px] tabular-nums text-ink">{meter}</span>}
          {data_ && (
            <span className="font-mono text-[10px] tracking-[0.05em] px-1.5 py-px border border-dashed border-line-strong text-ink-3">
              {data_}
            </span>
          )}
          {item.last_completed_on && (
            <span className="font-sans text-[12px] text-ink-3">
              last done {item.last_completed_on}
              {item.last_completed_meter != null
                ? ` at ${item.last_completed_meter.toLocaleString('en-US')} ${unit}`.trimEnd()
                : ''}
            </span>
          )}
        </div>

        <div id="complete" />
        <CompleteForm item={item} today={today} className="mt-4" />
      </div>

      {/* ─── Baseline (seed evidence) ─────────────────────────────── */}
      <div id="baseline" className="px-5 lg:px-0 mt-8">
        <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3 mb-2">Baseline</div>
        <p className="font-sans text-[12.5px] text-ink-3 mb-3">
          {needsBaseline
            ? 'When was this last done, and at what reading? The schedule anchors here — it is seed evidence, not a new service.'
            : 'Seed evidence — "last done on … at …". Editing it re-derives the schedule only while it is the latest evidence.'}
        </p>
        <ActionForm
          action={setBaselineAction}
          hidden={{ id: item.id }}
          submit={baseline ? 'Update baseline' : 'Set baseline'}
          variant={needsBaseline ? 'solid' : 'ghost'}
          pendingLabel="Saving…"
          className="flex flex-wrap items-end gap-3"
        >
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[9px] uppercase tracking-[0.08em] text-ink-3">Last done on</span>
            <input type="date" name="completed_on" required defaultValue={baseline?.completed_on ?? ''} max={today}
              className="border border-line bg-surface px-2 py-1.5 font-sans text-[13px] text-ink" />
          </label>
          {unit && (
            <label className="flex flex-col gap-1">
              <span className="font-mono text-[9px] uppercase tracking-[0.08em] text-ink-3">at ({unit})</span>
              <input type="number" name="meter" min="0" step="any" defaultValue={baseline?.meter_at_completion ?? ''}
                className="w-32 border border-line bg-surface px-2 py-1.5 font-sans text-[13px] text-ink" />
            </label>
          )}
        </ActionForm>
      </div>

      {/* ─── History (evidence) ───────────────────────────────────── */}
      <div className="px-5 lg:px-0 mt-8">
        <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3 mb-2">
          History · {logs.length}
        </div>
        {logs.length === 0 ? (
          <p className="font-sans text-[13px] text-ink-3 italic">
            No evidence yet — the schedule is anchored at the item&rsquo;s creation date.
          </p>
        ) : (
          logs.map((log) => <LogRow key={log.id} log={log} itemId={item.id} unit={unit} />)
        )}
      </div>

      {/* ─── Edit ─────────────────────────────────────────────────── */}
      <div className="px-5 lg:px-0 mt-10">
        <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3 mb-3">Edit</div>
        <ItemForm item={item} assets={assets} domains={domains} />
      </div>

      {/* ─── Lifecycle row ────────────────────────────────────────── */}
      <div className="px-5 lg:px-0 mt-10 flex items-start gap-6 flex-wrap">
        <ActionForm
          action={setItemActiveAction}
          hidden={{ id: item.id, active: item.active ? 'false' : 'true' }}
          submit={item.active ? 'Pause the schedule' : 'Resume'}
          variant="quiet"
          pendingLabel="…"
        />
        <ActionForm
          action={deleteItemAction}
          hidden={{ id: item.id }}
          submit="Delete item + history"
          variant="quiet"
          pendingLabel="Deleting…"
        />
      </div>
    </div>
  );
}

function LogRow({ log, itemId, unit }: { log: MaintenanceLog; itemId: string; unit: string }) {
  const facts: string[] = [];
  if (log.meter_at_completion != null) facts.push(`${log.meter_at_completion.toLocaleString('en-US')} ${unit}`.trim());
  if (log.issued_until) facts.push(`expires ${log.issued_until}`);
  if (log.purchased_to != null) facts.push(`to ${log.purchased_to.toLocaleString('en-US')} ${unit}`.trim());
  if (log.finding) facts.push(log.finding);
  if (log.next_review_on) facts.push(`review ${log.next_review_on}`);
  if (log.next_review_meter != null) facts.push(`review at ${log.next_review_meter.toLocaleString('en-US')} ${unit}`.trim());
  if (log.cost != null) facts.push(`$${log.cost}`);

  return (
    <div className="flex items-baseline gap-3 py-2 border-b border-line group">
      <span className="font-mono text-[12px] tabular-nums text-ink">{log.completed_on}</span>
      {facts.length > 0 && (
        <span className="font-mono text-[11px] tabular-nums text-ink-3">{facts.join(' · ')}</span>
      )}
      {log.notes && !log.is_baseline && (
        <span className="font-sans text-[12px] text-ink-3 flex-1 min-w-0 truncate">{log.notes}</span>
      )}
      <span className="font-mono text-[9px] uppercase tracking-[0.05em] text-ink-3 ml-auto shrink-0">
        {log.is_baseline ? 'baseline' : log.source}
        {log.actor?.startsWith('token:') ? ` · ${log.actor.slice(6)}` : ''}
      </span>
      {log.is_baseline ? (
        <a href="#baseline" className="font-mono text-[10px] text-ink-4 hover:text-ink-2" title="Seed evidence — edit it in the Baseline block; it cannot be deleted.">
          seed · edit
        </a>
      ) : (
        <ActionForm
          action={deleteLogAction}
          hidden={{ id: itemId, log_id: log.id }}
          submit="undo"
          variant="quiet"
          pendingLabel="…"
          className="opacity-60 group-hover:opacity-100 transition-opacity"
        />
      )}
    </div>
  );
}
