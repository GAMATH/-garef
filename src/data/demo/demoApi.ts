import type {
  AdminStats,
  Api,
  ClientDetail,
  ClientWithStats,
  DashboardStats,
  HoldInput,
  OnboardingInput,
  Page,
  PaymentInput,
  PaymentProgress,
  ProAppointmentInput,
  RealtimeEvent,
  Reference,
  SearchParams,
  SlotQuery,
  Suggestions,
} from '../api';
import { ApiError } from '../api';
import type {
  Appointment,
  AppointmentStatus,
  AppointmentView,
  Business,
  BusinessHours,
  Category,
  City,
  Client,
  ClientNote,
  Country,
  DayAvailability,
  NotificationEvent,
  Payment,
  Profile,
  Review,
  SalonDetail,
  SalonSummary,
  Service,
  Slot,
  Staff,
  StaffHours,
  TimeOff,
} from '@/lib/types';
import { computeDays, computeSlots, eligibleStaff, isBlocking, nearestSlots } from '@/lib/booking-engine';
import { depositForServices } from '@/lib/money';
import { addDays, addMinutes, todayIn, zonedParts } from '@/lib/time';
import { getProvider } from '@/lib/payments';
import { EVENT_CHANNEL } from '@/lib/notifications';
import { STAFF_COLORS } from '../reference';
import { DEMO_ACCOUNTS, makeReference } from '../seed';
import { DemoDb, uid } from './db';

export type Translate = (key: string, vars?: Record<string, string | number>) => string;

export interface DemoApiOptions {
  db?: DemoDb;
  now?: () => Date;
  latencyMs?: number;
  t?: Translate;
  /** Persist the signed-in profile id. */
  sessionStorage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
}

const HOLD_MINUTES = 10;
const OTP_CODE = DEMO_ACCOUNTS.client.otp;
const SESSION_KEY = 'kuzuri-session';

const clone = <T,>(v: T): T => structuredClone(v);
const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

export class DemoApi implements Api {
  readonly mode = 'demo' as const;
  readonly db: DemoDb;
  private now: () => Date;
  private latency: number;
  private t: Translate;
  private session: DemoApiOptions['sessionStorage'];

  constructor(opts: DemoApiOptions = {}) {
    this.db = opts.db ?? new DemoDb();
    this.now = opts.now ?? (() => new Date());
    this.latency = opts.latencyMs ?? 120;
    this.t = opts.t ?? ((k) => k);
    this.session = opts.sessionStorage === undefined ? (typeof localStorage !== 'undefined' ? localStorage : null) : opts.sessionStorage;
    this.runJobs();
  }

  private get s() {
    return this.db.state;
  }

  private async wait<T>(fn: () => T | Promise<T>): Promise<T> {
    if (this.latency > 0) await new Promise((r) => setTimeout(r, this.latency));
    this.db.refresh();
    return await fn();
  }

  /** pg_cron equivalent: release expired holds + D-1 reminders. Called on every read. */
  runJobs() {
    const now = this.now();
    let changed = false;
    for (const a of this.s.appointments) {
      if (a.status === 'pending_payment' && a.holdExpiresAt && Date.parse(a.holdExpiresAt) <= now.getTime()) {
        a.status = 'cancelled';
        a.paymentStatus = 'failed';
        a.holdExpiresAt = null;
        for (const p of this.s.payments) if (p.appointmentId === a.id && p.status === 'pending') p.status = 'failed';
        changed = true;
      }
      const startsIn = Date.parse(a.startsAt) - now.getTime();
      if (a.status === 'confirmed' && startsIn > 0 && startsIn <= 86400000 && !this.s.remindedIds.includes(a.id)) {
        this.s.remindedIds.push(a.id);
        this.notify(a, 'reminder_d1');
        changed = true;
      }
    }
    if (changed) this.db.save();
  }

  /* ------------------------------------------------------------------ helpers */

  private business(id: string) {
    const b = this.s.businesses.find((x) => x.id === id);
    if (!b) throw new ApiError('NOT_FOUND');
    return b;
  }
  private city(id: string) {
    return this.s.cities.find((c) => c.id === id)!;
  }
  private tz(businessId: string) {
    return this.city(this.business(businessId).cityId).timezone;
  }
  private country(cityId: string) {
    const c = this.city(cityId);
    return this.s.countries.find((x) => x.code === c.countryCode)!;
  }

  private rateLimit(key: string, max: number, windowMs: number) {
    const now = this.now().getTime();
    this.s.rateLimits = this.s.rateLimits.filter((r) => now - r.at < windowMs || r.key !== key);
    if (this.s.rateLimits.filter((r) => r.key === key).length >= max) throw new ApiError('RATE_LIMITED');
    this.s.rateLimits.push({ key, at: now });
  }

  private engineInput(q: SlotQuery) {
    const b = this.business(q.businessId);
    const services = q.serviceIds.map((id) => this.s.services.find((s) => s.id === id && s.businessId === b.id && s.active));
    if (services.some((s) => !s) || services.length === 0) throw new ApiError('NOT_FOUND');
    const staff = this.s.staff.filter((x) => x.businessId === b.id);
    let staffIds = eligibleStaff(staff, this.s.staffServices, q.serviceIds);
    if (q.staffId) staffIds = staffIds.filter((id) => id === q.staffId);
    return {
      timezone: this.city(b.cityId).timezone,
      slotStepMin: b.slotStepMin,
      minNoticeMin: b.minNoticeMin,
      durationMin: services.reduce((sum, s) => sum + s!.durationMin, 0),
      staffIds: b.status === 'active' ? staffIds : [],
      businessHours: this.s.businessHours.filter((h) => h.businessId === b.id),
      staffHours: this.s.staffHours.filter((h) => staffIds.includes(h.staffId)),
      timeOff: this.s.timeOff.filter((t) => t.businessId === b.id),
      appointments: this.s.appointments.filter((a) => a.businessId === b.id),
      now: this.now(),
      excludeAppointmentId: q.excludeAppointmentId,
      services: services as Service[],
      business: b,
    };
  }

  private slotsFor(q: SlotQuery, date: string) {
    const { services: _s, business: _b, ...input } = this.engineInput(q);
    return computeSlots({ ...input, date });
  }

  private alternatives(q: SlotQuery, start: string): Slot[] {
    const tz = this.tz(q.businessId);
    const day = zonedParts(start, tz).date;
    const same = nearestSlots(this.slotsFor(q, day), start, 3);
    if (same.length >= 3) return same;
    for (let i = 1; i <= 7 && same.length < 3; i++) {
      for (const s of this.slotsFor(q, addDays(day, i))) {
        if (same.length >= 3) break;
        same.push(s);
      }
    }
    return same;
  }

  private nextSlot(b: Business): { start: string; serviceId: string } | null {
    const services = this.s.services
      .filter((s) => s.businessId === b.id && s.active && this.s.staffServices.some((x) => x.serviceId === s.id && this.s.staff.find((st) => st.id === x.staffId)?.active))
      .sort((a, c) => a.durationMin - c.durationMin || a.price - c.price);
    if (!services.length) return null;
    const tz = this.city(b.cityId).timezone;
    const today = todayIn(tz, this.now());
    for (let i = 0; i < 7; i++) {
      const slots = this.slotsFor({ businessId: b.id, serviceIds: [services[0].id], staffId: null }, addDays(today, i));
      if (slots.length) return { start: slots[0].start, serviceId: services[0].id };
    }
    return null;
  }

  private summary(b: Business, near?: { lat: number; lng: number } | null): SalonSummary {
    const services = this.s.services.filter((s) => s.businessId === b.id && s.active);
    const next = this.nextSlot(b);
    return {
      business: clone(b),
      city: clone(this.city(b.cityId)),
      minPrice: services.length ? Math.min(...services.map((s) => s.price)) : 0,
      nextSlot: next?.start ?? null,
      nextSlotServiceId: next?.serviceId ?? null,
      distanceKm: near ? Math.round(haversineKm(near, b) * 10) / 10 : null,
      acceptsMobileMoney: b.paymentMethods.includes('mobile_money'),
      categoryIds: [...new Set(services.map((s) => s.categoryId))],
    };
  }

  private view(a: Appointment): AppointmentView {
    const b = this.business(a.businessId);
    return clone({
      ...a,
      business: b,
      city: this.city(b.cityId),
      staff: this.s.staff.find((s) => s.id === a.staffId) ?? null,
      client: this.s.clients.find((c) => c.id === a.clientId)!,
      hasReview: this.s.reviews.some((r) => r.appointmentId === a.id),
    });
  }

  private emit(a: Appointment, type: 'INSERT' | 'UPDATE') {
    this.db.save({ kind: 'appointment', type, appointment: clone(a) });
  }

  private notify(a: Appointment, event: NotificationEvent) {
    const b = this.business(a.businessId);
    const client = this.s.clients.find((c) => c.id === a.clientId)!;
    const p = zonedParts(a.startsAt, this.city(b.cityId).timezone);
    const vars = {
      name: client.firstName,
      salon: b.name,
      services: a.services.map((s) => s.name).join(', '),
      date: `${p.date.slice(8, 10)}/${p.date.slice(5, 7)}`,
      time: p.time.replace(':', 'h'),
      reference: a.reference,
    };
    const push = (ev: NotificationEvent, recipient: string) =>
      this.s.notifications.unshift({
        id: uid(),
        channel: EVENT_CHANNEL[ev],
        event: ev,
        recipient,
        body: this.t(`notifications.${ev}`, vars),
        businessId: b.id,
        appointmentId: a.id,
        createdAt: this.now().toISOString(),
      });
    if (event === 'booking_confirmed') {
      push('booking_confirmed', client.phone);
      push('new_booking_salon', b.whatsapp);
    } else {
      push(event, client.phone);
    }
  }

  private upsertClient(businessId: string, c: { firstName: string; lastName?: string; phone: string; email?: string }, profileId: string | null): Client {
    let client = this.s.clients.find((x) => x.businessId === businessId && x.phone === c.phone);
    if (client) {
      client.firstName = c.firstName.trim() || client.firstName;
      if (c.lastName) client.lastName = c.lastName.trim();
      if (c.email) client.email = c.email.trim();
      if (!client.profileId && profileId) client.profileId = profileId;
    } else {
      client = {
        id: uid(),
        businessId,
        profileId,
        firstName: c.firstName.trim(),
        lastName: (c.lastName ?? '').trim(),
        phone: c.phone,
        email: (c.email ?? '').trim(),
        createdAt: this.now().toISOString(),
      };
      this.s.clients.push(client);
    }
    return client;
  }

  private reference() {
    let ref = makeReference();
    while (this.s.appointments.some((a) => a.reference === ref)) ref = makeReference();
    return ref;
  }

  private overlapsBlocking(staffId: string, start: number, end: number, excludeId?: string) {
    const now = this.now();
    return this.s.appointments.some(
      (a) => a.staffId === staffId && a.id !== excludeId && isBlocking(a, now) && Date.parse(a.startsAt) < end && start < Date.parse(a.endsAt),
    );
  }

  private refreshRating(businessId: string) {
    const b = this.business(businessId);
    const rs = this.s.reviews.filter((r) => r.businessId === businessId);
    b.ratingCount = rs.length;
    b.ratingAvg = rs.length ? Math.round((rs.reduce((s, r) => s + r.rating, 0) / rs.length) * 10) / 10 : 0;
  }

  /* ------------------------------------------------------------------ reference & discovery */

  getReference(): Promise<Reference> {
    return this.wait(() => clone({ countries: this.s.countries, cities: this.s.cities, categories: [...this.s.categories].sort((a, b) => a.sort - b.sort) }));
  }

  searchSalons(p: SearchParams): Promise<Page<SalonSummary>> {
    return this.wait(() => {
      this.runJobs();
      const q = norm(p.q?.trim() ?? '');
      const category = p.categorySlug ? this.s.categories.find((c) => c.slug === p.categorySlug) : null;
      let list = this.s.businesses.filter((b) => b.status === 'active');
      if (p.cityId) list = list.filter((b) => b.cityId === p.cityId);
      if (p.countryCode) list = list.filter((b) => this.city(b.cityId).countryCode === p.countryCode);
      if (category) list = list.filter((b) => this.s.services.some((s) => s.businessId === b.id && s.active && s.categoryId === category.id));
      const score = new Map<string, number>();
      if (q) {
        const terms = q.split(/\s+/).filter(Boolean);
        list = list.filter((b) => {
          const hay = [b.name, b.district, this.city(b.cityId).name, ...this.s.services.filter((s) => s.businessId === b.id && s.active).map((s) => s.name), ...this.s.services.filter((s) => s.businessId === b.id && s.active).map((s) => this.s.categories.find((c) => c.id === s.categoryId)?.slug ?? '')].map(norm);
          const ok = terms.every((t) => hay.some((h) => h.split(/[^a-z0-9]+/).some((w) => w.startsWith(t)) || h.includes(t)));
          if (ok) score.set(b.id, terms.reduce((s, t) => s + (norm(b.name).includes(t) ? 2 : 1), 0));
          return ok;
        });
      }
      if (p.mobileMoney) list = list.filter((b) => b.paymentMethods.includes('mobile_money'));
      if (p.instantOnly) list = list.filter((b) => b.instantBooking);
      if (p.audience) list = list.filter((b) => b.audience === p.audience || b.audience === 'unisex');
      if (p.minRating) list = list.filter((b) => b.ratingAvg >= p.minRating!);
      let items = list.map((b) => this.summary(b, p.near));
      if (p.maxPrice) items = items.filter((x) => x.minPrice <= p.maxPrice!);
      if (p.availableToday) {
        items = items.filter((x) => x.nextSlot && zonedParts(x.nextSlot, x.city.timezone).date === todayIn(x.city.timezone, this.now()));
      }
      const sort = p.sort ?? 'relevance';
      const nextKey = (x: SalonSummary) => (x.nextSlot ? Date.parse(x.nextSlot) : Infinity);
      items.sort((a, b) => {
        if (sort === 'distance' && a.distanceKm !== null && b.distanceKm !== null) return a.distanceKm - b.distanceKm;
        if (sort === 'price') return a.minPrice - b.minPrice;
        if (sort === 'rating') return b.business.ratingAvg - a.business.ratingAvg;
        if (sort === 'relevance' && q) return (score.get(b.business.id) ?? 0) - (score.get(a.business.id) ?? 0) || nextKey(a) - nextKey(b);
        return nextKey(a) - nextKey(b) || b.business.ratingAvg - a.business.ratingAvg;
      });
      const offset = p.offset ?? 0;
      const limit = p.limit ?? 12;
      return { items: items.slice(offset, offset + limit), nextOffset: offset + limit < items.length ? offset + limit : null, total: items.length };
    });
  }

  suggest(q: string): Promise<Suggestions> {
    return this.wait(() => {
      const n = norm(q.trim());
      if (!n) return { services: [], salons: [], categories: [] };
      const services = [...new Set(this.s.services.filter((s) => s.active && norm(s.name).includes(n)).map((s) => s.name))].slice(0, 4);
      const salons = this.s.businesses
        .filter((b) => b.status === 'active' && (norm(b.name).includes(n) || norm(b.district).includes(n)))
        .slice(0, 4)
        .map((b) => ({ slug: b.slug, name: b.name, district: b.district, city: this.city(b.cityId).name }));
      const categories = this.s.categories.filter((c) => norm(c.slug.replace(/-/g, ' ')).includes(n)).slice(0, 3);
      return clone({ services, salons, categories });
    });
  }

  getSalon(slug: string): Promise<SalonDetail> {
    return this.wait(() => {
      const b = this.s.businesses.find((x) => x.slug === slug);
      if (!b || b.status !== 'active') throw new ApiError('NOT_FOUND');
      const services = this.s.services.filter((s) => s.businessId === b.id && s.active).sort((a, c) => a.sort - c.sort);
      const staff = this.s.staff.filter((s) => s.businessId === b.id && s.active).sort((a, c) => a.sort - c.sort);
      const city = this.city(b.cityId);
      return clone({
        business: b,
        city,
        country: this.country(b.cityId),
        services,
        staff,
        staffServices: this.s.staffServices.filter((x) => staff.some((s) => s.id === x.staffId)),
        hours: this.s.businessHours.filter((h) => h.businessId === b.id),
        reviews: this.s.reviews.filter((r) => r.businessId === b.id).sort((a, c) => c.createdAt.localeCompare(a.createdAt)),
        categories: this.s.categories.filter((c) => services.some((s) => s.categoryId === c.id)).sort((a, c) => a.sort - c.sort),
      });
    });
  }

  /* ------------------------------------------------------------------ booking engine */

  getAvailableDays(q: SlotQuery, from: string, count: number): Promise<DayAvailability[]> {
    return this.wait(() => {
      this.runJobs();
      const { services: _s, business: _b, ...input } = this.engineInput(q);
      return computeDays(input, from, count);
    });
  }

  getSlots(q: SlotQuery & { date: string }): Promise<Slot[]> {
    return this.wait(() => {
      this.runJobs();
      return this.slotsFor(q, q.date);
    });
  }

  createHold(input: HoldInput): Promise<Appointment> {
    return this.wait(() => {
      if (!input.contact.firstName.trim() || !/^\+\d{8,15}$/.test(input.contact.phone)) throw new ApiError('UNKNOWN', 'INVALID_INPUT');
      this.rateLimit(`hold:${input.contact.phone}`, 6, 10 * 60000);
      this.runJobs();
      const ctx = this.engineInput(input);
      const tz = ctx.timezone;
      const slot = this.slotsFor(input, zonedParts(input.start, tz).date).find((s) => s.start === input.start);
      if (!slot) throw new ApiError('SLOT_TAKEN', undefined, this.alternatives(input, input.start));
      const staffId = slot.staffIds[0];
      const client = this.upsertClient(input.businessId, input.contact, input.profileId);
      const total = ctx.services.reduce((s, x) => s + x.price, 0);
      const appt: Appointment = {
        id: uid(),
        reference: this.reference(),
        businessId: input.businessId,
        staffId,
        clientId: client.id,
        profileId: input.profileId,
        startsAt: input.start,
        endsAt: addMinutes(input.start, ctx.durationMin).toISOString(),
        status: 'pending_payment',
        paymentStatus: 'pending',
        total,
        deposit: depositForServices(ctx.services, ctx.business.depositRule),
        amountPaid: 0,
        holdExpiresAt: addMinutes(this.now(), HOLD_MINUTES).toISOString(),
        source: 'online',
        services: ctx.services.map((s) => ({ serviceId: s.id, name: s.name, durationMin: s.durationMin, price: s.price })),
        createdAt: this.now().toISOString(),
      };
      this.s.appointments.push(appt);
      this.emit(appt, 'INSERT');
      return clone(appt);
    });
  }

  releaseHold(appointmentId: string): Promise<void> {
    return this.wait(() => {
      const a = this.s.appointments.find((x) => x.id === appointmentId);
      if (a && a.status === 'pending_payment') {
        a.status = 'cancelled';
        a.paymentStatus = 'failed';
        a.holdExpiresAt = null;
        this.emit(a, 'UPDATE');
      }
    });
  }

  initiatePayment(input: PaymentInput): Promise<PaymentProgress> {
    return this.wait(async () => {
      const a = this.s.appointments.find((x) => x.id === input.appointmentId);
      if (!a) throw new ApiError('NOT_FOUND');
      if (a.status !== 'pending_payment' || !a.holdExpiresAt || Date.parse(a.holdExpiresAt) <= this.now().getTime()) {
        this.runJobs();
        throw new ApiError('HOLD_EXPIRED');
      }
      const b = this.business(a.businessId);
      if (!b.paymentOptions.includes(input.option)) throw new ApiError('FORBIDDEN');
      if (input.option === 'on_site') {
        a.status = 'confirmed';
        a.paymentStatus = 'pay_on_site';
        a.holdExpiresAt = null;
        this.notify(a, 'booking_confirmed');
        this.emit(a, 'UPDATE');
        return { paymentId: null, status: 'succeeded' as const, appointment: clone(a) };
      }
      if (input.method === 'cash' || !b.paymentMethods.includes(input.method)) throw new ApiError('FORBIDDEN');
      const amount = input.option === 'deposit' ? a.deposit : a.total;
      if (amount <= 0) throw new ApiError('FORBIDDEN');
      const providerId = input.method === 'card' ? 'card' : input.operator ?? this.country(b.cityId).operators[0];
      const provider = getProvider(providerId, () => this.now().getTime());
      const { providerRef } = await provider.initiate({ amount, currency: this.country(b.cityId).currency, reference: a.reference, phone: input.phone });
      const payment: Payment & { providerRef: string } = {
        id: uid(),
        appointmentId: a.id,
        businessId: b.id,
        provider: providerId,
        method: input.method,
        amount,
        status: 'pending',
        phone: input.phone ?? null,
        providerRef,
        createdAt: this.now().toISOString(),
      };
      this.s.payments.unshift(payment);
      this.db.save();
      return { paymentId: payment.id, status: 'pending' as const, appointment: clone(a) };
    });
  }

  verifyPayment(paymentId: string): Promise<PaymentProgress> {
    return this.wait(async () => {
      const p = this.s.payments.find((x) => x.id === paymentId);
      if (!p) throw new ApiError('NOT_FOUND');
      const a = this.s.appointments.find((x) => x.id === p.appointmentId)!;
      if (p.status === 'pending') {
        const holdAlive = a.status === 'pending_payment' && !!a.holdExpiresAt && Date.parse(a.holdExpiresAt) > this.now().getTime();
        const result = holdAlive ? await getProvider(p.provider as never, () => this.now().getTime()).verify(p.providerRef) : 'failed';
        if (result === 'succeeded') {
          p.status = 'succeeded';
          a.status = 'confirmed';
          a.holdExpiresAt = null;
          a.amountPaid = p.amount;
          a.paymentStatus = p.amount >= a.total ? 'paid' : 'deposit_paid';
          this.notify(a, 'booking_confirmed');
          this.emit(a, 'UPDATE');
        } else if (result === 'failed') {
          p.status = 'failed';
          if (a.status === 'pending_payment') {
            a.status = 'cancelled';
            a.paymentStatus = 'failed';
            a.holdExpiresAt = null;
          }
          this.emit(a, 'UPDATE');
        }
      }
      const status = p.status === 'succeeded' ? 'succeeded' : p.status === 'pending' ? 'pending' : 'failed';
      return { paymentId: p.id, status, appointment: clone(a) };
    });
  }

  getBooking(reference: string): Promise<AppointmentView> {
    return this.wait(() => {
      const a = this.s.appointments.find((x) => x.reference === reference.toUpperCase());
      if (!a) throw new ApiError('NOT_FOUND');
      return this.view(a);
    });
  }

  /* ------------------------------------------------------------------ auth */

  private currentId(): string | null {
    try {
      return this.session?.getItem(SESSION_KEY) ?? null;
    } catch {
      return null;
    }
  }
  private setSession(id: string | null) {
    try {
      if (id) this.session?.setItem(SESSION_KEY, id);
      else this.session?.removeItem(SESSION_KEY);
    } catch {
      /* storage blocked: session lives in memory only */
    }
  }

  getSession(): Promise<Profile | null> {
    return this.wait(() => {
      const id = this.currentId();
      return clone(this.s.profiles.find((p) => p.id === id) ?? null);
    });
  }

  sendOtp(phone: string): Promise<{ devCode: string | null }> {
    return this.wait(() => {
      this.rateLimit(`otp:${phone}`, 5, 10 * 60000);
      this.db.save();
      return { devCode: OTP_CODE };
    });
  }

  verifyOtp(phone: string, code: string, firstName?: string): Promise<Profile> {
    return this.wait(() => {
      if (code !== OTP_CODE) throw new ApiError('INVALID_OTP');
      let profile = this.s.profiles.find((p) => p.phone === phone);
      if (!profile) {
        const client = this.s.clients.find((c) => c.phone === phone);
        const country = this.s.countries.find((c) => phone.startsWith(c.dialCode));
        profile = {
          id: uid(),
          role: 'client',
          firstName: firstName?.trim() || client?.firstName || '',
          lastName: client?.lastName ?? '',
          phone,
          email: '',
          locale: 'fr',
          countryCode: country?.code ?? 'CG',
          createdAt: this.now().toISOString(),
        };
        this.s.profiles.push(profile);
      }
      // Attach past guest bookings made with this phone number.
      for (const c of this.s.clients) {
        if (c.phone === phone && !c.profileId) c.profileId = profile.id;
      }
      for (const a of this.s.appointments) {
        if (!a.profileId && this.s.clients.find((c) => c.id === a.clientId)?.phone === phone) a.profileId = profile.id;
      }
      this.db.save();
      this.setSession(profile.id);
      return clone(profile);
    });
  }

  signInWithPassword(email: string, password: string): Promise<Profile> {
    return this.wait(() => {
      const cred = this.s.credentials.find((c) => c.email.toLowerCase() === email.trim().toLowerCase() && c.password === password);
      if (!cred) throw new ApiError('INVALID_CREDENTIALS');
      this.setSession(cred.profileId);
      return clone(this.s.profiles.find((p) => p.id === cred.profileId)!);
    });
  }

  signUpOwner(input: { email: string; password: string; firstName: string; phone: string }): Promise<Profile> {
    return this.wait(() => {
      if (this.s.credentials.some((c) => c.email.toLowerCase() === input.email.toLowerCase())) throw new ApiError('EMAIL_TAKEN');
      const country = this.s.countries.find((c) => input.phone.startsWith(c.dialCode));
      const profile: Profile = {
        id: uid(),
        role: 'business_owner',
        firstName: input.firstName.trim(),
        lastName: '',
        phone: input.phone,
        email: input.email.trim(),
        locale: 'fr',
        countryCode: country?.code ?? 'CG',
        createdAt: this.now().toISOString(),
      };
      this.s.profiles.push(profile);
      this.s.credentials.push({ email: profile.email, password: input.password, profileId: profile.id });
      this.db.save();
      this.setSession(profile.id);
      return clone(profile);
    });
  }

  signOut(): Promise<void> {
    return this.wait(() => this.setSession(null));
  }

  updateProfile(id: string, patch: Partial<Pick<Profile, 'firstName' | 'lastName' | 'email' | 'locale' | 'countryCode'>>): Promise<Profile> {
    return this.wait(() => {
      const p = this.s.profiles.find((x) => x.id === id);
      if (!p) throw new ApiError('NOT_FOUND');
      Object.assign(p, patch);
      this.db.save();
      return clone(p);
    });
  }

  /* ------------------------------------------------------------------ client space */

  listMyAppointments(profileId: string): Promise<AppointmentView[]> {
    return this.wait(() => {
      this.runJobs();
      return this.s.appointments
        .filter((a) => a.profileId === profileId && a.status !== 'pending_payment' && !(a.status === 'cancelled' && a.paymentStatus === 'failed'))
        .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
        .map((a) => this.view(a));
    });
  }

  cancelAppointment(id: string, by: 'client' | 'salon'): Promise<void> {
    return this.wait(() => {
      const a = this.s.appointments.find((x) => x.id === id);
      if (!a) throw new ApiError('NOT_FOUND');
      const b = this.business(a.businessId);
      if (by === 'client' && Date.parse(a.startsAt) - this.now().getTime() < b.cancellationHours * 3600000) throw new ApiError('CANCELLATION_TOO_LATE');
      if (!['pending_payment', 'confirmed'].includes(a.status)) throw new ApiError('FORBIDDEN');
      a.status = 'cancelled';
      a.holdExpiresAt = null;
      if (a.amountPaid > 0) {
        a.paymentStatus = 'refunded';
        for (const p of this.s.payments) if (p.appointmentId === a.id && p.status === 'succeeded') p.status = 'refunded';
      }
      this.notify(a, 'booking_cancelled');
      this.emit(a, 'UPDATE');
    });
  }

  rescheduleAppointment(id: string, start: string, staffId: string | null): Promise<Appointment> {
    return this.wait(() => {
      const a = this.s.appointments.find((x) => x.id === id);
      if (!a) throw new ApiError('NOT_FOUND');
      const b = this.business(a.businessId);
      if (Date.parse(a.startsAt) - this.now().getTime() < b.cancellationHours * 3600000) throw new ApiError('CANCELLATION_TOO_LATE');
      const q = { businessId: a.businessId, serviceIds: a.services.map((s) => s.serviceId), staffId, excludeAppointmentId: a.id };
      const slot = this.slotsFor(q, zonedParts(start, this.tz(a.businessId)).date).find((s) => s.start === start);
      if (!slot) throw new ApiError('SLOT_TAKEN', undefined, this.alternatives(q, start));
      const duration = a.services.reduce((s, x) => s + x.durationMin, 0);
      a.staffId = !staffId && slot.staffIds.includes(a.staffId) ? a.staffId : slot.staffIds[0];
      a.startsAt = start;
      a.endsAt = addMinutes(start, duration).toISOString();
      this.s.remindedIds = this.s.remindedIds.filter((x) => x !== a.id);
      this.emit(a, 'UPDATE');
      return clone(a);
    });
  }

  createReview(input: { appointmentId: string; rating: number; comment: string; profileId: string }): Promise<Review> {
    return this.wait(() => {
      const a = this.s.appointments.find((x) => x.id === input.appointmentId);
      if (!a || a.profileId !== input.profileId || a.status !== 'completed') throw new ApiError('FORBIDDEN');
      if (this.s.reviews.some((r) => r.appointmentId === a.id)) throw new ApiError('FORBIDDEN');
      const client = this.s.clients.find((c) => c.id === a.clientId)!;
      const review: Review = {
        id: uid(),
        appointmentId: a.id,
        businessId: a.businessId,
        profileId: input.profileId,
        authorName: `${client.firstName}${client.lastName ? ' ' + client.lastName[0] + '.' : ''}`,
        rating: Math.max(1, Math.min(5, Math.round(input.rating))),
        comment: input.comment.trim().slice(0, 1000),
        reply: null,
        createdAt: this.now().toISOString(),
      };
      this.s.reviews.unshift(review);
      this.refreshRating(a.businessId);
      this.db.save();
      return clone(review);
    });
  }

  listFavoriteIds(profileId: string): Promise<string[]> {
    return this.wait(() => this.s.favorites.filter((f) => f.profileId === profileId).map((f) => f.businessId));
  }

  listFavorites(profileId: string): Promise<SalonSummary[]> {
    return this.wait(() =>
      this.s.favorites
        .filter((f) => f.profileId === profileId)
        .map((f) => this.s.businesses.find((b) => b.id === f.businessId))
        .filter((b): b is Business => !!b && b.status === 'active')
        .map((b) => this.summary(b)),
    );
  }

  toggleFavorite(profileId: string, businessId: string): Promise<boolean> {
    return this.wait(() => {
      const i = this.s.favorites.findIndex((f) => f.profileId === profileId && f.businessId === businessId);
      if (i >= 0) this.s.favorites.splice(i, 1);
      else this.s.favorites.push({ profileId, businessId });
      this.db.save();
      return i < 0;
    });
  }

  /* ------------------------------------------------------------------ pro space */

  getMyBusiness(profileId: string): Promise<Business | null> {
    return this.wait(() => clone(this.s.businesses.find((b) => b.ownerId === profileId) ?? null));
  }

  getBusinessBundle(businessId: string) {
    return this.wait(() => {
      const b = this.business(businessId);
      const allServices = this.s.services.filter((s) => s.businessId === b.id).sort((a, c) => a.sort - c.sort);
      const allStaff = this.s.staff.filter((s) => s.businessId === b.id).sort((a, c) => a.sort - c.sort);
      return clone({
        business: b,
        city: this.city(b.cityId),
        country: this.country(b.cityId),
        services: allServices.filter((s) => s.active),
        staff: allStaff.filter((s) => s.active),
        staffServices: this.s.staffServices.filter((x) => allStaff.some((s) => s.id === x.staffId)),
        hours: this.s.businessHours.filter((h) => h.businessId === b.id),
        reviews: this.s.reviews.filter((r) => r.businessId === b.id).sort((a, c) => c.createdAt.localeCompare(a.createdAt)),
        categories: [...this.s.categories].sort((a, c) => a.sort - c.sort),
        staffHours: this.s.staffHours.filter((h) => allStaff.some((s) => s.id === h.staffId)),
        timeOff: this.s.timeOff.filter((t) => t.businessId === b.id).sort((a, c) => a.startsAt.localeCompare(c.startsAt)),
        allServices,
        allStaff,
      });
    });
  }

  getDashboard(businessId: string): Promise<DashboardStats> {
    return this.wait(() => {
      this.runJobs();
      const tz = this.tz(businessId);
      const now = this.now();
      const today = todayIn(tz, now);
      const appts = this.s.appointments.filter((a) => a.businessId === businessId);
      const dayOf = (iso: string) => zonedParts(iso, tz).date;
      const earning = (a: Appointment) => ['confirmed', 'checked_in', 'completed'].includes(a.status);
      const last30 = appts.filter((a) => Date.parse(a.startsAt) <= now.getTime() && Date.parse(a.startsAt) >= now.getTime() - 30 * 86400000);
      const finished = last30.filter((a) => a.status === 'completed' || a.status === 'no_show');
      return {
        revenueToday: appts.filter((a) => dayOf(a.startsAt) === today && earning(a)).reduce((s, a) => s + a.total, 0),
        appointmentsToday: appts.filter((a) => dayOf(a.startsAt) === today && !['cancelled', 'pending_payment'].includes(a.status)).length,
        newClients30d: this.s.clients.filter((c) => c.businessId === businessId && Date.parse(c.createdAt) >= now.getTime() - 30 * 86400000).length,
        noShowRate30d: finished.length ? Math.round((1000 * finished.filter((a) => a.status === 'no_show').length) / finished.length) / 10 : 0,
        revenue7d: Array.from({ length: 7 }, (_, i) => {
          const date = addDays(today, i - 6);
          return { date, amount: appts.filter((a) => dayOf(a.startsAt) === date && earning(a)).reduce((s, a) => s + a.total, 0) };
        }),
      };
    });
  }

  listAppointments(q: { businessId: string; from: string; to: string; status?: AppointmentStatus | null }): Promise<AppointmentView[]> {
    return this.wait(() => {
      this.runJobs();
      const now = this.now();
      return this.s.appointments
        .filter((a) => a.businessId === q.businessId && a.startsAt >= q.from && a.startsAt < q.to)
        .filter((a) => (q.status ? a.status === q.status : a.status !== 'pending_payment' || isBlocking(a, now)))
        .filter((a) => !(a.status === 'cancelled' && a.paymentStatus === 'failed'))
        .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
        .map((a) => this.view(a));
    });
  }

  setAppointmentStatus(id: string, status: AppointmentStatus): Promise<void> {
    if (status === 'cancelled') return this.cancelAppointment(id, 'salon');
    return this.wait(() => {
      const a = this.s.appointments.find((x) => x.id === id);
      if (!a) throw new ApiError('NOT_FOUND');
      a.status = status;
      if (status === 'completed') {
        a.paymentStatus = 'paid';
        a.amountPaid = a.total;
      }
      this.emit(a, 'UPDATE');
    });
  }

  createProAppointment(input: ProAppointmentInput): Promise<Appointment> {
    return this.wait(() => {
      const services = input.serviceIds.map((id) => this.s.services.find((s) => s.id === id)!).filter(Boolean);
      if (!services.length) throw new ApiError('NOT_FOUND');
      const duration = services.reduce((s, x) => s + x.durationMin, 0);
      const start = Date.parse(input.start);
      if (this.overlapsBlocking(input.staffId, start, start + duration * 60000)) throw new ApiError('SLOT_TAKEN');
      const client = input.clientId ? this.s.clients.find((c) => c.id === input.clientId)! : this.upsertClient(input.businessId, input.newClient!, null);
      const appt: Appointment = {
        id: uid(),
        reference: this.reference(),
        businessId: input.businessId,
        staffId: input.staffId,
        clientId: client.id,
        profileId: client.profileId,
        startsAt: input.start,
        endsAt: new Date(start + duration * 60000).toISOString(),
        status: 'confirmed',
        paymentStatus: 'pay_on_site',
        total: services.reduce((s, x) => s + x.price, 0),
        deposit: 0,
        amountPaid: 0,
        holdExpiresAt: null,
        source: 'pro',
        services: services.map((s) => ({ serviceId: s.id, name: s.name, durationMin: s.durationMin, price: s.price })),
        createdAt: this.now().toISOString(),
      };
      this.s.appointments.push(appt);
      this.emit(appt, 'INSERT');
      return clone(appt);
    });
  }

  moveAppointment(id: string, start: string, staffId: string): Promise<Appointment> {
    return this.wait(() => {
      const a = this.s.appointments.find((x) => x.id === id);
      if (!a) throw new ApiError('NOT_FOUND');
      const dur = Date.parse(a.endsAt) - Date.parse(a.startsAt);
      const s = Date.parse(start);
      if (this.overlapsBlocking(staffId, s, s + dur, a.id)) throw new ApiError('SLOT_TAKEN');
      a.startsAt = new Date(s).toISOString();
      a.endsAt = new Date(s + dur).toISOString();
      a.staffId = staffId;
      this.s.remindedIds = this.s.remindedIds.filter((x) => x !== a.id);
      this.emit(a, 'UPDATE');
      return clone(a);
    });
  }

  subscribeAppointments(businessId: string, cb: (e: RealtimeEvent) => void) {
    const off = this.db.subscribe((msg) => {
      if (msg.kind === 'appointment' && msg.appointment.businessId === businessId) cb({ type: msg.type, appointment: msg.appointment });
    });
    return () => {
      off();
    };
  }

  private clientStats(c: Client): ClientWithStats {
    const done = this.s.appointments.filter((a) => a.clientId === c.id && a.status === 'completed');
    return {
      ...clone(c),
      visits: done.length,
      spent: done.reduce((s, a) => s + a.total, 0),
      lastVisit: done.map((a) => a.startsAt).sort().pop() ?? null,
    };
  }

  listClients(businessId: string, q: string): Promise<ClientWithStats[]> {
    return this.wait(() => {
      const n = norm(q.trim());
      return this.s.clients
        .filter((c) => c.businessId === businessId)
        .filter((c) => !n || norm(`${c.firstName} ${c.lastName} ${c.phone}`).includes(n))
        .map((c) => this.clientStats(c))
        .sort((a, b) => (b.lastVisit ?? '').localeCompare(a.lastVisit ?? '') || a.firstName.localeCompare(b.firstName));
    });
  }

  getClient(clientId: string): Promise<ClientDetail> {
    return this.wait(() => {
      const c = this.s.clients.find((x) => x.id === clientId);
      if (!c) throw new ApiError('NOT_FOUND');
      return {
        client: this.clientStats(c),
        notes: clone(this.s.clientNotes.filter((n) => n.clientId === clientId).sort((a, b) => b.createdAt.localeCompare(a.createdAt))),
        appointments: this.s.appointments
          .filter((a) => a.clientId === clientId && a.status !== 'pending_payment')
          .sort((a, b) => b.startsAt.localeCompare(a.startsAt))
          .map((a) => this.view(a)),
      };
    });
  }

  addClientNote(clientId: string, body: string): Promise<ClientNote> {
    return this.wait(() => {
      const note = { id: uid(), clientId, body: body.trim(), createdAt: this.now().toISOString() };
      this.s.clientNotes.push(note);
      this.db.save();
      return clone(note);
    });
  }

  saveService(service: Omit<Service, 'id' | 'sort'> & { id?: string }, staffIds: string[]): Promise<Service> {
    return this.wait(() => {
      let s = service.id ? this.s.services.find((x) => x.id === service.id) : undefined;
      if (s) Object.assign(s, service);
      else {
        s = { ...service, id: uid(), sort: this.s.services.filter((x) => x.businessId === service.businessId).length };
        this.s.services.push(s);
      }
      const id = s.id;
      this.s.staffServices = this.s.staffServices.filter((x) => x.serviceId !== id).concat(staffIds.map((staffId) => ({ staffId, serviceId: id })));
      this.db.save();
      return clone(s);
    });
  }

  archiveService(id: string): Promise<void> {
    return this.wait(() => {
      const s = this.s.services.find((x) => x.id === id);
      if (s) s.active = false;
      this.db.save();
    });
  }

  saveStaff(staff: Omit<Staff, 'id' | 'sort' | 'color'> & { id?: string }, serviceIds: string[], hours: Omit<StaffHours, 'staffId'>[]): Promise<Staff> {
    return this.wait(() => {
      let st = staff.id ? this.s.staff.find((x) => x.id === staff.id) : undefined;
      if (st) Object.assign(st, staff);
      else {
        const n = this.s.staff.filter((x) => x.businessId === staff.businessId).length;
        st = { ...staff, id: uid(), sort: n, color: STAFF_COLORS[n % STAFF_COLORS.length] };
        this.s.staff.push(st);
      }
      const id = st.id;
      this.s.staffServices = this.s.staffServices.filter((x) => x.staffId !== id).concat(serviceIds.map((serviceId) => ({ staffId: id, serviceId })));
      this.s.staffHours = this.s.staffHours.filter((h) => h.staffId !== id).concat(hours.map((h) => ({ ...h, staffId: id })));
      this.db.save();
      return clone(st);
    });
  }

  archiveStaff(id: string): Promise<void> {
    return this.wait(() => {
      const s = this.s.staff.find((x) => x.id === id);
      if (s) s.active = false;
      this.db.save();
    });
  }

  addTimeOff(t: Omit<TimeOff, 'id'>): Promise<TimeOff> {
    return this.wait(() => {
      const item = { ...t, id: uid() };
      this.s.timeOff.push(item);
      this.db.save();
      return clone(item);
    });
  }

  deleteTimeOff(id: string): Promise<void> {
    return this.wait(() => {
      this.s.timeOff = this.s.timeOff.filter((t) => t.id !== id);
      this.db.save();
    });
  }

  saveHours(businessId: string, hours: Omit<BusinessHours, 'businessId'>[]): Promise<void> {
    return this.wait(() => {
      this.s.businessHours = this.s.businessHours.filter((h) => h.businessId !== businessId).concat(hours.map((h) => ({ ...h, businessId })));
      this.db.save();
    });
  }

  updateBusiness(id: string, patch: Partial<Business>): Promise<Business> {
    return this.wait(() => {
      const b = this.business(id);
      const { status: _s, isDemo: _d, ratingAvg: _r, ratingCount: _c, ownerId: _o, id: _i, ...safe } = patch;
      Object.assign(b, safe);
      this.db.save();
      return clone(b);
    });
  }

  replyReview(id: string, reply: string): Promise<void> {
    return this.wait(() => {
      const r = this.s.reviews.find((x) => x.id === id);
      if (r) r.reply = reply.trim() || null;
      this.db.save();
    });
  }

  createBusiness(input: OnboardingInput): Promise<Business> {
    return this.wait(() => {
      const city = this.city(input.cityId);
      const base = `${input.name}-${city.name}`
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');
      let slug = base;
      for (let i = 2; this.s.businesses.some((b) => b.slug === slug); i++) slug = `${base}-${i}`;
      const b: Business = {
        id: uid(),
        slug,
        name: input.name.trim(),
        cityId: input.cityId,
        district: input.district.trim(),
        address: input.address.trim(),
        lat: city.lat + (Math.random() - 0.5) * 0.02,
        lng: city.lng + (Math.random() - 0.5) * 0.02,
        phone: input.phone,
        whatsapp: input.phone,
        description: input.description.trim(),
        photoSeeds: [Math.floor(Math.random() * 50) + 1, Math.floor(Math.random() * 50) + 1, Math.floor(Math.random() * 50) + 1],
        photoUrls: [],
        ratingAvg: 0,
        ratingCount: 0,
        instantBooking: true,
        audience: input.audience,
        slotStepMin: 15,
        minNoticeMin: 60,
        depositRule: { type: 'none' },
        paymentOptions: ['on_site', 'full'],
        paymentMethods: ['mobile_money', 'cash'],
        cancellationHours: 24,
        status: 'active',
        isDemo: false,
        ownerId: input.ownerId,
        createdAt: this.now().toISOString(),
      };
      this.s.businesses.push(b);
      const staff = input.staff.map((s, k) => ({ id: uid(), businessId: b.id, name: s.name.trim(), role: s.role.trim(), color: STAFF_COLORS[k % STAFF_COLORS.length], photoUrl: null, sort: k, active: true }));
      this.s.staff.push(...staff);
      input.services.forEach((s, k) => {
        const id = uid();
        this.s.services.push({ id, businessId: b.id, categoryId: s.categoryId, name: s.name.trim(), description: '', durationMin: s.durationMin, price: s.price, depositRule: null, active: true, sort: k });
        for (const st of staff) this.s.staffServices.push({ staffId: st.id, serviceId: id });
      });
      this.s.businessHours.push(...input.hours.map((h) => ({ ...h, businessId: b.id })));
      const owner = this.s.profiles.find((p) => p.id === input.ownerId);
      if (owner && owner.role === 'client') owner.role = 'business_owner';
      this.db.save();
      return clone(b);
    });
  }

  /* ------------------------------------------------------------------ admin */

  adminStats(): Promise<AdminStats> {
    return this.wait(() => ({
      bookings: this.s.appointments.filter((a) => a.status !== 'pending_payment').length,
      gmv: this.s.appointments.filter((a) => ['confirmed', 'checked_in', 'completed'].includes(a.status)).reduce((s, a) => s + a.total, 0),
      activeSalons: this.s.businesses.filter((b) => b.status === 'active').length,
      users: this.s.profiles.length,
    }));
  }

  adminListBusinesses(): Promise<(Business & { city: City })[]> {
    return this.wait(() => clone(this.s.businesses.map((b) => ({ ...b, city: this.city(b.cityId) }))));
  }

  adminSetBusinessStatus(id: string, status: Business['status']): Promise<void> {
    return this.wait(() => {
      this.business(id).status = status;
      this.db.save();
    });
  }

  adminListProfiles(): Promise<Profile[]> {
    return this.wait(() => clone([...this.s.profiles].sort((a, b) => b.createdAt.localeCompare(a.createdAt))));
  }

  adminListAppointments(): Promise<AppointmentView[]> {
    return this.wait(() => [...this.s.appointments].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 100).map((a) => this.view(a)));
  }

  adminListPayments() {
    return this.wait(() => clone([...this.s.payments].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 100)));
  }

  adminListNotifications() {
    return this.wait(() => clone(this.s.notifications.slice(0, 200)));
  }

  adminSaveCity(city: City): Promise<void> {
    return this.wait(() => {
      const i = this.s.cities.findIndex((c) => c.id === city.id);
      if (i >= 0) this.s.cities[i] = city;
      else this.s.cities.push({ ...city, id: city.id || uid() });
      this.db.save();
    });
  }

  adminSaveCategory(category: Category): Promise<void> {
    return this.wait(() => {
      const i = this.s.categories.findIndex((c) => c.id === category.id);
      if (i >= 0) this.s.categories[i] = category;
      else this.s.categories.push({ ...category, id: category.id || uid() });
      this.db.save();
    });
  }

  adminSaveCountry(country: Country): Promise<void> {
    return this.wait(() => {
      const i = this.s.countries.findIndex((c) => c.code === country.code);
      if (i >= 0) this.s.countries[i] = country;
      else this.s.countries.push(country);
      this.db.save();
    });
  }

  resetDemo(): Promise<void> {
    return this.wait(() => {
      this.db.reset();
    });
  }
}
