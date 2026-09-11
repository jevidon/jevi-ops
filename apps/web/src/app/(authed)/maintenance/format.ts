import type { MaintenanceDataState, MaintenanceItem, MaintenancePolicy } from '@/lib/api';

// Display helpers shared by the maintenance pages. Pure formatting — the
// due-ness math itself is server-side (shared maintenanceDueState) and
// arrives on the wire as item.due_state.

export const POLICY_LABEL: Record<MaintenancePolicy, string> = {
  interval: 'Interval',
  expiry: 'Expiry',
  prepaid_meter: 'Prepaid distance',
  on_condition: 'On condition',
};

export function cadenceLabel(item: MaintenanceItem): string {
  const parts: string[] = [];
  if (item.interval_days != null) {
    parts.push(item.interval_days === 1 ? 'daily' : `every ${item.interval_days} days`);
  } else if (item.interval_months != null) {
    parts.push(
      item.interval_months === 1
        ? 'monthly'
        : item.interval_months === 3
          ? 'quarterly'
          : item.interval_months === 12
            ? 'yearly'
            : `every ${item.interval_months} months`,
    );
  }
  if (item.interval_meter != null) {
    parts.push(`every ${item.interval_meter.toLocaleString('en-US')} ${item.asset?.meter_unit ?? ''}`.trim());
  }
  if (parts.length === 0) {
    if (item.policy === 'on_condition') return 'inspect';
    if (item.policy === 'prepaid_meter') return 'prepaid';
    if (item.policy === 'expiry') return 'expiry';
    return '—';
  }
  const joined = parts.join(' or ');
  return item.policy === 'expiry' ? `renews ${joined}` : joined;
}

// "today" / "12d over" / "in 3w" — relative phrasing reads instantly.
export function dueDateLabel(due: string | null | undefined, today: string): string | null {
  if (!due) return null;
  const days = Math.round(
    (Date.parse(due + 'T12:00:00Z') - Date.parse(today + 'T12:00:00Z')) / 86_400_000,
  );
  const date = due.slice(5).replace('-', '/');
  if (days === 0) return 'today';
  if (days < 0) return `${date} · ${-days}d over`;
  if (days < 14) return `${date} · in ${days}d`;
  if (days < 70) return `${date} · in ${Math.round(days / 7)}w`;
  return `${date} · in ${Math.round(days / 30)}mo`;
}

// "1,200 km left" / "400 km over" — the meter axis, when it exists and a
// reading anchors it.
export function meterLabel(item: MaintenanceItem): string | null {
  const remaining = item.due_state?.meter_remaining;
  if (remaining == null) return null;
  const unit = item.asset?.meter_unit ?? '';
  if (remaining < 0) return `${Math.abs(remaining).toLocaleString('en-US')} ${unit} over`.trim();
  return `${remaining.toLocaleString('en-US')} ${unit} left`.trim();
}

// Status names the axis that tripped — "Overdue · age" reads differently
// from "Overdue · km", and the fix is different.
export function statusLabel(item: MaintenanceItem): string {
  const s = item.due_state;
  if (!s) return '';
  if (item.policy === 'on_condition' && s.status === 'ok') return 'Inspect';
  const axis = s.trigger === 'meter' ? item.asset?.meter_unit ?? 'meter' : s.trigger === 'date' ? 'age' : null;
  const base = { overdue: 'Overdue', due: 'Due', due_soon: 'Due soon', ok: 'On track' }[s.status];
  return s.status === 'ok' || !axis ? base : `${base} · ${axis}`;
}

// Data confidence, separate from urgency — "ok" alone never means "we
// know nothing".
export function dataLabel(item: MaintenanceItem): string | null {
  const s = item.due_state;
  if (!s) return null;
  const unit = item.asset?.meter_unit ?? 'meter';
  const map: Record<MaintenanceDataState, string | null> = {
    complete: null,
    needs_baseline: `needs a baseline ${unit} reading`,
    needs_reading: `no ${unit} readings yet`,
    stale_reading: s.reading_age_days != null ? `reading ${s.reading_age_days}d old` : 'reading stale',
  };
  return map[s.data];
}

export const STATUS_LABEL: Record<string, string> = {
  overdue: 'Overdue',
  due: 'Due',
  due_soon: 'Due soon',
  ok: 'Upcoming',
};
