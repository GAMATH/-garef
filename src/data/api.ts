/**
 * Kuzuri data contract. Two adapters implement it:
 *  - `DemoApi` (src/data/demo): self-contained, persisted in the browser, realtime across tabs.
 *  - `SupabaseApi` (src/data/supabase): Postgres + RLS + RPC booking engine + Realtime.
 * UI code only ever talks to this interface (through TanStack Query hooks).
 */
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
  Locale,
  NotificationLog,
  Payment,
  PaymentMethod,
  PaymentOperator,
  PaymentOption,
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

export type ApiErrorCode =
  | 'SLOT_TAKEN'
  | 'HOLD_EXPIRED'
  | 'NOT_FOUND'
  | 'INVALID_OTP'
  | 'INVALID_CREDENTIALS'
  | 'RATE_LIMITED'
  | 'FORBIDDEN'
  | 'CANCELLATION_TOO_LATE'
  | 'EMAIL_TAKEN'
  | 'UNKNOWN';

export class ApiError extends Error {
  constructor(public code: ApiErrorCode, message?: string, public alternatives: Slot[] = []) {
    super(message ?? code);
  }
}

export interface Reference {
  countries: Country[];
  cities: City[];
  categories: Category[];
}

export interface SearchParams {
  q?: string;
  countryCode?: string;
  cityId?: string;
  categorySlug?: string;
  near?: { lat: number; lng: number } | null;
  availableToday?: boolean;
  maxPrice?: number | null;
  minRating?: number | null;
  mobileMoney?: boolean;
  instantOnly?: boolean;
  audience?: Business['audience'] | null;
  sort?: 'relevance' | 'distance' | 'price' | 'rating';
  offset?: number;
  limit?: number;
}

export interface Page<T> {
  items: T[];
  nextOffset: number | null;
  total: number;
}

export interface Suggestions {
  services: string[];
  salons: { slug: string; name: string; district: string; city: string }[];
  categories: Category[];
}

export interface SlotQuery {
  businessId: string;
  serviceIds: string[];
  staffId: string | null;
  excludeAppointmentId?: string;
}

export interface ContactInput {
  firstName: string;
  lastName?: string;
  phone: string; // E.164
  email?: string;
}

export interface HoldInput extends SlotQuery {
  start: string;
  contact: ContactInput;
  profileId: string | null;
}

export interface PaymentInput {
  appointmentId: string;
  option: PaymentOption;
  method: PaymentMethod;
  operator?: PaymentOperator;
  phone?: string;
}

export interface PaymentProgress {
  paymentId: string | null;
  status: 'pending' | 'succeeded' | 'failed';
  appointment: Appointment;
}

export interface DashboardStats {
  revenueToday: number;
  appointmentsToday: number;
  newClients30d: number;
  noShowRate30d: number;
  revenue7d: { date: string; amount: number }[];
}

export interface ClientWithStats extends Client {
  visits: number;
  spent: number;
  lastVisit: string | null;
}

export interface ClientDetail {
  client: ClientWithStats;
  notes: ClientNote[];
  appointments: AppointmentView[];
}

export interface ProAppointmentInput {
  businessId: string;
  serviceIds: string[];
  staffId: string;
  start: string;
  clientId?: string;
  newClient?: ContactInput;
}

export interface AdminStats {
  bookings: number;
  gmv: number;
  activeSalons: number;
  users: number;
}

export interface OnboardingInput {
  ownerId: string;
  name: string;
  cityId: string;
  district: string;
  address: string;
  phone: string;
  description: string;
  audience: Business['audience'];
  services: { name: string; categoryId: string; durationMin: number; price: number }[];
  staff: { name: string; role: string }[];
  hours: Omit<BusinessHours, 'businessId'>[];
}

export type Unsubscribe = () => void;
export interface RealtimeEvent {
  type: 'INSERT' | 'UPDATE';
  appointment: Appointment;
}

export interface Api {
  readonly mode: 'demo' | 'supabase';

  /* Reference */
  getReference(): Promise<Reference>;

  /* Discovery */
  searchSalons(params: SearchParams): Promise<Page<SalonSummary>>;
  suggest(q: string): Promise<Suggestions>;
  getSalon(slug: string): Promise<SalonDetail>;

  /* Booking engine */
  getAvailableDays(query: SlotQuery, from: string, count: number): Promise<DayAvailability[]>;
  getSlots(query: SlotQuery & { date: string }): Promise<Slot[]>;
  createHold(input: HoldInput): Promise<Appointment>;
  releaseHold(appointmentId: string): Promise<void>;
  initiatePayment(input: PaymentInput): Promise<PaymentProgress>;
  verifyPayment(paymentId: string): Promise<PaymentProgress>;
  getBooking(reference: string): Promise<AppointmentView>;

  /* Auth (phone OTP is mocked) */
  getSession(): Promise<Profile | null>;
  sendOtp(phone: string): Promise<{ devCode: string | null }>;
  verifyOtp(phone: string, code: string, firstName?: string): Promise<Profile>;
  signInWithPassword(email: string, password: string): Promise<Profile>;
  signUpOwner(input: { email: string; password: string; firstName: string; phone: string }): Promise<Profile>;
  signOut(): Promise<void>;
  updateProfile(id: string, patch: Partial<Pick<Profile, 'firstName' | 'lastName' | 'email' | 'locale' | 'countryCode'>>): Promise<Profile>;

  /* Client space */
  listMyAppointments(profileId: string): Promise<AppointmentView[]>;
  cancelAppointment(id: string, by: 'client' | 'salon'): Promise<void>;
  rescheduleAppointment(id: string, start: string, staffId: string | null): Promise<Appointment>;
  createReview(input: { appointmentId: string; rating: number; comment: string; profileId: string }): Promise<Review>;
  listFavoriteIds(profileId: string): Promise<string[]>;
  listFavorites(profileId: string): Promise<SalonSummary[]>;
  toggleFavorite(profileId: string, businessId: string): Promise<boolean>;

  /* Pro space */
  getMyBusiness(profileId: string): Promise<Business | null>;
  getBusinessBundle(businessId: string): Promise<SalonDetail & { staffHours: StaffHours[]; timeOff: TimeOff[]; allServices: Service[]; allStaff: Staff[] }>;
  getDashboard(businessId: string): Promise<DashboardStats>;
  listAppointments(q: { businessId: string; from: string; to: string; status?: AppointmentStatus | null }): Promise<AppointmentView[]>;
  setAppointmentStatus(id: string, status: AppointmentStatus): Promise<void>;
  createProAppointment(input: ProAppointmentInput): Promise<Appointment>;
  moveAppointment(id: string, start: string, staffId: string): Promise<Appointment>;
  subscribeAppointments(businessId: string, cb: (e: RealtimeEvent) => void): Unsubscribe;
  listClients(businessId: string, q: string): Promise<ClientWithStats[]>;
  getClient(clientId: string): Promise<ClientDetail>;
  addClientNote(clientId: string, body: string): Promise<ClientNote>;
  saveService(service: Omit<Service, 'id' | 'sort'> & { id?: string }, staffIds: string[]): Promise<Service>;
  archiveService(id: string): Promise<void>;
  saveStaff(staff: Omit<Staff, 'id' | 'sort' | 'color'> & { id?: string }, serviceIds: string[], hours: Omit<StaffHours, 'staffId'>[]): Promise<Staff>;
  archiveStaff(id: string): Promise<void>;
  addTimeOff(t: Omit<TimeOff, 'id'>): Promise<TimeOff>;
  deleteTimeOff(id: string): Promise<void>;
  saveHours(businessId: string, hours: Omit<BusinessHours, 'businessId'>[]): Promise<void>;
  updateBusiness(id: string, patch: Partial<Business>): Promise<Business>;
  replyReview(id: string, reply: string): Promise<void>;
  createBusiness(input: OnboardingInput): Promise<Business>;

  /* Admin */
  adminStats(): Promise<AdminStats>;
  adminListBusinesses(): Promise<(Business & { city: City })[]>;
  adminSetBusinessStatus(id: string, status: Business['status']): Promise<void>;
  adminListProfiles(): Promise<Profile[]>;
  adminListAppointments(): Promise<AppointmentView[]>;
  adminListPayments(): Promise<Payment[]>;
  adminListNotifications(): Promise<NotificationLog[]>;
  adminSaveCity(city: City): Promise<void>;
  adminSaveCategory(category: Category): Promise<void>;
  adminSaveCountry(country: Country): Promise<void>;
  resetDemo?(): Promise<void>;
}

export type { Locale };
