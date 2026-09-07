import { describe, expect, it } from 'vitest';
import {
  effectiveDomainId,
  maintenanceDueState,
  maintenanceOccurrenceKey,
  nextAfterCompletion,
} from '@jevi-ops/shared';
import { INBOX } from './helpers.js';

// Pure cadence math — no database.

const interval = { policy: 'interval' as const, interval_days: null, interval_months: 6, interval_meter: 5000 };

describe('nextAfterCompletion', () => {
  it('re-anchors an interval item from the completion (date + meter)', () => {
    const next = nextAfterCompletion({
      event: { completedOn: '2026-06-01', meterAtCompletion: 95000 },
      schedule: interval,
    });
    expect(next).toEqual({ next_due_date: '2026-12-01', next_due_meter: 100000 });
  });

  it('clamps month math to the last valid day (leap year)', () => {
    const next = nextAfterCompletion({
      event: { completedOn: '2027-08-31', meterAtCompletion: null },
      schedule: { ...interval, interval_meter: null },
    });
    expect(next.next_due_date).toBe('2028-02-29');
  });

  it('leaves the meter axis unknown when no reading anchors it', () => {
    const next = nextAfterCompletion({
      event: { completedOn: '2026-06-01', meterAtCompletion: null },
      schedule: interval,
    });
    expect(next.next_due_meter).toBeNull();
  });

  it('expiry: the issued expiry wins over the renewal interval', () => {
    const next = nextAfterCompletion({
      event: { completedOn: '2026-09-06', meterAtCompletion: null, issuedUntil: '2027-03-14' },
      schedule: { policy: 'expiry', interval_days: null, interval_months: 12, interval_meter: null },
    });
    expect(next).toEqual({ next_due_date: '2027-03-14', next_due_meter: null });
  });

  it('expiry: falls back to the renewal interval when no expiry was reported', () => {
    const next = nextAfterCompletion({
      event: { completedOn: '2026-09-06', meterAtCompletion: null },
      schedule: { policy: 'expiry', interval_days: null, interval_months: 12, interval_meter: null },
    });
    expect(next.next_due_date).toBe('2027-09-06');
  });

  it('prepaid_meter: the purchased end distance is authoritative', () => {
    const next = nextAfterCompletion({
      event: { completedOn: '2026-09-06', meterAtCompletion: 210480, purchasedTo: 216000 },
      schedule: { policy: 'prepaid_meter', interval_days: null, interval_months: null, interval_meter: null },
    });
    expect(next).toEqual({ next_due_date: null, next_due_meter: 216000 });
  });

  it('on_condition: an inspection sets the next review, or nothing', () => {
    const schedule = { policy: 'on_condition' as const, interval_days: null, interval_months: null, interval_meter: null };
    expect(
      nextAfterCompletion({ event: { completedOn: '2026-09-06', meterAtCompletion: null, nextReviewOn: '2027-09-06' }, schedule }),
    ).toEqual({ next_due_date: '2027-09-06', next_due_meter: null });
    expect(nextAfterCompletion({ event: { completedOn: '2026-09-06', meterAtCompletion: null }, schedule })).toEqual({
      next_due_date: null,
      next_due_meter: null,
    });
  });
});

describe('maintenanceDueState', () => {
  const base = {
    policy: 'interval',
    interval_days: null,
    interval_months: 6,
    interval_meter: 5000,
    lead_days: 14,
    lead_meter: null,
  };

  it('whichever-first: the meter axis trips while the date is months out', () => {
    const s = maintenanceDueState({
      todayIso: '2026-09-06',
      latestMeter: 105000,
      latestReadingOn: '2026-09-06',
      staleDays: 14,
      item: { ...base, next_due_date: '2027-03-06', next_due_meter: 104500 },
    });
    expect(s.status).toBe('overdue');
    expect(s.trigger).toBe('meter');
    expect(s.meter_remaining).toBe(-500);
    expect(s.data).toBe('complete');
  });

  it('reports an unanchored meter axis as needs_baseline, not ok-and-silent', () => {
    const s = maintenanceDueState({
      todayIso: '2026-09-06',
      latestMeter: 105000,
      latestReadingOn: '2026-09-06',
      staleDays: 14,
      item: { ...base, next_due_date: '2027-03-06', next_due_meter: null },
    });
    expect(s.status).toBe('ok');
    expect(s.data).toBe('needs_baseline');
  });

  it('distinguishes no reading from a stale one', () => {
    const noReading = maintenanceDueState({
      todayIso: '2026-09-06',
      latestMeter: null,
      item: { ...base, next_due_date: null, next_due_meter: 104500 },
    });
    expect(noReading.data).toBe('needs_reading');
    const stale = maintenanceDueState({
      todayIso: '2026-09-06',
      latestMeter: 100000,
      latestReadingOn: '2026-08-01',
      staleDays: 14,
      item: { ...base, next_due_date: null, next_due_meter: 104500 },
    });
    expect(stale.data).toBe('stale_reading');
    expect(stale.reading_age_days).toBe(36);
  });

  it('a threshold without an interval uses a narrow default lead (prepaid / inspection)', () => {
    const s = maintenanceDueState({
      todayIso: '2026-09-06',
      latestMeter: 210480,
      latestReadingOn: '2026-09-06',
      staleDays: 14,
      item: { policy: 'prepaid_meter', interval_days: null, interval_months: null, interval_meter: null, lead_days: 14, lead_meter: null, next_due_date: null, next_due_meter: 216000 },
    });
    expect(s.status).toBe('ok'); // 5,520 to go > the 1,000 default lead
    expect(s.meter_remaining).toBe(5520);
  });

  it('date-only items are always data:complete', () => {
    const s = maintenanceDueState({
      todayIso: '2026-09-06',
      latestMeter: null,
      item: { ...base, interval_meter: null, next_due_date: '2026-09-10', next_due_meter: null },
    });
    expect(s.status).toBe('due_soon');
    expect(s.data).toBe('complete');
  });
});

describe('policy helpers', () => {
  it('effectiveDomainId: item → asset → Inbox', () => {
    expect(effectiveDomainId({ domain_id: 'd1' }, { domain_id: 'd2' })).toBe('d1');
    expect(effectiveDomainId({ domain_id: null }, { domain_id: 'd2' })).toBe('d2');
    expect(effectiveDomainId({ domain_id: null }, null)).toBe(INBOX);
  });

  it('occurrence key changes when thresholds roll forward', () => {
    const a = maintenanceOccurrenceKey({ id: 'i', next_due_date: '2026-12-01', next_due_meter: 100000 });
    const b = maintenanceOccurrenceKey({ id: 'i', next_due_date: '2027-06-01', next_due_meter: 105000 });
    expect(a).not.toBe(b);
    expect(a).toBe('maint:i:2026-12-01:100000');
  });
});
