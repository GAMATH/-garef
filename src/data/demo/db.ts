/**
 * Demo database: the seed materialised relative to "today", persisted in localStorage and
 * synchronised across tabs with BroadcastChannel (so a booking made in one tab appears
 * instantly in the pro agenda opened in another — the demo equivalent of Supabase Realtime).
 */
import type {
  Appointment,
  Business,
  BusinessHours,
  Category,
  City,
  Client,
  ClientNote,
  Country,
  Favorite,
  NotificationLog,
  Payment,
  Profile,
  Review,
  Service,
  Staff,
  StaffHours,
  StaffService,
  TimeOff,
} from '@/lib/types';
import { CATEGORIES, CITIES, COUNTRIES } from '../reference';
import { DEMO_ACCOUNTS, SEED_APPOINTMENTS, generateSeed, isSeedAppointmentValid } from '../seed';
import { addDays, addMinutes, todayIn, weekdayOf, zonedToUtc } from '@/lib/time';

export interface DemoState {
  version: number;
  seededAt: string;
  countries: Country[];
  cities: City[];
  categories: Category[];
  profiles: Profile[];
  credentials: { email: string; password: string; profileId: string }[];
  businesses: Business[];
  staff: Staff[];
  services: Service[];
  staffServices: StaffService[];
  businessHours: BusinessHours[];
  staffHours: StaffHours[];
  timeOff: TimeOff[];
  clients: Client[];
  clientNotes: ClientNote[];
  appointments: Appointment[];
  payments: (Payment & { providerRef: string })[];
  reviews: Review[];
  favorites: Favorite[];
  notifications: NotificationLog[];
  remindedIds: string[];
  rateLimits: { key: string; at: number }[];
}

const STORAGE_KEY = 'kuzuri-demo-db';
const VERSION = 4;

export function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => ((Math.random() * 16) | 0).toString(16));
}

export function materialise(now: Date = new Date()): DemoState {
  const seed = generateSeed();
  const nowIso = now.toISOString();
  const tzOf = (businessId: string) => CITIES.find((c) => c.id === seed.businesses.find((b) => b.id === businessId)!.cityId)!.timezone;

  const appointments: Appointment[] = [];
  for (const a of seed.appointments) {
    if (appointments.length >= SEED_APPOINTMENTS) break;
    const tz = tzOf(a.businessId);
    const day = addDays(todayIn(tz, now), a.dayOffset);
    if (!isSeedAppointmentValid(a, weekdayOf(day), seed.businessHours, seed.staffHours)) continue;
    const start = zonedToUtc(day, a.time, tz);
    const services = a.serviceIds.map((id) => seed.services.find((s) => s.id === id)!);
    appointments.push({
      id: a.id,
      reference: a.reference,
      businessId: a.businessId,
      staffId: a.staffId,
      clientId: a.clientId,
      profileId: a.profileId,
      startsAt: start.toISOString(),
      endsAt: addMinutes(start, a.durationMin).toISOString(),
      status: a.status,
      paymentStatus: a.paymentStatus,
      total: a.total,
      deposit: a.deposit,
      amountPaid: a.amountPaid,
      holdExpiresAt: null,
      source: 'online',
      services: services.map((s) => ({ serviceId: s.id, name: s.name, durationMin: s.durationMin, price: s.price })),
      createdAt: addDays(todayIn(tz, now), a.createdDayOffset) + 'T09:00:00.000Z',
    });
  }
  const kept = new Set(appointments.map((a) => a.id));

  const reviews: Review[] = seed.reviews
    .filter((r) => kept.has(r.appointmentId))
    .map((r) => ({
      id: r.id,
      appointmentId: r.appointmentId,
      businessId: r.businessId,
      profileId: r.profileId,
      authorName: r.authorName,
      rating: r.rating,
      comment: r.comment,
      reply: r.reply,
      createdAt: addMinutes(appointments.find((a) => a.id === r.appointmentId)!.endsAt, 180).toISOString(),
    }));

  const businesses: Business[] = seed.businesses.map((b) => {
    const rs = reviews.filter((r) => r.businessId === b.id);
    return {
      ...b,
      ratingAvg: rs.length ? Math.round((rs.reduce((s, r) => s + r.rating, 0) / rs.length) * 10) / 10 : 0,
      ratingCount: rs.length,
      createdAt: '2025-09-01T00:00:00.000Z',
    };
  });

  const payments = seed.payments
    .filter((p) => kept.has(p.appointmentId))
    .map((p) => ({ ...p, providerRef: `SEED-${p.id.slice(-6)}`, createdAt: appointments.find((a) => a.id === p.appointmentId)!.createdAt }));

  const clients: Client[] = seed.clients.map((c) => ({
    id: c.id,
    businessId: c.businessId,
    profileId: c.profileId,
    firstName: c.firstName,
    lastName: c.lastName,
    phone: c.phone,
    email: c.email,
    createdAt: addDays(todayIn('UTC', now), c.createdDayOffset) + 'T09:00:00.000Z',
  }));

  const profile = (a: { id: string; firstName: string; lastName: string; phone: string; email: string }, role: Profile['role']): Profile => ({
    id: a.id,
    role,
    firstName: a.firstName,
    lastName: a.lastName,
    phone: a.phone,
    email: a.email,
    locale: 'fr',
    countryCode: 'CG',
    createdAt: '2025-09-01T00:00:00.000Z',
  });

  return {
    version: VERSION,
    seededAt: nowIso,
    countries: structuredClone(COUNTRIES),
    cities: structuredClone(CITIES),
    categories: structuredClone(CATEGORIES),
    profiles: [
      profile(DEMO_ACCOUNTS.client, 'client'),
      profile(DEMO_ACCOUNTS.owner, 'business_owner'),
      profile(DEMO_ACCOUNTS.admin, 'admin'),
    ],
    credentials: [
      { email: DEMO_ACCOUNTS.owner.email, password: DEMO_ACCOUNTS.owner.password, profileId: DEMO_ACCOUNTS.owner.id },
      { email: DEMO_ACCOUNTS.admin.email, password: DEMO_ACCOUNTS.admin.password, profileId: DEMO_ACCOUNTS.admin.id },
    ],
    businesses,
    staff: seed.staff,
    services: seed.services,
    staffServices: seed.staffServices,
    businessHours: seed.businessHours,
    staffHours: seed.staffHours,
    timeOff: [],
    clients,
    clientNotes: seed.notes.map((n) => ({ ...n, createdAt: '2026-01-15T10:00:00.000Z' })),
    appointments,
    payments,
    reviews,
    favorites: [{ profileId: DEMO_ACCOUNTS.client.id, businessId: businesses[1].id }],
    notifications: [],
    remindedIds: appointments.filter((a) => Date.parse(a.startsAt) <= now.getTime()).map((a) => a.id),
    rateLimits: [],
  };
}

type Listener = (msg: SyncMessage) => void;
export type SyncMessage = { kind: 'appointment'; type: 'INSERT' | 'UPDATE'; appointment: Appointment } | { kind: 'reset' } | { kind: 'write' };

/** Storage wrapper: tolerant to private mode / blocked storage (falls back to memory). */
export class DemoDb {
  state: DemoState;
  private channel: BroadcastChannel | null = null;
  private listeners = new Set<Listener>();
  private memoryOnly = false;

  constructor(
    private storage: Pick<Storage, 'getItem' | 'setItem'> | null = typeof localStorage !== 'undefined' ? localStorage : null,
    opts: { sync?: boolean; now?: Date } = {},
  ) {
    this.state = this.load() ?? this.reset(false, opts.now);
    if (opts.sync !== false && typeof BroadcastChannel !== 'undefined') {
      this.channel = new BroadcastChannel('kuzuri-demo');
      this.channel.onmessage = (e: MessageEvent<SyncMessage>) => {
        this.state = this.load() ?? this.state;
        this.listeners.forEach((l) => l(e.data));
      };
    }
  }

  private load(): DemoState | null {
    if (!this.storage || this.memoryOnly) return null;
    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as DemoState;
      return parsed.version === VERSION ? parsed : null;
    } catch {
      return null;
    }
  }

  /** Re-reads storage so a write in another tab is taken into account before validating. */
  refresh() {
    const s = this.load();
    if (s) this.state = s;
  }

  save(msg: SyncMessage = { kind: 'write' }) {
    if (this.storage && !this.memoryOnly) {
      try {
        this.storage.setItem(STORAGE_KEY, JSON.stringify(this.state));
      } catch {
        this.memoryOnly = true;
      }
    }
    this.channel?.postMessage(msg);
    this.listeners.forEach((l) => l(msg));
  }

  reset(broadcast = true, now?: Date): DemoState {
    this.state = materialise(now);
    if (broadcast) this.save({ kind: 'reset' });
    else if (this.storage) {
      try {
        this.storage.setItem(STORAGE_KEY, JSON.stringify(this.state));
      } catch {
        this.memoryOnly = true;
      }
    }
    return this.state;
  }

  subscribe(l: Listener) {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
}
