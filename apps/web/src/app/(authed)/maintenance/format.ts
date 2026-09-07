import type { MaintenanceItem } from '@/lib/api';

// Display helpers shared by the maintenance pages. Pure formatting — the
// due-ness math itself is server-side (shared maintenanceDueState) and
// arrives on the wire as item.due_state.

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
  return parts.join(' or ');
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

export const STATUS_LABEL: Record<string, string> = {
  overdue: 'Overdue',
  due: 'Due',
  due_soon: 'Due soon',
  ok: 'Upcoming',
};
