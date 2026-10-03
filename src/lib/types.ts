/**
 * Domain model shared by every data adapter (demo + Supabase).
 * Mirrors the Postgres schema in supabase/migrations. All instants are UTC ISO strings;
 * wall-clock values (opening hours) are "HH:MM" in the business' city time zone.
 */

export type CountryCode = 'CG' | 'GA' | 'CM' | 'CI' | 'BJ' | 'TG';
export type Locale = 'fr' | 'en';
export type Role = 'client' | 'staff' | 'business_owner' | 'admin';

export type PaymentOperator = 'airtel_money' | 'mtn_momo' | 'orange_money' | 'moov_money' | 'wave';
export type PaymentMethod = 'mobile_money' | 'card' | 'cash';
export type PaymentOption = 'on_site' | 'deposit' | 'full';

export type AppointmentStatus = 'pending_payment' | 'confirmed' | 'checked_in' | 'completed' | 'cancelled' | 'no_show';
export type PaymentStatus = 'pending' | 'deposit_paid' | 'paid' | 'pay_on_site' | 'failed' | 'refunded';

/** Statuses that occupy a staff member's time (mirrors the exclusion constraint filter). */
export const BLOCKING_STATUSES: AppointmentStatus[] = ['pending_payment', 'confirmed', 'checked_in', 'completed'];

export interface Country {
  code: CountryCode;
  name: string;
  currency: 'XAF' | 'XOF';
  dialCode: string;
  timezone: string;
  operators: PaymentOperator[];
  defaultLocale: Locale;
  flag: string;
  /** National significant number length, used for validation & formatting. */
  phoneLength: number;
}

export interface City {
  id: string;
  countryCode: CountryCode;
  name: string;
  slug: string;
  timezone: string;
  lat: number;
  lng: number;
}

export interface Category {
  id: string;
  slug: string;
  /** i18n key under `categories.` */
  key: string;
  sort: number;
}

export type DepositRule =
  | { type: 'none' }
  | { type: 'fixed'; value: number }
  | { type: 'percent'; value: number }
  | { type: 'full' };

export interface Business {
  id: string;
  slug: string;
  name: string;
  cityId: string;
  district: string;
  address: string;
  lat: number;
  lng: number;
  phone: string;
  whatsapp: string;
  description: string;
  /** Seed used to generate warm placeholder artwork when no uploaded photo exists. */
  photoSeeds: number[];
  photoUrls: string[];
  ratingAvg: number;
  ratingCount: number;
  instantBooking: boolean;
  audience: 'women' | 'men' | 'unisex';
  slotStepMin: number;
  minNoticeMin: number;
  depositRule: DepositRule;
  paymentOptions: PaymentOption[];
  paymentMethods: PaymentMethod[];
  cancellationHours: number;
  status: 'active' | 'suspended';
  isDemo: boolean;
  ownerId: string | null;
  createdAt: string;
}

export interface Staff {
  id: string;
  businessId: string;
  name: string;
  role: string;
  color: string;
  photoUrl: string | null;
  sort: number;
  active: boolean;
}

export interface Service {
  id: string;
  businessId: string;
  categoryId: string;
  name: string;
  description: string;
  durationMin: number;
  price: number;
  /** null → use the business default rule. */
  depositRule: DepositRule | null;
  active: boolean;
  sort: number;
}

export interface StaffService {
  staffId: string;
  serviceId: string;
}

/** weekday: 0 = Sunday … 6 = Saturday (same as JS Date & Postgres `extract(dow)`). */
export interface BusinessHours {
  businessId: string;
  weekday: number;
  opens: string;
  closes: string;
  breakStart: string | null;
  breakEnd: string | null;
}

export interface StaffHours {
  staffId: string;
  weekday: number;
  starts: string;
  ends: string;
}

/** staffId null → whole salon closed (exceptional closure). */
export interface TimeOff {
  id: string;
  businessId: string;
  staffId: string | null;
  startsAt: string;
  endsAt: string;
  reason: string;
}

export interface Profile {
  id: string;
  role: Role;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  locale: Locale;
  countryCode: CountryCode;
  createdAt: string;
}

export interface Client {
  id: string;
  businessId: string;
  profileId: string | null;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  createdAt: string;
}

export interface ClientNote {
  id: string;
  clientId: string;
  body: string;
  createdAt: string;
}

export interface AppointmentService {
  serviceId: string;
  name: string;
  durationMin: number;
  price: number;
}

export interface Appointment {
  id: string;
  reference: string;
  businessId: string;
  staffId: string;
  clientId: string;
  profileId: string | null;
  startsAt: string;
  endsAt: string;
  status: AppointmentStatus;
  paymentStatus: PaymentStatus;
  total: number;
  deposit: number;
  amountPaid: number;
  holdExpiresAt: string | null;
  source: 'online' | 'pro';
  services: AppointmentService[];
  createdAt: string;
}

export interface Payment {
  id: string;
  appointmentId: string;
  businessId: string;
  provider: PaymentOperator | 'card' | 'cash';
  method: PaymentMethod;
  amount: number;
  status: 'pending' | 'succeeded' | 'failed' | 'refunded';
  phone: string | null;
  providerRef: string;
  createdAt: string;
}

export interface Review {
  id: string;
  appointmentId: string;
  businessId: string;
  profileId: string | null;
  authorName: string;
  rating: number;
  comment: string;
  reply: string | null;
  createdAt: string;
}

export interface Favorite {
  profileId: string;
  businessId: string;
}

export type NotificationChannelName = 'whatsapp' | 'sms' | 'email';
export type NotificationEvent = 'booking_confirmed' | 'reminder_d1' | 'booking_cancelled' | 'new_booking_salon';

export interface NotificationLog {
  id: string;
  channel: NotificationChannelName;
  event: NotificationEvent;
  recipient: string;
  body: string;
  businessId: string | null;
  appointmentId: string | null;
  createdAt: string;
}

/* ---------- View models returned by the API ---------- */

export interface SalonSummary {
  business: Business;
  city: City;
  minPrice: number;
  nextSlot: string | null;
  /** Service the next slot was computed for (shortest one) — lets the card deep-link into booking. */
  nextSlotServiceId: string | null;
  distanceKm: number | null;
  acceptsMobileMoney: boolean;
  categoryIds: string[];
}

export interface SalonDetail {
  business: Business;
  city: City;
  country: Country;
  services: Service[];
  staff: Staff[];
  staffServices: StaffService[];
  hours: BusinessHours[];
  reviews: Review[];
  categories: Category[];
}

export interface Slot {
  /** UTC ISO start. */
  start: string;
  /** Staff members free for the whole duration, in assignment priority order. */
  staffIds: string[];
}

export interface DayAvailability {
  /** Local date YYYY-MM-DD in the business time zone. */
  date: string;
  available: boolean;
}

export interface AppointmentView extends Appointment {
  business: Business;
  city: City;
  staff: Staff | null;
  client: Client;
  hasReview: boolean;
}
