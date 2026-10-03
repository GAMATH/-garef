/**
 * Time-zone helpers built on Intl only (no heavy date library).
 * Business wall-clock times ("HH:MM" on a local date) are converted to UTC instants
 * using the city's IANA zone (Africa/Brazzaville, Africa/Abidjan, …).
 */

const dtfCache = new Map<string, Intl.DateTimeFormat>();
function partsFormatter(timeZone: string) {
  let f = dtfCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
    });
    dtfCache.set(timeZone, f);
  }
  return f;
}

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
  /** YYYY-MM-DD */
  date: string;
  /** HH:MM */
  time: string;
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const pad = (n: number) => String(n).padStart(2, '0');

export function zonedParts(instant: Date | string | number, timeZone: string): ZonedParts {
  const d = new Date(instant);
  const map: Record<string, string> = {};
  for (const p of partsFormatter(timeZone).formatToParts(d)) map[p.type] = p.value;
  const year = Number(map.year);
  const month = Number(map.month);
  const day = Number(map.day);
  const hour = Number(map.hour) % 24;
  const minute = Number(map.minute);
  return {
    year,
    month,
    day,
    hour,
    minute,
    weekday: WEEKDAYS[map.weekday] ?? 0,
    date: `${year}-${pad(month)}-${pad(day)}`,
    time: `${pad(hour)}:${pad(minute)}`,
  };
}

/** Offset (minutes) of `timeZone` from UTC at the given instant. */
export function tzOffsetMinutes(instant: Date, timeZone: string): number {
  const p = zonedParts(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  const truncated = Math.floor(instant.getTime() / 60000) * 60000;
  return Math.round((asUtc - truncated) / 60000);
}

/** Converts a local wall-clock (date "YYYY-MM-DD", time "HH:MM") in `timeZone` to a UTC Date. */
export function zonedToUtc(date: string, time: string, timeZone: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  let offset = tzOffsetMinutes(new Date(guess), timeZone);
  let result = guess - offset * 60000;
  // Second pass handles DST edges (none in our zones today, but stay correct).
  const offset2 = tzOffsetMinutes(new Date(result), timeZone);
  if (offset2 !== offset) {
    offset = offset2;
    result = guess - offset * 60000;
  }
  return new Date(result);
}

export function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

export function minutesToTime(min: number): string {
  return `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
}

/** Adds `days` to a YYYY-MM-DD date (calendar arithmetic, zone-free). */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

export function weekdayOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function todayIn(timeZone: string, now: Date = new Date()): string {
  return zonedParts(now, timeZone).date;
}

export function addMinutes(iso: string | Date, minutes: number): Date {
  return new Date(new Date(iso).getTime() + minutes * 60000);
}

export function diffDays(a: string, b: string): number {
  const [y1, m1, d1] = a.split('-').map(Number);
  const [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}
