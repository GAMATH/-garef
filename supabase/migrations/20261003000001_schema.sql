-- Kuzuri · 0001 · Schema
-- All instants are timestamptz (stored UTC). Opening hours are local wall-clock `time`
-- interpreted in the city's IANA time zone.

create extension if not exists btree_gist;
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- enums
create type public.app_role as enum ('client', 'staff', 'business_owner', 'admin');
create type public.appointment_status as enum ('pending_payment', 'confirmed', 'checked_in', 'completed', 'cancelled', 'no_show');
create type public.payment_status as enum ('pending', 'deposit_paid', 'paid', 'pay_on_site', 'failed', 'refunded');
create type public.payment_method as enum ('mobile_money', 'card', 'cash');
create type public.payment_option as enum ('on_site', 'deposit', 'full');
create type public.deposit_type as enum ('none', 'fixed', 'percent', 'full');
create type public.audience as enum ('women', 'men', 'unisex');
create type public.notification_channel as enum ('whatsapp', 'sms', 'email');

-- ---------------------------------------------------------------- reference
create table public.countries (
  code text primary key check (code ~ '^[A-Z]{2}$'),
  name text not null,
  currency text not null check (currency in ('XAF', 'XOF')),
  dial_code text not null,
  timezone text not null,
  operators text[] not null default '{}',
  default_locale text not null default 'fr',
  flag text not null default '',
  phone_length int not null default 9
);

create table public.cities (
  id uuid primary key default gen_random_uuid(),
  country_code text not null references public.countries(code),
  name text not null,
  slug text not null unique,
  timezone text not null,
  lat double precision not null,
  lng double precision not null
);
create index cities_country_idx on public.cities(country_code);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  key text not null,
  sort int not null default 0
);

-- ---------------------------------------------------------------- people
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role public.app_role not null default 'client',
  first_name text not null default '',
  last_name text not null default '',
  phone text unique,
  email text,
  locale text not null default 'fr' check (locale in ('fr', 'en')),
  country_code text not null default 'CG' references public.countries(code),
  created_at timestamptz not null default now()
);

-- New auth user → profile (phone/email copied, first name from metadata).
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, phone, email, first_name, role)
  values (
    new.id,
    nullif(case when new.phone is null or new.phone = '' then null when left(new.phone, 1) = '+' then new.phone else '+' || new.phone end, ''),
    new.email,
    coalesce(new.raw_user_meta_data ->> 'first_name', ''),
    coalesce((new.raw_user_meta_data ->> 'role')::public.app_role, 'client')
  )
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------- businesses
create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  city_id uuid not null references public.cities(id),
  district text not null default '',
  address text not null default '',
  lat double precision not null,
  lng double precision not null,
  phone text not null default '',
  whatsapp text not null default '',
  description text not null default '',
  photo_seeds int[] not null default '{1,2,3}',
  rating_avg numeric(2,1) not null default 0,
  rating_count int not null default 0,
  instant_booking boolean not null default true,
  audience public.audience not null default 'unisex',
  slot_step_min int not null default 15 check (slot_step_min between 5 and 120),
  min_notice_min int not null default 60 check (min_notice_min >= 0),
  deposit_type public.deposit_type not null default 'none',
  deposit_value int not null default 0 check (deposit_value >= 0),
  payment_options public.payment_option[] not null default '{on_site}',
  payment_methods public.payment_method[] not null default '{mobile_money,cash}',
  cancellation_hours int not null default 24,
  status text not null default 'active' check (status in ('active', 'suspended')),
  is_demo boolean not null default false,
  owner_id uuid references public.profiles(id) on delete set null,
  search tsvector generated always as (
    setweight(to_tsvector('simple', coalesce(name, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(district, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(description, '')), 'C')
  ) stored,
  created_at timestamptz not null default now()
);
create index businesses_city_idx on public.businesses(city_id) where status = 'active';
create index businesses_geo_idx on public.businesses(lat, lng);
create index businesses_search_idx on public.businesses using gin(search);
create index businesses_owner_idx on public.businesses(owner_id);

create table public.business_photos (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  storage_path text not null,
  sort int not null default 0
);
create index business_photos_business_idx on public.business_photos(business_id, sort);

create table public.staff (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  profile_id uuid references public.profiles(id) on delete set null,
  name text not null,
  role text not null default '',
  color text not null default '#C4532D',
  photo_url text,
  sort int not null default 0,
  active boolean not null default true
);
create index staff_business_idx on public.staff(business_id);

create table public.services (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  category_id uuid not null references public.categories(id),
  name text not null,
  description text not null default '',
  duration_min int not null check (duration_min between 5 and 720),
  price int not null check (price >= 0),
  deposit_type public.deposit_type,
  deposit_value int,
  active boolean not null default true,
  sort int not null default 0,
  search tsvector generated always as (to_tsvector('simple', coalesce(name, '') || ' ' || coalesce(description, ''))) stored
);
create index services_business_idx on public.services(business_id) where active;
create index services_category_idx on public.services(category_id) where active;
create index services_search_idx on public.services using gin(search);

create table public.staff_services (
  staff_id uuid not null references public.staff(id) on delete cascade,
  service_id uuid not null references public.services(id) on delete cascade,
  primary key (staff_id, service_id)
);
create index staff_services_service_idx on public.staff_services(service_id);

-- weekday: 0 = Sunday … 6 = Saturday (extract(dow)).
create table public.business_hours (
  business_id uuid not null references public.businesses(id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  opens time not null,
  closes time not null,
  break_start time,
  break_end time,
  primary key (business_id, weekday),
  check (closes > opens),
  check ((break_start is null) = (break_end is null)),
  check (break_start is null or (break_start >= opens and break_end <= closes and break_end > break_start))
);

create table public.staff_hours (
  staff_id uuid not null references public.staff(id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  starts time not null,
  ends time not null,
  primary key (staff_id, weekday),
  check (ends > starts)
);

-- staff_id null → whole salon closed (exceptional closure).
create table public.time_off (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  staff_id uuid references public.staff(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text not null default '',
  check (ends_at > starts_at)
);
create index time_off_business_idx on public.time_off(business_id, starts_at);

-- ---------------------------------------------------------------- clients
create table public.clients (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  profile_id uuid references public.profiles(id) on delete set null,
  first_name text not null,
  last_name text not null default '',
  phone text not null,
  email text not null default '',
  created_at timestamptz not null default now(),
  unique (business_id, phone)
);
create index clients_profile_idx on public.clients(profile_id);

create table public.client_notes (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  body text not null check (length(body) between 1 and 2000),
  author_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- appointments
create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  business_id uuid not null references public.businesses(id) on delete cascade,
  staff_id uuid not null references public.staff(id),
  client_id uuid not null references public.clients(id),
  profile_id uuid references public.profiles(id) on delete set null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  time_range tstzrange generated always as (tstzrange(starts_at, ends_at, '[)')) stored,
  status public.appointment_status not null default 'pending_payment',
  payment_status public.payment_status not null default 'pending',
  total int not null check (total >= 0),
  deposit int not null default 0 check (deposit >= 0),
  amount_paid int not null default 0 check (amount_paid >= 0),
  hold_expires_at timestamptz,
  source text not null default 'online' check (source in ('online', 'pro')),
  reminder_sent_at timestamptz,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at),
  -- Anti double-booking, guaranteed by the database: one staff member can never hold two
  -- overlapping active appointments. Expired holds are released by `release_expired_holds()`
  -- (pg_cron, every minute) and lazily before each new hold.
  constraint appointments_no_overlap exclude using gist (staff_id with =, time_range with &&)
    where (status in ('pending_payment', 'confirmed', 'checked_in', 'completed'))
);
create index appointments_business_time_idx on public.appointments(business_id, starts_at);
create index appointments_profile_idx on public.appointments(profile_id, starts_at desc);
create index appointments_hold_idx on public.appointments(hold_expires_at) where status = 'pending_payment';

create table public.appointment_services (
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  service_id uuid not null references public.services(id),
  name text not null,
  duration_min int not null,
  price int not null,
  sort int not null default 0,
  primary key (appointment_id, service_id)
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  provider text not null,
  method public.payment_method not null,
  amount int not null check (amount >= 0),
  status text not null default 'pending' check (status in ('pending', 'succeeded', 'failed', 'refunded')),
  phone text,
  provider_ref text not null default '',
  -- Mock provider outcome is decided at initiation and revealed after a short delay.
  mock_outcome text,
  resolves_at timestamptz,
  created_at timestamptz not null default now()
);
create index payments_appointment_idx on public.payments(appointment_id);
create index payments_business_idx on public.payments(business_id, created_at desc);

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null unique references public.appointments(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  profile_id uuid references public.profiles(id) on delete set null,
  author_name text not null,
  rating smallint not null check (rating between 1 and 5),
  comment text not null default '' check (length(comment) <= 1000),
  reply text,
  created_at timestamptz not null default now()
);
create index reviews_business_idx on public.reviews(business_id, created_at desc);

create table public.favorites (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (profile_id, business_id)
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  channel public.notification_channel not null,
  event text not null check (event in ('booking_confirmed', 'reminder_d1', 'booking_cancelled', 'new_booking_salon')),
  recipient text not null,
  body text not null,
  business_id uuid references public.businesses(id) on delete cascade,
  appointment_id uuid references public.appointments(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index notifications_created_idx on public.notifications(created_at desc);

create table public.platform_settings (
  key text primary key,
  value jsonb not null
);

create table public.rate_limits (
  key text not null,
  created_at timestamptz not null default now()
);
create index rate_limits_key_idx on public.rate_limits(key, created_at);

-- ---------------------------------------------------------------- roadmap (schema only, no UI in the MVP)
create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  plan text not null check (plan in ('starter', 'pro', 'premium')),
  commission_rate numeric(5,2) not null default 0,
  starts_at timestamptz not null default now(),
  ends_at timestamptz
);
create table public.promotions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  kind text not null check (kind in ('discount', 'happy_hour')),
  percent int check (percent between 1 and 90),
  weekday smallint, starts time, ends time,
  service_ids uuid[] not null default '{}',
  valid_from date, valid_to date
);
create table public.loyalty_accounts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  points int not null default 0,
  unique (business_id, client_id)
);
create table public.loyalty_transactions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.loyalty_accounts(id) on delete cascade,
  appointment_id uuid references public.appointments(id) on delete set null,
  points int not null,
  created_at timestamptz not null default now()
);
create table public.waitlists (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  service_ids uuid[] not null,
  wanted_date date not null,
  created_at timestamptz not null default now()
);
create table public.products (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null,
  price int not null,
  active boolean not null default true
);
create table public.inventory (
  product_id uuid primary key references public.products(id) on delete cascade,
  quantity int not null default 0
);
create table public.gift_cards (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  code text not null unique,
  balance int not null,
  expires_at timestamptz
);
