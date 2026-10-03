import { describe, expect, it } from 'vitest';
import { DemoApi } from './api';
import { DemoDb } from './db';
import { ApiError } from '../api';
import { MOCK_CONFIRMATION_MS } from '@/lib/payments';
import { addDays, todayIn, zonedParts } from '@/lib/time';

function memoryStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
}

function setup(storage = memoryStorage(), clock = { t: new Date('2026-10-05T07:00:00Z').getTime() }) {
  const now = () => new Date(clock.t);
  const db = new DemoDb(storage, { sync: false, now: now() });
  const api = new DemoApi({ db, now, latencyMs: 0, sessionStorage: null });
  return { api, db, clock, storage };
}

async function firstBookable(api: DemoApi) {
  const salon = await api.getSalon('le-barbier-de-poto-poto-brazzaville');
  const service = salon.services[0];
  const tz = salon.city.timezone;
  const days = await api.getAvailableDays({ businessId: salon.business.id, serviceIds: [service.id], staffId: null }, todayIn(tz, new Date('2026-10-05T07:00:00Z')), 14);
  const day = days.filter((d) => d.available)[1].date; // not today: keeps clear of the 1 h minimum notice
  const slots = await api.getSlots({ businessId: salon.business.id, serviceIds: [service.id], staffId: salon.staff[0].id, date: day });
  return { salon, service, slot: slots[0], day };
}

const contact = (n: number) => ({ firstName: `Test${n}`, phone: `+24206${String(n).padStart(7, '0')}` });

describe('DemoApi', () => {
  it('materialises the full demo dataset', () => {
    const { db } = setup();
    expect(db.state.businesses).toHaveLength(10);
    expect(db.state.staff).toHaveLength(30);
    expect(db.state.services).toHaveLength(50);
    expect(db.state.clients).toHaveLength(100);
    expect(db.state.appointments).toHaveLength(200);
    expect(new Set(db.state.businesses.map((b) => b.cityId)).size).toBe(8);
    expect(db.state.businesses.every((b) => b.isDemo && b.ratingCount > 0)).toBe(true);
  });

  it('two tabs booking the same slot: only one succeeds, the other gets alternatives', async () => {
    const storage = memoryStorage();
    const clock = { t: new Date('2026-10-05T07:00:00Z').getTime() };
    const tabA = setup(storage, clock);
    const tabB = { api: new DemoApi({ db: new DemoDb(storage, { sync: false }), now: () => new Date(clock.t), latencyMs: 0, sessionStorage: null }) };
    const { salon, service, slot } = await firstBookable(tabA.api);
    const input = { businessId: salon.business.id, serviceIds: [service.id], staffId: salon.staff[0].id, start: slot.start, profileId: null };
    const [a, b] = await Promise.allSettled([
      tabA.api.createHold({ ...input, contact: contact(1) }),
      tabB.api.createHold({ ...input, contact: contact(2) }),
    ]);
    const ok = [a, b].filter((r) => r.status === 'fulfilled');
    const ko = [a, b].filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(ok).toHaveLength(1);
    expect(ko).toHaveLength(1);
    expect((ko[0].reason as ApiError).code).toBe('SLOT_TAKEN');
    expect((ko[0].reason as ApiError).alternatives.length).toBeGreaterThan(0);
    expect((ko[0].reason as ApiError).alternatives.map((s) => s.start)).not.toContain(slot.start);
  });

  it('an expired hold frees the slot', async () => {
    const { api, clock } = setup();
    const { salon, service, slot, day } = await firstBookable(api);
    const q = { businessId: salon.business.id, serviceIds: [service.id], staffId: salon.staff[0].id };
    await api.createHold({ ...q, start: slot.start, profileId: null, contact: contact(3) });
    expect((await api.getSlots({ ...q, date: day })).map((s) => s.start)).not.toContain(slot.start);
    clock.t += 10 * 60000 + 1000;
    expect((await api.getSlots({ ...q, date: day })).map((s) => s.start)).toContain(slot.start);
  });

  it('a declined mobile-money payment releases the slot; an accepted one confirms', async () => {
    const { api, clock, db } = setup();
    const { salon, service, slot, day } = await firstBookable(api);
    const q = { businessId: salon.business.id, serviceIds: [service.id], staffId: salon.staff[0].id };
    const hold = await api.createHold({ ...q, start: slot.start, profileId: null, contact: contact(4) });
    const pay = await api.initiatePayment({ appointmentId: hold.id, option: 'full', method: 'mobile_money', operator: 'mtn_momo', phone: '+242060000000' });
    expect(pay.status).toBe('pending');
    expect((await api.verifyPayment(pay.paymentId!)).status).toBe('pending');
    clock.t += MOCK_CONFIRMATION_MS;
    expect((await api.verifyPayment(pay.paymentId!)).status).toBe('failed');
    expect((await api.getSlots({ ...q, date: day })).map((s) => s.start)).toContain(slot.start);

    const hold2 = await api.createHold({ ...q, start: slot.start, profileId: null, contact: contact(5) });
    const pay2 = await api.initiatePayment({ appointmentId: hold2.id, option: 'full', method: 'mobile_money', operator: 'mtn_momo', phone: '+242061111111' });
    clock.t += MOCK_CONFIRMATION_MS;
    const done = await api.verifyPayment(pay2.paymentId!);
    expect(done.status).toBe('succeeded');
    expect(done.appointment.status).toBe('confirmed');
    expect(done.appointment.paymentStatus).toBe('paid');
    expect(db.state.notifications.filter((n) => n.appointmentId === hold2.id).map((n) => n.event).sort()).toEqual(['booking_confirmed', 'new_booking_salon']);
  });

  it('pro agenda receives realtime events for new bookings', async () => {
    const { api } = setup();
    const { salon, service, slot } = await firstBookable(api);
    const events: string[] = [];
    const off = api.subscribeAppointments(salon.business.id, (e) => events.push(`${e.type}:${e.appointment.status}`));
    const hold = await api.createHold({ businessId: salon.business.id, serviceIds: [service.id], staffId: null, start: slot.start, profileId: null, contact: contact(6) });
    await api.initiatePayment({ appointmentId: hold.id, option: 'on_site', method: 'cash' });
    off();
    expect(events).toEqual(['INSERT:pending_payment', 'UPDATE:confirmed']);
  });

  it('changing opening hours updates slots immediately', async () => {
    const { api } = setup();
    const { salon, service, day } = await firstBookable(api);
    const q = { businessId: salon.business.id, serviceIds: [service.id], staffId: null, date: day };
    const before = await api.getSlots(q);
    const bundle = await api.getBusinessBundle(salon.business.id);
    await api.saveHours(salon.business.id, bundle.hours.map(({ businessId: _b, ...h }) => ({ ...h, opens: '15:00' })));
    const after = await api.getSlots(q);
    expect(after.length).toBeLessThan(before.length);
    expect(after.every((s) => zonedParts(s.start, salon.city.timezone).time >= '15:00')).toBe(true);
  });

  it('OTP sign-in attaches guest bookings made with the same phone', async () => {
    const { api } = setup();
    const { salon, service, slot } = await firstBookable(api);
    const hold = await api.createHold({ businessId: salon.business.id, serviceIds: [service.id], staffId: null, start: slot.start, profileId: null, contact: contact(7) });
    await api.initiatePayment({ appointmentId: hold.id, option: 'on_site', method: 'cash' });
    await expect(api.verifyOtp(contact(7).phone, '000000')).rejects.toMatchObject({ code: 'INVALID_OTP' });
    const profile = await api.verifyOtp(contact(7).phone, '123456');
    const mine = await api.listMyAppointments(profile.id);
    expect(mine.map((a) => a.id)).toContain(hold.id);
  });

  it('search filters and paginates', async () => {
    const { api } = setup();
    const all = await api.searchSalons({ limit: 4 });
    expect(all.total).toBe(10);
    expect(all.items).toHaveLength(4);
    expect(all.nextOffset).toBe(4);
    const barbers = await api.searchSalons({ q: 'barb' });
    expect(barbers.total).toBeGreaterThanOrEqual(2);
    const locks = await api.searchSalons({ categorySlug: 'locks' });
    expect(locks.items.every((x) => x.categoryIds.length > 0)).toBe(true);
    expect(addDays('2026-10-05', 1)).toBe('2026-10-06');
  });
});
