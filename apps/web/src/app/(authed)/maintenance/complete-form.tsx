import type { MaintenanceItem } from '@/lib/api';
import { ActionForm } from './action-form';
import { completeItemAction } from './actions';

// The completion form, adapted to the obligation (0048): an interval
// service takes a date + meter + cost; an expiry renewal records the newly
// issued expiry; a prepaid licence records the purchased end distance; an
// inspection records a finding and a next review. Server component — the
// interactivity lives in ActionForm.

const inputCls = 'border border-line bg-surface px-2 py-1.5 font-sans text-[13px] text-ink';
const labelCls = 'font-mono text-[9px] uppercase tracking-[0.08em] text-ink-3';

export function CompleteForm({ item, today, className = '' }: { item: MaintenanceItem; today: string; className?: string }) {
  const unit = item.asset?.meter_unit ?? null;
  const metered = unit != null;
  const policy = item.policy;
  const verb =
    policy === 'expiry' ? 'Renewed' : policy === 'prepaid_meter' ? 'Purchased' : policy === 'on_condition' ? 'Inspected' : 'Complete';

  return (
    <ActionForm
      action={completeItemAction}
      hidden={{ id: item.id }}
      eventKey
      submit={verb}
      pendingLabel="Recording…"
      className={`flex flex-wrap items-end gap-3 ${className}`}
    >
      <label className="flex flex-col gap-1">
        <span className={labelCls}>{policy === 'on_condition' ? 'Inspected on' : 'Done on'}</span>
        <input type="date" name="completed_on" defaultValue={today} max={today} className={inputCls} />
      </label>

      {metered && policy !== 'on_condition' && (
        <label className="flex flex-col gap-1">
          <span className={labelCls}>{unit} reading</span>
          <input
            type="number"
            name="meter"
            min="0"
            step="any"
            placeholder={item.latest_reading != null ? String(item.latest_reading) : ''}
            className={`${inputCls} w-28`}
          />
        </label>
      )}

      {policy === 'expiry' && (
        <label className="flex flex-col gap-1">
          <span className={labelCls}>New expiry</span>
          <input type="date" name="issued_until" required className={inputCls} />
        </label>
      )}

      {policy === 'prepaid_meter' && (
        <label className="flex flex-col gap-1">
          <span className={labelCls}>Purchased to ({unit})</span>
          <input type="number" name="purchased_to" min="0" step="any" required className={`${inputCls} w-32`} />
        </label>
      )}

      {policy === 'on_condition' && (
        <>
          <label className="flex flex-col gap-1 flex-1 min-w-[160px]">
            <span className={labelCls}>Finding</span>
            <input type="text" name="finding" placeholder="pads at 40%" className={inputCls} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelCls}>Next review (date)</span>
            <input type="date" name="next_review_on" min={today} className={inputCls} />
          </label>
          {metered && (
            <label className="flex flex-col gap-1">
              <span className={labelCls}>…or at ({unit})</span>
              <input type="number" name="next_review_meter" min="0" step="any" className={`${inputCls} w-28`} />
            </label>
          )}
        </>
      )}

      <label className="flex flex-col gap-1">
        <span className={labelCls}>Cost</span>
        <input type="number" name="cost" min="0" step="any" placeholder="—" className={`${inputCls} w-24`} />
      </label>
      <label className="flex flex-col gap-1 flex-1 min-w-[140px]">
        <span className={labelCls}>Notes</span>
        <input type="text" name="notes" placeholder="optional" className={inputCls} />
      </label>
    </ActionForm>
  );
}
