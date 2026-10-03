/**
 * Supabase adapter. Reads go through RLS-protected tables; every write that touches
 * availability (holds, payments, moves, cancellations) goes through security-definer RPCs
 * so the booking rules and the exclusion constraint can't be bypassed.
 * Loaded lazily, only when VITE_SUPABASE_URL is configured (keeps the demo bundle small).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
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
import { ApiError, type ApiErrorCode } from '../api';
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
  DepositRule,
  NotificationLog,
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
import { nearestSlots } from '@/lib/booking-engine';
import { addDays, zonedParts } from '@/lib/time';
import { STAFF_COLORS } from '../reference';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

const KNOWN: ApiErrorCode[] = ['SLOT_TAKEN', 'HOLD_EXPIRED', 'NOT_FOUND', 'INVALID_OTP', 'INVALID_CREDENTIALS', 'RATE_LIMITED', 'FORBIDDEN', 'CANCELLATION_TOO_LATE', 'EMAIL_TAKEN'];
function fail(error: { message?: string; hint?: string } | null): never {
  const code = (KNOWN.find((k) => error?.message === k || error?.hint === k) ?? 'UNKNOWN') as ApiErrorCode;
  throw new ApiError(code, error?.message);
}
function ok<T>(res: { data: T; error: any }): NonNullable<T> {
  if (res.error) fail(res.error);
  return res.data as NonNullable<T>;
}

const depositRule = (type: string | null, value: number | null): DepositRule | null =>
  !type ? null : type === 'fixed' || type === 'percent' ? { type, value: value ?? 0 } : ({ type } as DepositRule);

const mapCountry = (r: Row): Country => ({ code: r.code, name: r.name, currency: r.currency, dialCode: r.dial_code, timezone: r.timezone, operators: r.operators, defaultLocale: r.default_locale, flag: r.flag, phoneLength: r.phone_length });
const mapCity = (r: Row): City => ({ id: r.id, countryCode: r.country_code, name: r.name, slug: r.slug, timezone: r.timezone, lat: r.lat, lng: r.lng });
const mapCategory = (r: Row): Category => ({ id: r.id, slug: r.slug, key: r.key, sort: r.sort });
const mapBusiness = (r: Row): Business => ({
  id: r.id, slug: r.slug, name: r.name, cityId: r.city_id, district: r.district, address: r.address, lat: r.lat, lng: r.lng,
  phone: r.phone, whatsapp: r.whatsapp, description: r.description, photoSeeds: r.photo_seeds ?? [], photoUrls: (r.business_photos ?? []).map((p: Row) => p.storage_path),
  ratingAvg: Number(r.rating_avg), ratingCount: r.rating_count, instantBooking: r.instant_booking, audience: r.audience,
  slotStepMin: r.slot_step_min, minNoticeMin: r.min_notice_min, depositRule: depositRule(r.deposit_type, r.deposit_value) ?? { type: 'none' },
  paymentOptions: r.payment_options, paymentMethods: r.payment_methods, cancellationHours: r.cancellation_hours, status: r.status,
  isDemo: r.is_demo, ownerId: r.owner_id, createdAt: r.created_at,
});
const mapStaff = (r: Row): Staff => ({ id: r.id, businessId: r.business_id, name: r.name, role: r.role, color: r.color, photoUrl: r.photo_url, sort: r.sort, active: r.active });
const mapService = (r: Row): Service => ({ id: r.id, businessId: r.business_id, categoryId: r.category_id, name: r.name, description: r.description, durationMin: r.duration_min, price: r.price, depositRule: depositRule(r.deposit_type, r.deposit_value), active: r.active, sort: r.sort });
const mapHours = (r: Row): BusinessHours => ({ businessId: r.business_id, weekday: r.weekday, opens: r.opens.slice(0, 5), closes: r.closes.slice(0, 5), breakStart: r.break_start?.slice(0, 5) ?? null, breakEnd: r.break_end?.slice(0, 5) ?? null });
const mapStaffHours = (r: Row): StaffHours => ({ staffId: r.staff_id, weekday: r.weekday, starts: r.starts.slice(0, 5), ends: r.ends.slice(0, 5) });
const mapReview = (r: Row): Review => ({ id: r.id, appointmentId: r.appointment_id, businessId: r.business_id, profileId: r.profile_id, authorName: r.author_name, rating: r.rating, comment: r.comment, reply: r.reply, createdAt: r.created_at });
const mapClient = (r: Row): Client => ({ id: r.id, businessId: r.business_id, profileId: r.profile_id ?? null, firstName: r.first_name, lastName: r.last_name ?? '', phone: r.phone, email: r.email ?? '', createdAt: r.created_at ?? '' });
const mapProfile = (r: Row): Profile => ({ id: r.id, role: r.role, firstName: r.first_name, lastName: r.last_name, phone: r.phone ?? '', email: r.email ?? '', locale: r.locale, countryCode: r.country_code, createdAt: r.created_at });
const mapAppointment = (r: Row, services: Row[] = r.appointment_services ?? []): Appointment => ({
  id: r.id, reference: r.reference, businessId: r.business_id, staffId: r.staff_id, clientId: r.client_id, profileId: r.profile_id,
  startsAt: new Date(r.starts_at).toISOString(), endsAt: new Date(r.ends_at).toISOString(), status: r.status, paymentStatus: r.payment_status,
  total: r.total, deposit: r.deposit, amountPaid: r.amount_paid, holdExpiresAt: r.hold_expires_at, source: r.source,
  services: [...services].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0)).map((s) => ({ serviceId: s.service_id, name: s.name, durationMin: s.duration_min, price: s.price })),
  createdAt: r.created_at,
});

const APPT_SELECT = '*, appointment_services(*), staff(*), clients(*), businesses(*, cities(*)), reviews(id)';
const mapView = (r: Row): AppointmentView => ({
  ...mapAppointment(r),
  business: mapBusiness(r.businesses),
  city: mapCity(r.businesses.cities),
  staff: r.staff ? mapStaff(r.staff) : null,
  client: mapClient(r.clients),
  hasReview: Array.isArray(r.reviews) ? r.reviews.length > 0 : !!r.reviews,
});

const serviceRow = (s: Omit<Service, 'id' | 'sort'>) => ({
  business_id: s.businessId, category_id: s.categoryId, name: s.name, description: s.description, duration_min: s.durationMin, price: s.price,
  deposit_type: s.depositRule?.type ?? null, deposit_value: s.depositRule && 'value' in s.depositRule ? s.depositRule.value : null, active: s.active,
});

export class SupabaseApi implements Api {
  readonly mode = 'supabase' as const;
  readonly sb: SupabaseClient;
  private ref: Reference | null = null;

  constructor(url: string, anonKey: string) {
    this.sb = createClient(url, anonKey, { auth: { persistSession: true, autoRefreshToken: true } });
  }

  private async reference() {
    if (!this.ref) this.ref = await this.getReference();
    return this.ref;
  }

  async getReference(): Promise<Reference> {
    const [countries, cities, categories] = await Promise.all([
      this.sb.from('countries').select('*').order('name'),
      this.sb.from('cities').select('*').order('name'),
      this.sb.from('categories').select('*').order('sort'),
    ]);
    this.ref = { countries: ok(countries).map(mapCountry), cities: ok(cities).map(mapCity), categories: ok(categories).map(mapCategory) };
    return this.ref;
  }

  async searchSalons(p: SearchParams): Promise<Page<SalonSummary>> {
    const ref = await this.reference();
    const data = ok(
      await this.sb.rpc('search_businesses', {
        p_q: p.q || null, p_country_code: p.countryCode || null, p_city_id: p.cityId || null, p_category_slug: p.categorySlug || null,
        p_lat: p.near?.lat ?? null, p_lng: p.near?.lng ?? null, p_available_today: !!p.availableToday,
        p_max_price: p.maxPrice ?? null, p_min_rating: p.minRating ?? null, p_mobile_money: !!p.mobileMoney,
        p_instant_only: !!p.instantOnly, p_audience: p.audience ?? null, p_sort: p.sort ?? 'relevance',
        p_offset: p.offset ?? 0, p_limit: p.limit ?? 12,
      }),
    ) as Row;
    const offset = p.offset ?? 0;
    const limit = p.limit ?? 12;
    const items: SalonSummary[] = data.items.map((x: Row) => {
      const business = mapBusiness(x.business);
      return {
        business,
        city: ref.cities.find((c) => c.id === business.cityId)!,
        minPrice: x.min_price ?? 0,
        nextSlot: x.next_slot ? new Date(x.next_slot).toISOString() : null,
        nextSlotServiceId: x.next_service_id ?? null,
        distanceKm: x.distance_km === null ? null : Math.round(x.distance_km * 10) / 10,
        acceptsMobileMoney: business.paymentMethods.includes('mobile_money'),
        categoryIds: x.category_ids,
      };
    });
    return { items, total: data.total, nextOffset: offset + limit < data.total ? offset + limit : null };
  }

  async suggest(q: string): Promise<Suggestions> {
    const ref = await this.reference();
    const term = q.trim();
    if (!term) return { services: [], salons: [], categories: [] };
    const like = `%${term.replace(/[%_]/g, '')}%`;
    const [svc, biz] = await Promise.all([
      this.sb.from('services').select('name').ilike('name', like).eq('active', true).limit(20),
      this.sb.from('businesses').select('slug, name, district, city_id').or(`name.ilike.${like},district.ilike.${like}`).limit(4),
    ]);
    return {
      services: [...new Set(ok(svc).map((s: Row) => s.name as string))].slice(0, 4),
      salons: ok(biz).map((b: Row) => ({ slug: b.slug, name: b.name, district: b.district, city: ref.cities.find((c) => c.id === b.city_id)?.name ?? '' })),
      categories: ref.categories.filter((c) => c.slug.replace(/-/g, ' ').includes(term.toLowerCase())).slice(0, 3),
    };
  }

  private async detail(filter: { slug?: string; id?: string }, includeInactive = false) {
    const ref = await this.reference();
    let qb = this.sb.from('businesses').select('*, business_photos(storage_path, sort)');
    qb = filter.slug ? qb.eq('slug', filter.slug) : qb.eq('id', filter.id!);
    const b = (await qb.maybeSingle()).data;
    if (!b) throw new ApiError('NOT_FOUND');
    const business = mapBusiness(b);
    const [services, staff, hours, reviews] = await Promise.all([
      this.sb.from('services').select('*').eq('business_id', business.id).order('sort'),
      this.sb.from('staff').select('*, staff_services(service_id), staff_hours(*)').eq('business_id', business.id).order('sort'),
      this.sb.from('business_hours').select('*').eq('business_id', business.id),
      this.sb.from('reviews').select('*').eq('business_id', business.id).order('created_at', { ascending: false }).limit(50),
    ]);
    const allServices = ok(services).map(mapService);
    const staffRows = ok(staff) as Row[];
    const allStaff = staffRows.map(mapStaff);
    const city = ref.cities.find((c) => c.id === business.cityId)!;
    const visibleServices = allServices.filter((s) => s.active);
    return {
      business,
      city,
      country: ref.countries.find((c) => c.code === city.countryCode)!,
      services: visibleServices,
      staff: allStaff.filter((s) => s.active),
      staffServices: staffRows.flatMap((s) => s.staff_services.map((x: Row) => ({ staffId: s.id, serviceId: x.service_id }))),
      hours: ok(hours).map(mapHours),
      reviews: ok(reviews).map(mapReview),
      categories: includeInactive ? ref.categories : ref.categories.filter((c) => visibleServices.some((s) => s.categoryId === c.id)),
      staffHours: staffRows.flatMap((s) => s.staff_hours.map(mapStaffHours)),
      allServices,
      allStaff,
    };
  }

  async getSalon(slug: string): Promise<SalonDetail> {
    return this.detail({ slug });
  }

  async getAvailableDays(q: SlotQuery, from: string, count: number): Promise<DayAvailability[]> {
    const data = ok(await this.sb.rpc('get_available_days', { p_business_id: q.businessId, p_service_ids: q.serviceIds, p_staff_id: q.staffId, p_from: from, p_count: count, p_exclude_appointment: q.excludeAppointmentId ?? null }));
    return (data as Row[]).map((d) => ({ date: d.day, available: d.available }));
  }

  async getSlots(q: SlotQuery & { date: string }): Promise<Slot[]> {
    const data = ok(await this.sb.rpc('get_available_slots', { p_business_id: q.businessId, p_service_ids: q.serviceIds, p_staff_id: q.staffId, p_date: q.date, p_exclude_appointment: q.excludeAppointmentId ?? null }));
    return (data as Row[]).map((s) => ({ start: new Date(s.slot_start).toISOString(), staffIds: s.staff_ids }));
  }

  private async alternatives(q: SlotQuery, start: string): Promise<Slot[]> {
    const ref = await this.reference();
    const { data: b } = await this.sb.from('businesses').select('city_id').eq('id', q.businessId).single();
    const tz = ref.cities.find((c) => c.id === b?.city_id)?.timezone ?? 'UTC';
    const day = zonedParts(start, tz).date;
    const same = nearestSlots(await this.getSlots({ ...q, date: day }), start, 3);
    for (let i = 1; i <= 7 && same.length < 3; i++) {
      for (const s of await this.getSlots({ ...q, date: addDays(day, i) })) if (same.length < 3) same.push(s);
    }
    return same;
  }

  async createHold(input: HoldInput): Promise<Appointment> {
    const res = await this.sb.rpc('create_booking_hold', {
      p_business_id: input.businessId, p_service_ids: input.serviceIds, p_staff_id: input.staffId, p_start: input.start,
      p_first_name: input.contact.firstName, p_last_name: input.contact.lastName ?? '', p_phone: input.contact.phone, p_email: input.contact.email ?? '',
    });
    if (res.error) {
      if (res.error.message === 'SLOT_TAKEN') throw new ApiError('SLOT_TAKEN', undefined, await this.alternatives(input, input.start));
      fail(res.error);
    }
    const { data: services } = await this.sb.from('services').select('id, name, duration_min, price').in('id', input.serviceIds);
    return mapAppointment(res.data, (services ?? []).map((s: Row) => ({ service_id: s.id, name: s.name, duration_min: s.duration_min, price: s.price, sort: input.serviceIds.indexOf(s.id) })));
  }

  async releaseHold(appointmentId: string) {
    ok(await this.sb.rpc('release_hold', { p_appointment_id: appointmentId }));
  }

  private progress(data: Row): PaymentProgress {
    return { paymentId: data.payment_id, status: data.status, appointment: mapAppointment(data.appointment, []) };
  }

  async initiatePayment(input: PaymentInput): Promise<PaymentProgress> {
    // Online payments go through the `payments` Edge Function (PaymentProvider adapters);
    // pay-on-site is a direct RPC.
    if (input.option !== 'on_site') {
      const { data, error } = await this.sb.functions.invoke('payments', { body: { action: 'initiate', ...input } });
      if (error || data?.error) fail({ message: data?.error ?? error?.message });
      return this.progress(data);
    }
    return this.progress(ok(await this.sb.rpc('start_payment', { p_appointment_id: input.appointmentId, p_option: 'on_site', p_method: 'cash' })) as Row);
  }

  async verifyPayment(paymentId: string): Promise<PaymentProgress> {
    return this.progress(ok(await this.sb.rpc('verify_payment', { p_payment_id: paymentId })) as Row);
  }

  async getBooking(reference: string): Promise<AppointmentView> {
    const data = ok(await this.sb.rpc('get_booking', { p_reference: reference })) as Row | null;
    if (!data) throw new ApiError('NOT_FOUND');
    const d = await this.detail({ id: data.appointment.business_id });
    return {
      ...mapAppointment(data.appointment, data.services ?? []),
      business: d.business,
      city: d.city,
      staff: data.staff ? mapStaff(data.staff) : null,
      client: mapClient({ ...data.client, profile_id: null }),
      hasReview: data.has_review,
    };
  }

  /* auth ------------------------------------------------------------------ */

  private async profile(id: string) {
    return mapProfile(ok(await this.sb.from('profiles').select('*').eq('id', id).single()));
  }

  async getSession(): Promise<Profile | null> {
    const { data } = await this.sb.auth.getSession();
    return data.session ? this.profile(data.session.user.id) : null;
  }

  async sendOtp(phone: string) {
    const { error } = await this.sb.auth.signInWithOtp({ phone });
    if (error) fail({ message: error.status === 429 ? 'RATE_LIMITED' : error.message });
    return { devCode: null };
  }

  async verifyOtp(phone: string, code: string, firstName?: string) {
    const { data, error } = await this.sb.auth.verifyOtp({ phone, token: code, type: 'sms' });
    if (error || !data.user) fail({ message: 'INVALID_OTP' });
    if (firstName) await this.sb.from('profiles').update({ first_name: firstName }).eq('id', data.user.id).eq('first_name', '');
    return this.profile(data.user.id);
  }

  async signInWithPassword(email: string, password: string) {
    const { data, error } = await this.sb.auth.signInWithPassword({ email, password });
    if (error || !data.user) fail({ message: 'INVALID_CREDENTIALS' });
    return this.profile(data.user.id);
  }

  async signUpOwner(input: { email: string; password: string; firstName: string; phone: string }) {
    const { data, error } = await this.sb.auth.signUp({ email: input.email, password: input.password, options: { data: { first_name: input.firstName } } });
    if (error || !data.user) fail({ message: error?.message?.includes('registered') ? 'EMAIL_TAKEN' : error?.message });
    await this.sb.from('profiles').update({ phone: input.phone }).eq('id', data.user.id);
    return this.profile(data.user.id);
  }

  async signOut() {
    await this.sb.auth.signOut();
  }

  async updateProfile(id: string, patch: Partial<Pick<Profile, 'firstName' | 'lastName' | 'email' | 'locale' | 'countryCode'>>) {
    const row: Row = {};
    if (patch.firstName !== undefined) row.first_name = patch.firstName;
    if (patch.lastName !== undefined) row.last_name = patch.lastName;
    if (patch.email !== undefined) row.email = patch.email;
    if (patch.locale !== undefined) row.locale = patch.locale;
    if (patch.countryCode !== undefined) row.country_code = patch.countryCode;
    return mapProfile(ok(await this.sb.from('profiles').update(row).eq('id', id).select().single()));
  }

  /* client space ------------------------------------------------------------ */

  async listMyAppointments(profileId: string) {
    const rows = ok(await this.sb.from('appointments').select(APPT_SELECT).eq('profile_id', profileId).neq('status', 'pending_payment').order('starts_at'));
    return (rows as Row[]).filter((r) => !(r.status === 'cancelled' && r.payment_status === 'failed')).map(mapView);
  }

  async cancelAppointment(id: string) {
    ok(await this.sb.rpc('cancel_appointment', { p_id: id }));
  }

  async rescheduleAppointment(id: string, start: string, staffId: string | null) {
    const res = await this.sb.rpc('reschedule_appointment', { p_id: id, p_start: start, p_staff_id: staffId });
    if (res.error) fail(res.error);
    return mapAppointment(res.data, []);
  }

  async createReview(input: { appointmentId: string; rating: number; comment: string }) {
    return mapReview(ok(await this.sb.rpc('create_review', { p_appointment_id: input.appointmentId, p_rating: input.rating, p_comment: input.comment })));
  }

  async listFavoriteIds(profileId: string) {
    return (ok(await this.sb.from('favorites').select('business_id').eq('profile_id', profileId)) as Row[]).map((r) => r.business_id as string);
  }

  async listFavorites(profileId: string) {
    const ids = await this.listFavoriteIds(profileId);
    if (!ids.length) return [];
    const page = await this.searchSalons({ limit: 50 });
    return page.items.filter((x) => ids.includes(x.business.id));
  }

  async toggleFavorite(profileId: string, businessId: string) {
    const { data } = await this.sb.from('favorites').select('business_id').eq('profile_id', profileId).eq('business_id', businessId).maybeSingle();
    if (data) {
      ok(await this.sb.from('favorites').delete().eq('profile_id', profileId).eq('business_id', businessId));
      return false;
    }
    ok(await this.sb.from('favorites').insert({ profile_id: profileId, business_id: businessId }));
    return true;
  }

  /* pro space ------------------------------------------------------------ */

  async getMyBusiness(profileId: string) {
    const { data } = await this.sb.from('businesses').select('*').eq('owner_id', profileId).limit(1).maybeSingle();
    return data ? mapBusiness(data) : null;
  }

  async getBusinessBundle(businessId: string) {
    const d = await this.detail({ id: businessId }, true);
    const { data } = await this.sb.from('time_off').select('*').eq('business_id', businessId).order('starts_at');
    const timeOff: TimeOff[] = (data ?? []).map((t: Row) => ({ id: t.id, businessId: t.business_id, staffId: t.staff_id, startsAt: t.starts_at, endsAt: t.ends_at, reason: t.reason }));
    return { ...d, timeOff };
  }

  async getDashboard(businessId: string): Promise<DashboardStats> {
    const d = ok(await this.sb.rpc('business_dashboard', { p_business_id: businessId })) as Row;
    return { revenueToday: d.revenue_today, appointmentsToday: d.appointments_today, newClients30d: d.new_clients_30d, noShowRate30d: Number(d.no_show_rate_30d), revenue7d: d.revenue_7d };
  }

  async listAppointments(q: { businessId: string; from: string; to: string; status?: AppointmentStatus | null }) {
    let qb = this.sb.from('appointments').select(APPT_SELECT).eq('business_id', q.businessId).gte('starts_at', q.from).lt('starts_at', q.to).order('starts_at');
    if (q.status) qb = qb.eq('status', q.status);
    const now = Date.now();
    return (ok(await qb) as Row[])
      .filter((r) => !(r.status === 'cancelled' && r.payment_status === 'failed'))
      .filter((r) => r.status !== 'pending_payment' || Date.parse(r.hold_expires_at) > now)
      .map(mapView);
  }

  async setAppointmentStatus(id: string, status: AppointmentStatus) {
    ok(await this.sb.rpc('set_appointment_status', { p_id: id, p_status: status }));
  }

  async createProAppointment(input: ProAppointmentInput) {
    return mapAppointment(ok(await this.sb.rpc('create_pro_appointment', {
      p_business_id: input.businessId, p_service_ids: input.serviceIds, p_staff_id: input.staffId, p_start: input.start,
      p_client_id: input.clientId ?? null, p_first_name: input.newClient?.firstName ?? null, p_last_name: input.newClient?.lastName ?? null, p_phone: input.newClient?.phone ?? null,
    })), []);
  }

  async moveAppointment(id: string, start: string, staffId: string) {
    return mapAppointment(ok(await this.sb.rpc('move_appointment', { p_id: id, p_start: start, p_staff_id: staffId })), []);
  }

  subscribeAppointments(businessId: string, cb: (e: RealtimeEvent) => void) {
    const channel = this.sb
      .channel(`appointments:${businessId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'appointments', filter: `business_id=eq.${businessId}` }, (payload) => {
        if (payload.eventType === 'DELETE') return;
        cb({ type: payload.eventType, appointment: mapAppointment(payload.new as Row, []) });
      })
      .subscribe();
    return () => {
      void this.sb.removeChannel(channel);
    };
  }

  async listClients(businessId: string, q: string): Promise<ClientWithStats[]> {
    let qb = this.sb.from('client_stats').select('*').eq('business_id', businessId).order('last_visit', { ascending: false, nullsFirst: false }).limit(200);
    const term = q.trim().replace(/[%_,()]/g, '');
    if (term) qb = qb.or(`first_name.ilike.%${term}%,last_name.ilike.%${term}%,phone.ilike.%${term}%`);
    return (ok(await qb) as Row[]).map((r) => ({ ...mapClient(r), visits: r.visits, spent: r.spent, lastVisit: r.last_visit }));
  }

  async getClient(clientId: string): Promise<ClientDetail> {
    const [c, notes, appts] = await Promise.all([
      this.sb.from('client_stats').select('*').eq('id', clientId).single(),
      this.sb.from('client_notes').select('*').eq('client_id', clientId).order('created_at', { ascending: false }),
      this.sb.from('appointments').select(APPT_SELECT).eq('client_id', clientId).neq('status', 'pending_payment').order('starts_at', { ascending: false }),
    ]);
    const r = ok(c) as Row;
    return {
      client: { ...mapClient(r), visits: r.visits, spent: r.spent, lastVisit: r.last_visit },
      notes: (ok(notes) as Row[]).map((n) => ({ id: n.id, clientId: n.client_id, body: n.body, createdAt: n.created_at })),
      appointments: (ok(appts) as Row[]).map(mapView),
    };
  }

  async addClientNote(clientId: string, body: string): Promise<ClientNote> {
    const n = ok(await this.sb.from('client_notes').insert({ client_id: clientId, body }).select().single()) as Row;
    return { id: n.id, clientId: n.client_id, body: n.body, createdAt: n.created_at };
  }

  async saveService(service: Omit<Service, 'id' | 'sort'> & { id?: string }, staffIds: string[]) {
    const row = serviceRow(service);
    const saved = service.id
      ? ok(await this.sb.from('services').update(row).eq('id', service.id).select().single())
      : ok(await this.sb.from('services').insert(row).select().single());
    const id = (saved as Row).id;
    ok(await this.sb.from('staff_services').delete().eq('service_id', id));
    if (staffIds.length) ok(await this.sb.from('staff_services').insert(staffIds.map((staff_id) => ({ staff_id, service_id: id }))));
    return mapService(saved);
  }

  async archiveService(id: string) {
    ok(await this.sb.from('services').update({ active: false }).eq('id', id));
  }

  async saveStaff(staff: Omit<Staff, 'id' | 'sort' | 'color'> & { id?: string }, serviceIds: string[], hours: Omit<StaffHours, 'staffId'>[]) {
    let saved: Row;
    if (staff.id) {
      saved = ok(await this.sb.from('staff').update({ name: staff.name, role: staff.role, photo_url: staff.photoUrl, active: staff.active }).eq('id', staff.id).select().single());
    } else {
      const { count } = await this.sb.from('staff').select('id', { count: 'exact', head: true }).eq('business_id', staff.businessId);
      const n = count ?? 0;
      saved = ok(await this.sb.from('staff').insert({ business_id: staff.businessId, name: staff.name, role: staff.role, photo_url: staff.photoUrl, active: staff.active, sort: n, color: STAFF_COLORS[n % STAFF_COLORS.length] }).select().single());
    }
    ok(await this.sb.from('staff_services').delete().eq('staff_id', saved.id));
    if (serviceIds.length) ok(await this.sb.from('staff_services').insert(serviceIds.map((service_id) => ({ staff_id: saved.id, service_id }))));
    ok(await this.sb.from('staff_hours').delete().eq('staff_id', saved.id));
    if (hours.length) ok(await this.sb.from('staff_hours').insert(hours.map((h) => ({ staff_id: saved.id, weekday: h.weekday, starts: h.starts, ends: h.ends }))));
    return mapStaff(saved);
  }

  async archiveStaff(id: string) {
    ok(await this.sb.from('staff').update({ active: false }).eq('id', id));
  }

  async addTimeOff(t: Omit<TimeOff, 'id'>) {
    const r = ok(await this.sb.from('time_off').insert({ business_id: t.businessId, staff_id: t.staffId, starts_at: t.startsAt, ends_at: t.endsAt, reason: t.reason }).select().single()) as Row;
    return { ...t, id: r.id };
  }

  async deleteTimeOff(id: string) {
    ok(await this.sb.from('time_off').delete().eq('id', id));
  }

  async saveHours(businessId: string, hours: Omit<BusinessHours, 'businessId'>[]) {
    ok(await this.sb.from('business_hours').delete().eq('business_id', businessId));
    if (hours.length)
      ok(await this.sb.from('business_hours').insert(hours.map((h) => ({ business_id: businessId, weekday: h.weekday, opens: h.opens, closes: h.closes, break_start: h.breakStart, break_end: h.breakEnd }))));
  }

  async updateBusiness(id: string, patch: Partial<Business>) {
    const row: Row = {};
    const map: [keyof Business, string][] = [
      ['name', 'name'], ['district', 'district'], ['address', 'address'], ['phone', 'phone'], ['whatsapp', 'whatsapp'], ['description', 'description'],
      ['instantBooking', 'instant_booking'], ['audience', 'audience'], ['slotStepMin', 'slot_step_min'], ['minNoticeMin', 'min_notice_min'],
      ['paymentOptions', 'payment_options'], ['paymentMethods', 'payment_methods'], ['cancellationHours', 'cancellation_hours'], ['cityId', 'city_id'],
    ];
    for (const [k, col] of map) if (patch[k] !== undefined) row[col] = patch[k];
    if (patch.depositRule) {
      row.deposit_type = patch.depositRule.type;
      row.deposit_value = 'value' in patch.depositRule ? patch.depositRule.value : 0;
    }
    return mapBusiness(ok(await this.sb.from('businesses').update(row).eq('id', id).select().single()));
  }

  async replyReview(id: string, reply: string) {
    ok(await this.sb.from('reviews').update({ reply: reply.trim() || null }).eq('id', id));
  }

  async createBusiness(input: OnboardingInput) {
    const ref = await this.reference();
    const city = ref.cities.find((c) => c.id === input.cityId)!;
    const base = `${input.name}-${city.name}`.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const slug = `${base}-${Math.random().toString(36).slice(2, 6)}`;
    const b = ok(await this.sb.from('businesses').insert({
      slug, name: input.name, city_id: input.cityId, district: input.district, address: input.address, lat: city.lat, lng: city.lng,
      phone: input.phone, whatsapp: input.phone, description: input.description, audience: input.audience, owner_id: input.ownerId,
      payment_options: ['on_site', 'full'], payment_methods: ['mobile_money', 'cash'],
    }).select().single()) as Row;
    const staff = ok(await this.sb.from('staff').insert(input.staff.map((s, k) => ({ business_id: b.id, name: s.name, role: s.role, sort: k, color: STAFF_COLORS[k % STAFF_COLORS.length] }))).select()) as Row[];
    const services = ok(await this.sb.from('services').insert(input.services.map((s, k) => ({ business_id: b.id, category_id: s.categoryId, name: s.name, duration_min: s.durationMin, price: s.price, sort: k }))).select()) as Row[];
    ok(await this.sb.from('staff_services').insert(staff.flatMap((st) => services.map((sv) => ({ staff_id: st.id, service_id: sv.id })))));
    await this.saveHours(b.id, input.hours);
    return mapBusiness(b);
  }

  /* admin ------------------------------------------------------------ */

  async adminStats(): Promise<AdminStats> {
    const d = ok(await this.sb.rpc('admin_stats')) as Row;
    return { bookings: d.bookings, gmv: d.gmv, activeSalons: d.active_salons, users: d.users };
  }

  async adminListBusinesses() {
    const ref = await this.reference();
    return (ok(await this.sb.from('businesses').select('*').order('name')) as Row[]).map((r) => {
      const b = mapBusiness(r);
      return { ...b, city: ref.cities.find((c) => c.id === b.cityId)! };
    });
  }

  async adminSetBusinessStatus(id: string, status: Business['status']) {
    ok(await this.sb.from('businesses').update({ status }).eq('id', id));
  }

  async adminListProfiles() {
    return (ok(await this.sb.from('profiles').select('*').order('created_at', { ascending: false }).limit(200)) as Row[]).map(mapProfile);
  }

  async adminListAppointments() {
    return (ok(await this.sb.from('appointments').select(APPT_SELECT).order('created_at', { ascending: false }).limit(100)) as Row[]).map(mapView);
  }

  async adminListPayments(): Promise<Payment[]> {
    return (ok(await this.sb.from('payments').select('*').order('created_at', { ascending: false }).limit(100)) as Row[]).map((p) => ({
      id: p.id, appointmentId: p.appointment_id, businessId: p.business_id, provider: p.provider, method: p.method, amount: p.amount, status: p.status, phone: p.phone, providerRef: p.provider_ref, createdAt: p.created_at,
    }));
  }

  async adminListNotifications(): Promise<NotificationLog[]> {
    return (ok(await this.sb.from('notifications').select('*').order('created_at', { ascending: false }).limit(200)) as Row[]).map((n) => ({
      id: n.id, channel: n.channel, event: n.event, recipient: n.recipient, body: n.body, businessId: n.business_id, appointmentId: n.appointment_id, createdAt: n.created_at,
    }));
  }

  async adminSaveCity(c: City) {
    ok(await this.sb.from('cities').upsert({ ...(c.id ? { id: c.id } : {}), country_code: c.countryCode, name: c.name, slug: c.slug, timezone: c.timezone, lat: c.lat, lng: c.lng }));
    this.ref = null;
  }

  async adminSaveCategory(c: Category) {
    ok(await this.sb.from('categories').upsert({ ...(c.id ? { id: c.id } : {}), slug: c.slug, key: c.key, sort: c.sort }));
    this.ref = null;
  }

  async adminSaveCountry(c: Country) {
    ok(await this.sb.from('countries').upsert({ code: c.code, name: c.name, currency: c.currency, dial_code: c.dialCode, timezone: c.timezone, operators: c.operators, default_locale: c.defaultLocale, flag: c.flag, phone_length: c.phoneLength }));
    this.ref = null;
  }
}
