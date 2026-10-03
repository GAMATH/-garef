/**
 * Kuzuri availability engine (pure, deterministic).
 *
 * This is the TypeScript twin of `public.get_available_slots()` in
 * supabase/migrations/0003_booking_engine.sql. The demo adapter uses it directly;
 * in Supabase mode the database is the source of truth and this module is only used
 * for the unit tests that pin the shared rules:
 *
 *  - slots are on a grid anchored to the salon opening time, every `slotStepMin` (15 by default);
 *  - a slot must fit entirely inside the intersection of salon hours and staff hours;
 *  - never overlaps the salon break, a time-off (staff or whole salon), or a blocking appointment;
 *  - pending_payment holds only block while `holdExpiresAt` is in the future;
 *  - must start at least `minNoticeMin` after now.
 */
import type { AppointmentStatus, BusinessHours, DayAvailability, Slot, StaffHours, TimeOff } from './types';
import { BLOCKING_STATUSES } from './types';
import { addDays, timeToMinutes, weekdayOf, zonedToUtc } from './time';

export interface EngineAppointment {
  id: string;
  staffId: string;
  startsAt: string;
  endsAt: string;
  status: AppointmentStatus;
  holdExpiresAt: string | null;
}

export interface EngineInput {
  timezone: string;
  slotStepMin: number;
  minNoticeMin: number;
  /** Local date YYYY-MM-DD in `timezone`. */
  date: string;
  durationMin: number;
  /** Staff able to perform every selected service, in assignment priority order. */
  staffIds: string[];
  businessHours: BusinessHours[];
  staffHours: StaffHours[];
  timeOff: TimeOff[];
  appointments: EngineAppointment[];
  now: Date;
  /** Ignore this appointment (used when rescheduling it). */
  excludeAppointmentId?: string;
}

type Interval = [number, number];

const overlaps = (a: Interval, b: Interval) => a[0] < b[1] && b[0] < a[1];

export function isBlocking(a: Pick<EngineAppointment, 'status' | 'holdExpiresAt'>, now: Date): boolean {
  if (!BLOCKING_STATUSES.includes(a.status)) return false;
  if (a.status === 'pending_payment') return !!a.holdExpiresAt && new Date(a.holdExpiresAt).getTime() > now.getTime();
  return true;
}

export function computeSlots(input: EngineInput): Slot[] {
  const { date, timezone, durationMin, now } = input;
  const weekday = weekdayOf(date);
  const bh = input.businessHours.find((h) => h.weekday === weekday);
  if (!bh || durationMin <= 0) return [];

  const step = Math.max(5, input.slotStepMin || 15);
  const openMin = timeToMinutes(bh.opens);
  const closeMin = timeToMinutes(bh.closes);
  const at = (minute: number) => zonedToUtc(date, '00:00', timezone).getTime() + minute * 60000;
  const earliest = now.getTime() + input.minNoticeMin * 60000;
  const durMs = durationMin * 60000;

  const salonBusy: Interval[] = [];
  if (bh.breakStart && bh.breakEnd) salonBusy.push([at(timeToMinutes(bh.breakStart)), at(timeToMinutes(bh.breakEnd))]);
  for (const t of input.timeOff) {
    if (t.staffId === null) salonBusy.push([Date.parse(t.startsAt), Date.parse(t.endsAt)]);
  }

  const byStart = new Map<number, string[]>();

  for (const staffId of input.staffIds) {
    const ownHours = input.staffHours.filter((h) => h.staffId === staffId);
    let winStart = openMin;
    let winEnd = closeMin;
    if (ownHours.length > 0) {
      const sh = ownHours.find((h) => h.weekday === weekday);
      if (!sh) continue; // day off for this professional
      winStart = Math.max(winStart, timeToMinutes(sh.starts));
      winEnd = Math.min(winEnd, timeToMinutes(sh.ends));
    }
    if (winEnd - winStart < durationMin) continue;

    const busy: Interval[] = [...salonBusy];
    for (const t of input.timeOff) {
      if (t.staffId === staffId) busy.push([Date.parse(t.startsAt), Date.parse(t.endsAt)]);
    }
    for (const a of input.appointments) {
      if (a.staffId !== staffId || a.id === input.excludeAppointmentId) continue;
      if (isBlocking(a, now)) busy.push([Date.parse(a.startsAt), Date.parse(a.endsAt)]);
    }

    // Grid anchored to salon opening time.
    const firstK = Math.ceil((winStart - openMin) / step);
    for (let m = openMin + firstK * step; m + durationMin <= winEnd; m += step) {
      const start = at(m);
      if (start < earliest) continue;
      const iv: Interval = [start, start + durMs];
      if (busy.some((b) => overlaps(iv, b))) continue;
      const list = byStart.get(start);
      if (list) list.push(staffId);
      else byStart.set(start, [staffId]);
    }
  }

  return [...byStart.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([start, staffIds]) => ({ start: new Date(start).toISOString(), staffIds }));
}

export function computeDays(input: Omit<EngineInput, 'date'>, fromDate: string, count = 14): DayAvailability[] {
  const out: DayAvailability[] = [];
  for (let i = 0; i < count; i++) {
    const date = addDays(fromDate, i);
    out.push({ date, available: computeSlots({ ...input, date }).length > 0 });
  }
  return out;
}

/** Nearest free slots to a wanted start time (used when a slot was just taken). */
export function nearestSlots(slots: Slot[], wanted: string, count = 3): Slot[] {
  const w = Date.parse(wanted);
  return [...slots]
    .filter((s) => s.start !== wanted)
    .sort((a, b) => Math.abs(Date.parse(a.start) - w) - Math.abs(Date.parse(b.start) - w))
    .slice(0, count)
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
}

/** Staff able to perform *every* selected service. */
export function eligibleStaff(
  staff: { id: string; active: boolean; sort: number }[],
  staffServices: { staffId: string; serviceId: string }[],
  serviceIds: string[],
): string[] {
  return staff
    .filter((s) => s.active)
    .filter((s) => serviceIds.every((sid) => staffServices.some((x) => x.staffId === s.id && x.serviceId === sid)))
    .sort((a, b) => a.sort - b.sort)
    .map((s) => s.id);
}

export type DayPart = 'morning' | 'afternoon' | 'evening';
export function dayPart(localTime: string): DayPart {
  const m = timeToMinutes(localTime);
  if (m < 12 * 60) return 'morning';
  if (m < 17 * 60) return 'afternoon';
  return 'evening';
}
