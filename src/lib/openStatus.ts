import type { BusinessHours } from './types';
import { timeToMinutes, zonedParts } from './time';

export type OpenStatus =
  | { kind: 'open'; until: string }
  | { kind: 'break'; until: string }
  | { kind: 'closed'; nextDay: number | null; opens: string | null; today: boolean };

/** Live opening status in the salon's time zone. */
export function openStatus(hours: BusinessHours[], tz: string, now = new Date()): OpenStatus {
  const p = zonedParts(now, tz);
  const m = p.hour * 60 + p.minute;
  const today = hours.find((h) => h.weekday === p.weekday);
  if (today) {
    const o = timeToMinutes(today.opens);
    const c = timeToMinutes(today.closes);
    if (m >= o && m < c) {
      if (today.breakStart && today.breakEnd && m >= timeToMinutes(today.breakStart) && m < timeToMinutes(today.breakEnd)) return { kind: 'break', until: today.breakEnd };
      return { kind: 'open', until: today.closes };
    }
    if (m < o) return { kind: 'closed', nextDay: p.weekday, opens: today.opens, today: true };
  }
  for (let i = 1; i <= 7; i++) {
    const wd = (p.weekday + i) % 7;
    const h = hours.find((x) => x.weekday === wd);
    if (h) return { kind: 'closed', nextDay: wd, opens: h.opens, today: false };
  }
  return { kind: 'closed', nextDay: null, opens: null, today: false };
}
