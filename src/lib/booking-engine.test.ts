import { describe, expect, it } from 'vitest';
import { computeDays, computeSlots, eligibleStaff, nearestSlots, type EngineInput } from './booking-engine';
import { zonedParts, zonedToUtc } from './time';

const TZ = 'Africa/Brazzaville'; // UTC+1
// 2026-10-05 is a Monday.
const DATE = '2026-10-05';

function base(over: Partial<EngineInput> = {}): EngineInput {
  return {
    timezone: TZ,
    slotStepMin: 15,
    minNoticeMin: 60,
    date: DATE,
    durationMin: 60,
    staffIds: ['a', 'b'],
    businessHours: [{ businessId: 'x', weekday: 1, opens: '09:00', closes: '12:00', breakStart: null, breakEnd: null }],
    staffHours: [],
    timeOff: [],
    appointments: [],
    now: new Date('2026-10-01T00:00:00Z'),
    ...over,
  };
}

const local = (iso: string) => zonedParts(iso, TZ).time;

describe('computeSlots', () => {
  it('produces a 15-minute grid that fits inside opening hours', () => {
    const slots = computeSlots(base());
    expect(slots.map((s) => local(s.start))).toEqual([
      '09:00', '09:15', '09:30', '09:45', '10:00', '10:15', '10:30', '10:45', '11:00',
    ]);
    expect(slots[0].staffIds).toEqual(['a', 'b']);
  });

  it('stores instants in UTC (Brazzaville is UTC+1)', () => {
    const slots = computeSlots(base());
    expect(slots[0].start).toBe('2026-10-05T08:00:00.000Z');
  });

  it('returns nothing on a closed day', () => {
    expect(computeSlots(base({ date: '2026-10-04' }))).toEqual([]);
  });

  it('never straddles the salon break', () => {
    const slots = computeSlots(
      base({ businessHours: [{ businessId: 'x', weekday: 1, opens: '09:00', closes: '14:00', breakStart: '12:00', breakEnd: '13:00' }] }),
    );
    const times = slots.map((s) => local(s.start));
    expect(times).toContain('11:00');
    expect(times).not.toContain('11:15');
    expect(times).not.toContain('12:00');
    expect(times).toContain('13:00');
  });

  it('removes slots overlapping an existing appointment for that staff only', () => {
    const slots = computeSlots(
      base({
        appointments: [
          { id: '1', staffId: 'a', startsAt: zonedToUtc(DATE, '10:00', TZ).toISOString(), endsAt: zonedToUtc(DATE, '11:00', TZ).toISOString(), status: 'confirmed', holdExpiresAt: null },
        ],
      }),
    );
    const at1000 = slots.find((s) => local(s.start) === '10:00')!;
    expect(at1000.staffIds).toEqual(['b']);
    const at0900 = slots.find((s) => local(s.start) === '09:00')!;
    expect(at0900.staffIds).toEqual(['a', 'b']);
    const at0915 = slots.find((s) => local(s.start) === '09:15')!;
    expect(at0915.staffIds).toEqual(['b']);
  });

  it('ignores cancelled appointments and expired holds, honours active holds', () => {
    const now = new Date('2026-10-01T00:00:00Z');
    const s = zonedToUtc(DATE, '09:00', TZ).toISOString();
    const e = zonedToUtc(DATE, '12:00', TZ).toISOString();
    const expired = computeSlots(base({ staffIds: ['a'], now, appointments: [{ id: '1', staffId: 'a', startsAt: s, endsAt: e, status: 'pending_payment', holdExpiresAt: '2026-09-30T23:59:00Z' }] }));
    expect(expired.length).toBe(9);
    const cancelled = computeSlots(base({ staffIds: ['a'], now, appointments: [{ id: '1', staffId: 'a', startsAt: s, endsAt: e, status: 'cancelled', holdExpiresAt: null }] }));
    expect(cancelled.length).toBe(9);
    const held = computeSlots(base({ staffIds: ['a'], now, appointments: [{ id: '1', staffId: 'a', startsAt: s, endsAt: e, status: 'pending_payment', holdExpiresAt: '2026-10-01T00:10:00Z' }] }));
    expect(held).toEqual([]);
  });

  it('applies staff hours and staff/salon time off', () => {
    const slots = computeSlots(
      base({
        staffHours: [{ staffId: 'a', weekday: 1, starts: '10:00', ends: '12:00' }],
        timeOff: [{ id: 't', businessId: 'x', staffId: 'b', startsAt: zonedToUtc(DATE, '00:00', TZ).toISOString(), endsAt: zonedToUtc(DATE, '23:59', TZ).toISOString(), reason: '' }],
      }),
    );
    expect(slots.map((s) => local(s.start))).toEqual(['10:00', '10:15', '10:30', '10:45', '11:00']);
    const closed = computeSlots(
      base({ timeOff: [{ id: 't', businessId: 'x', staffId: null, startsAt: zonedToUtc(DATE, '09:00', TZ).toISOString(), endsAt: zonedToUtc(DATE, '10:30', TZ).toISOString(), reason: '' }] }),
    );
    expect(local(closed[0].start)).toBe('10:30');
  });

  it('staff with own hours but none that weekday is off', () => {
    const slots = computeSlots(base({ staffIds: ['a'], staffHours: [{ staffId: 'a', weekday: 2, starts: '09:00', ends: '12:00' }] }));
    expect(slots).toEqual([]);
  });

  it('respects minimum notice', () => {
    const now = zonedToUtc(DATE, '09:10', TZ);
    const slots = computeSlots(base({ now }));
    expect(local(slots[0].start)).toBe('10:15');
  });

  it('hours changes are reflected immediately (pure function of inputs)', () => {
    const before = computeSlots(base());
    const after = computeSlots(base({ businessHours: [{ businessId: 'x', weekday: 1, opens: '10:00', closes: '12:00', breakStart: null, breakEnd: null }] }));
    expect(before.length).toBe(9);
    expect(after.length).toBe(5);
  });
});

describe('helpers', () => {
  it('computeDays flags days without availability', () => {
    const days = computeDays(base(), '2026-10-04', 3);
    expect(days).toEqual([
      { date: '2026-10-04', available: false },
      { date: '2026-10-05', available: true },
      { date: '2026-10-06', available: false },
    ]);
  });

  it('nearestSlots proposes the closest alternatives', () => {
    const slots = computeSlots(base());
    const alt = nearestSlots(slots, slots[4].start, 3).map((s) => local(s.start));
    expect(alt).toEqual(['09:30', '09:45', '10:15']);
  });

  it('eligibleStaff requires every selected service', () => {
    const staff = [{ id: 'a', active: true, sort: 2 }, { id: 'b', active: true, sort: 1 }, { id: 'c', active: false, sort: 0 }];
    const ss = [
      { staffId: 'a', serviceId: 's1' }, { staffId: 'a', serviceId: 's2' },
      { staffId: 'b', serviceId: 's1' }, { staffId: 'c', serviceId: 's1' },
    ];
    expect(eligibleStaff(staff, ss, ['s1'])).toEqual(['b', 'a']);
    expect(eligibleStaff(staff, ss, ['s1', 's2'])).toEqual(['a']);
  });
});
