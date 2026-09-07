// Maintenance cadence math — the single source of truth for "when is this
// item next due" and "how due is it right now". Used by the API list
// endpoints, the awareness cron sweep, and the attention rules, so every
// consumer agrees.
//
// ANCHOR SEMANTICS — deliberately the opposite of task recurrence
// (recurrence.ts nextDueDate, note #1): 'interval' maintenance RE-ANCHORS
// from the completion. Replace a filter 3 weeks late and the next quarter
// starts from the day you actually replaced it — the filter doesn't care
// what the calendar said. Task recurrence anchors to the original due date
// so a weekly Sunday task stays on Sundays; both are right for their domain.
//
// POLICIES (migration 0048). Not every obligation is "did it, wait an
// interval":
//   interval       — re-anchor from the completion (above).
//   expiry         — rego / WoF / insurance: next due is the newly ISSUED
//                    expiry the completion reports. "today + 12 months" is
//                    wrong for a licence issued to a chosen date.
//   prepaid_meter  — NZ Road User Charges: next due meter is the purchased
//                    end distance, authoritative from the licence itself.
//   on_condition   — inspect/replace-on-failure: no interval; a completion
//                    records a finding and a next review (date and/or meter).
//
// The meter axis is fixed at completion time (interval: meter_at_completion
// + interval_meter; prepaid: purchased_to). New readings never move it;
// due-ness is just latest_reading >= next_due_meter. Dual-cadence items
// ("5,000 km OR 6 months") are due when EITHER axis trips — whichever first.
//
// URGENCY vs DATA CONFIDENCE are two dimensions, reported separately. An
// item whose meter axis has never been anchored, or whose asset has no
// reading, or whose reading is stale, is NOT "ok" — it is unknown. `status`
// says how urgent the tracked obligation is; `data` says how much to trust
// that. UI shows both; "ok" alone never means "we know nothing".

import { INBOX_DOMAIN_ID } from './constants/domains.js';
import { addDays, addMonthsClamped, formatIsoDate, parseIsoDate } from './recurrence.js';

export const MAINTENANCE_POLICIES = ['interval', 'expiry', 'prepaid_meter', 'on_condition'] as const;
export type MaintenancePolicy = (typeof MAINTENANCE_POLICIES)[number];

export const MAINTENANCE_POLICY_LABELS: Record<MaintenancePolicy, string> = {
  interval: 'Interval',
  expiry: 'Expiry (rego, WoF, insurance)',
  prepaid_meter: 'Prepaid distance (RUC)',
  on_condition: 'On condition (inspect)',
};

export function isMaintenancePolicy(s: unknown): s is MaintenancePolicy {
  return typeof s === 'string' && (MAINTENANCE_POLICIES as readonly string[]).includes(s);
}

// The cadence subset of a maintenance_items row. One date unit (days XOR
// months, DB-enforced) and/or a meter interval. For the 'interval' policy
// at least one is set (DB-enforced); other policies may have none.
export interface MaintenanceCadence {
  interval_days: number | null;
  interval_months: number | null;
  interval_meter: number | null;
}

export interface MaintenanceSchedule extends MaintenanceCadence {
  policy: MaintenancePolicy;
}

// Read-side shape: rows come off the DB with policy as plain text; the
// write side (nextAfterCompletion) stays strict.
export interface MaintenanceDueFields extends MaintenanceCadence {
  policy: MaintenancePolicy | string;
  next_due_date: string | null;
  next_due_meter: number | null;
  lead_days: number;
  lead_meter: number | null;
}

// What a completion reports. Policy decides which fields matter.
export interface CompletionEvent {
  completedOn: string;
  meterAtCompletion: number | null | undefined;
  // expiry: the newly issued expiry date.
  issuedUntil?: string | null;
  // prepaid_meter: the purchased end distance.
  purchasedTo?: number | null;
  // on_condition: when to look again.
  nextReviewOn?: string | null;
  nextReviewMeter?: number | null;
}

export type MaintenanceDueStatus = 'ok' | 'due_soon' | 'due' | 'overdue';
export type MaintenanceDataState = 'complete' | 'needs_baseline' | 'needs_reading' | 'stale_reading';

export interface MaintenanceDueState {
  status: MaintenanceDueStatus;
  // Which axis tripped (or is closest to tripping) — null when 'ok' and
  // neither axis has a materialized next-due yet.
  trigger: 'date' | 'meter' | null;
  // Signed: negative = overdue by that many days. Null when no date axis.
  days_until: number | null;
  // Signed: negative = past the meter threshold. Null when no meter axis
  // or no reading yet.
  meter_remaining: number | null;
  // Confidence in the meter axis. 'complete' also covers date-only items.
  data: MaintenanceDataState;
  // Age of the latest (non-voided) reading, when the item has a meter axis.
  reading_age_days: number | null;
}

// Order matters: used to pick the "worse" of the two axes.
const STATUS_RANK: Record<MaintenanceDueStatus, number> = {
  ok: 0,
  due_soon: 1,
  due: 2,
  overdue: 3,
};

// Default meter lead when lead_meter is unset: surface within the last 10%
// of the interval ("500 km to go" on a 5,000 km cadence). Thresholds with
// no interval behind them (a prepaid licence's end distance, an
// inspection's next review) have no interval to scale from, and 10% of a
// 216,000 km odometer would be a 21,600 km lead — so those use 2% of the
// threshold, capped at 1,000 units. Set lead_meter to override.
export function effectiveLeadMeter(item: {
  lead_meter: number | null;
  interval_meter: number | null;
  next_due_meter?: number | null;
}): number | null {
  if (item.lead_meter != null) return item.lead_meter;
  if (item.interval_meter != null) return item.interval_meter * 0.1;
  if (item.next_due_meter != null) return Math.min(item.next_due_meter * 0.02, 1000);
  return null;
}

// Does this item track a meter axis at all? True for a meter interval, or
// for any policy that has (or expects) a meter threshold.
export function hasMeterAxis(item: {
  policy: MaintenancePolicy | string;
  interval_meter: number | null;
  next_due_meter: number | null;
}): boolean {
  if (item.interval_meter != null) return true;
  if (item.policy === 'prepaid_meter') return true;
  return item.next_due_meter != null;
}

function addIntervalDate(fromIso: string, cadence: MaintenanceCadence): string | null {
  if (cadence.interval_days != null) return formatIsoDate(addDays(parseIsoDate(fromIso), cadence.interval_days));
  if (cadence.interval_months != null) return formatIsoDate(addMonthsClamped(parseIsoDate(fromIso), cadence.interval_months));
  return null;
}

// Roll the schedule forward from a completion, per policy. Returns the new
// materialized next-due pair. When the meter axis needs a reading to anchor
// to (interval policy, meter interval set, no meter on the event) it comes
// back null — the item reports data:'needs_baseline' until one arrives. The
// API only substitutes an asset reading recorded ON OR BEFORE the
// completion date, never a later one.
export function nextAfterCompletion(params: {
  event: CompletionEvent;
  schedule: MaintenanceSchedule;
}): { next_due_date: string | null; next_due_meter: number | null } {
  const { event, schedule } = params;
  switch (schedule.policy) {
    case 'expiry': {
      // Issued expiry wins; a renewal-length interval is only the fallback
      // for a completion that didn't report the new expiry.
      const next_due_date = event.issuedUntil ?? addIntervalDate(event.completedOn, schedule);
      return { next_due_date, next_due_meter: null };
    }
    case 'prepaid_meter': {
      const next_due_meter =
        event.purchasedTo ??
        (schedule.interval_meter != null && event.meterAtCompletion != null
          ? event.meterAtCompletion + schedule.interval_meter
          : null);
      // Some prepaid licences also carry a time limit; honour a date
      // interval if one is configured.
      return { next_due_date: addIntervalDate(event.completedOn, schedule), next_due_meter };
    }
    case 'on_condition':
      return {
        next_due_date: event.nextReviewOn ?? null,
        next_due_meter: event.nextReviewMeter ?? null,
      };
    case 'interval':
    default: {
      const next_due_meter =
        schedule.interval_meter != null && event.meterAtCompletion != null
          ? event.meterAtCompletion + schedule.interval_meter
          : null;
      return { next_due_date: addIntervalDate(event.completedOn, schedule), next_due_meter };
    }
  }
}

// Whole days from today to an ISO date (negative = past). Both sides are
// calendar days, so plain UTC diff at noon anchors is exact.
export function daysBetweenIso(fromIso: string, toIso: string): number {
  const ms = parseIsoDate(toIso).getTime() - parseIsoDate(fromIso).getTime();
  return Math.round(ms / 86_400_000);
}

// Whichever-first due predicate over both axes, plus data confidence.
export function maintenanceDueState(params: {
  todayIso: string;
  latestMeter: number | null | undefined;
  // recorded_on of that latest reading; drives reading_age_days + staleness.
  latestReadingOn?: string | null;
  // app_settings.meter_stale_days; omit to skip the staleness verdict.
  staleDays?: number | null;
  item: MaintenanceDueFields;
}): MaintenanceDueState {
  const { todayIso, latestMeter, latestReadingOn, staleDays, item } = params;

  let dateStatus: MaintenanceDueStatus = 'ok';
  let days_until: number | null = null;
  if (item.next_due_date != null) {
    days_until = daysBetweenIso(todayIso, item.next_due_date);
    if (days_until < 0) dateStatus = 'overdue';
    else if (days_until === 0) dateStatus = 'due';
    else if (days_until <= item.lead_days) dateStatus = 'due_soon';
  }

  let meterStatus: MaintenanceDueStatus = 'ok';
  let meter_remaining: number | null = null;
  if (item.next_due_meter != null && latestMeter != null) {
    meter_remaining = item.next_due_meter - latestMeter;
    const lead = effectiveLeadMeter(item) ?? 0;
    if (meter_remaining < 0) meterStatus = 'overdue';
    else if (meter_remaining === 0) meterStatus = 'due';
    else if (meter_remaining <= lead) meterStatus = 'due_soon';
  }

  const worse = STATUS_RANK[meterStatus] > STATUS_RANK[dateStatus] ? 'meter' : 'date';
  const status = worse === 'meter' ? meterStatus : dateStatus;

  let trigger: 'date' | 'meter' | null = null;
  if (status !== 'ok') {
    trigger = worse;
  } else if (days_until != null || meter_remaining != null) {
    // Neither axis tripped — report the one that exists (or, with both,
    // the date axis: "in 12 days" reads better than a raw meter delta and
    // the UI shows meter_remaining alongside anyway).
    trigger = days_until != null ? 'date' : 'meter';
  }

  // Data confidence — only the meter axis can be unknown.
  const reading_age_days = latestReadingOn ? daysBetweenIso(latestReadingOn, todayIso) : null;
  let data: MaintenanceDataState = 'complete';
  if (hasMeterAxis(item)) {
    if (item.next_due_meter == null && item.policy !== 'on_condition') data = 'needs_baseline';
    else if (latestMeter == null) data = 'needs_reading';
    else if (staleDays != null && reading_age_days != null && reading_age_days > staleDays) data = 'stale_reading';
  }

  return { status, trigger, days_until, meter_remaining, data, reading_age_days };
}

// Visibility/ownership policy in one place: an item belongs to its own
// domain if set, else its asset's domain, else Inbox. Awareness (tasks,
// attention) always flows — domain VISIBILITY is what assignment unlocks.
export function effectiveDomainId(
  item: { domain_id: string | null },
  asset: { domain_id: string | null } | null | undefined,
): string {
  return item.domain_id ?? asset?.domain_id ?? INBOX_DOMAIN_ID;
}

// The durable identity of one maintenance occurrence — the same item due at
// the same thresholds. Stored on tasks.source_ref (unique per source), so
// concurrent generators cannot create two tasks for one occurrence, and a
// roll-forward (new thresholds) is a new occurrence.
export function maintenanceOccurrenceKey(item: {
  id: string;
  next_due_date: string | null;
  next_due_meter: number | null;
}): string {
  return `maint:${item.id}:${item.next_due_date ?? ''}:${item.next_due_meter ?? ''}`;
}
