// Maintenance cadence math — the single source of truth for "when is this
// item next due" and "how due is it right now". Used by the API list
// endpoints, the awareness cron sweep, and the attention rules, so every
// consumer agrees.
//
// ANCHOR SEMANTICS — deliberately the opposite of task recurrence
// (recurrence.ts nextDueDate, note #1): maintenance RE-ANCHORS from the
// completion. Replace a filter 3 weeks late and the next quarter starts
// from the day you actually replaced it — the filter doesn't care what the
// calendar said. Task recurrence anchors to the original due date so a
// weekly Sunday task stays on Sundays; both behaviors are correct for
// their own domain.
//
// The meter axis is symmetric: next_due_meter = meter_at_completion +
// interval_meter, fixed at completion time. New readings never move it;
// due-ness is just latest_reading >= next_due_meter. Dual-cadence items
// ("5,000 km OR 6 months") are due when EITHER axis trips — whichever
// first.

import { addDays, addMonthsClamped, formatIsoDate, parseIsoDate } from './recurrence.js';

// The cadence subset of a maintenance_items row. One date unit (days XOR
// months, DB-enforced) and/or a meter interval (DB-enforced: at least one
// of the three is set).
export interface MaintenanceCadence {
  interval_days: number | null;
  interval_months: number | null;
  interval_meter: number | null;
}

export interface MaintenanceDueFields extends MaintenanceCadence {
  next_due_date: string | null;
  next_due_meter: number | null;
  lead_days: number;
  lead_meter: number | null;
}

export type MaintenanceDueStatus = 'ok' | 'due_soon' | 'due' | 'overdue';

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
}

// Order matters: used to pick the "worse" of the two axes.
const STATUS_RANK: Record<MaintenanceDueStatus, number> = {
  ok: 0,
  due_soon: 1,
  due: 2,
  overdue: 3,
};

// Default meter lead when lead_meter is unset: surface within the last 10%
// of the interval ("500 km to go" on a 5,000 km cadence).
export function effectiveLeadMeter(item: {
  lead_meter: number | null;
  interval_meter: number | null;
}): number | null {
  if (item.lead_meter != null) return item.lead_meter;
  if (item.interval_meter != null) return item.interval_meter * 0.1;
  return null;
}

// Roll the schedule forward from a completion. Returns the new materialized
// next-due pair. The meter axis needs a reading to anchor to — with
// interval_meter set but no meterAtCompletion, it comes back null and the
// item shows "needs a reading" until one arrives (the API substitutes the
// asset's latest reading when the completion itself didn't carry one).
export function nextAfterCompletion(params: {
  completedOn: string;
  meterAtCompletion: number | null | undefined;
  cadence: MaintenanceCadence;
}): { next_due_date: string | null; next_due_meter: number | null } {
  const { completedOn, meterAtCompletion, cadence } = params;

  let next_due_date: string | null = null;
  if (cadence.interval_days != null) {
    next_due_date = formatIsoDate(addDays(parseIsoDate(completedOn), cadence.interval_days));
  } else if (cadence.interval_months != null) {
    next_due_date = formatIsoDate(addMonthsClamped(parseIsoDate(completedOn), cadence.interval_months));
  }

  const next_due_meter =
    cadence.interval_meter != null && meterAtCompletion != null
      ? meterAtCompletion + cadence.interval_meter
      : null;

  return { next_due_date, next_due_meter };
}

// Whole days from today to an ISO date (negative = past). Both sides are
// calendar days, so plain UTC diff at noon anchors is exact.
function daysBetween(todayIso: string, dateIso: string): number {
  const ms = parseIsoDate(dateIso).getTime() - parseIsoDate(todayIso).getTime();
  return Math.round(ms / 86_400_000);
}

// Whichever-first due predicate over both axes.
export function maintenanceDueState(params: {
  todayIso: string;
  latestMeter: number | null | undefined;
  item: MaintenanceDueFields;
}): MaintenanceDueState {
  const { todayIso, latestMeter, item } = params;

  let dateStatus: MaintenanceDueStatus = 'ok';
  let days_until: number | null = null;
  if (item.next_due_date != null) {
    days_until = daysBetween(todayIso, item.next_due_date);
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

  return { status, trigger, days_until, meter_remaining };
}
