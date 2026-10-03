-- Kuzuri · 0002 · Booking engine
-- Server-side slot computation, temporary holds, mock payments, notifications.
-- Twin of src/lib/booking-engine.ts (same rules, same tests).

-- ---------------------------------------------------------------- helpers
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin');
$$;

create or replace function public.owns_business(p_business_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from businesses where id = p_business_id and owner_id = auth.uid())
      or exists (select 1 from staff where business_id = p_business_id and profile_id = auth.uid())
      or public.is_admin();
$$;

create or replace function public.business_tz(p_business_id uuid) returns text
language sql stable set search_path = public as $$
  select c.timezone from businesses b join cities c on c.id = b.city_id where b.id = p_business_id;
$$;

create or replace function public.kz_raise(p_code text) returns void
language plpgsql as $$
begin
  raise exception '%', p_code using errcode = 'P0001', hint = p_code;
end $$;

-- Sliding-window rate limit. Raises RATE_LIMITED when exceeded.
create or replace function public.check_rate_limit(p_key text, p_max int, p_window interval) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from rate_limits where key = p_key and created_at < now() - p_window;
  if (select count(*) from rate_limits where key = p_key) >= p_max then
    perform kz_raise('RATE_LIMITED');
  end if;
  insert into rate_limits(key) values (p_key);
end $$;

create or replace function public.compute_deposit(p_total int, p_type public.deposit_type, p_value int) returns int
language sql immutable as $$
  select greatest(0, least(p_total, case p_type
    when 'none' then 0
    when 'fixed' then coalesce(p_value, 0)
    when 'percent' then (ceil(p_total * coalesce(p_value, 0) / 100.0 / 100.0) * 100)::int
    when 'full' then p_total
    else 0 end));
$$;

create or replace function public.new_reference() returns text
language plpgsql volatile as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  ref text;
begin
  loop
    ref := 'KZ-';
    for i in 1..5 loop
      ref := ref || substr(alphabet, 1 + floor(random() * 32)::int, 1);
    end loop;
    exit when not exists (select 1 from appointments where reference = ref);
  end loop;
  return ref;
end $$;

-- ---------------------------------------------------------------- availability
-- Free slots for a local date. Each row: UTC start + staff free for the whole duration,
-- in assignment priority order (staff.sort). Grid anchored on the opening time.
create or replace function public.get_available_slots(
  p_business_id uuid,
  p_service_ids uuid[],
  p_staff_id uuid,
  p_date date,
  p_exclude_appointment uuid default null,
  p_now timestamptz default now()
) returns table (slot_start timestamptz, staff_ids uuid[])
language sql stable security definer set search_path = public as $$
  with b as (
    select b.id, c.timezone as tz, b.slot_step_min as step, b.min_notice_min as notice
    from businesses b join cities c on c.id = b.city_id
    where b.id = p_business_id and b.status = 'active'
  ),
  svc as (
    select sum(duration_min)::int as dur, count(*) as n
    from services where id = any(p_service_ids) and business_id = p_business_id and active
  ),
  bh as (
    select h.* from business_hours h join b on h.business_id = b.id
    where h.weekday = extract(dow from p_date)::int
  ),
  eligible as (
    select s.id, s.sort from staff s join b on s.business_id = b.id
    where s.active
      and (p_staff_id is null or s.id = p_staff_id)
      and not exists (
        select 1 from unnest(p_service_ids) as sid
        where not exists (select 1 from staff_services ss where ss.staff_id = s.id and ss.service_id = sid)
      )
  ),
  win as (
    select e.id as staff_id, e.sort,
           greatest(bh.opens, coalesce(sh.starts, bh.opens)) as w_start,
           least(bh.closes, coalesce(sh.ends, bh.closes)) as w_end
    from eligible e
    cross join bh
    left join staff_hours sh on sh.staff_id = e.id and sh.weekday = bh.weekday
    where sh.staff_id is not null or not exists (select 1 from staff_hours x where x.staff_id = e.id)
  ),
  cand as (
    select w.staff_id, w.sort,
           (lt at time zone b.tz) as s,
           ((lt + make_interval(mins => svc.dur)) at time zone b.tz) as e
    from win w, bh, b, svc,
         generate_series(p_date + bh.opens, p_date + bh.closes, make_interval(mins => b.step)) as lt
    where svc.n = cardinality(p_service_ids) and svc.dur > 0
      and lt >= p_date + w.w_start
      and lt + make_interval(mins => svc.dur) <= p_date + w.w_end
  )
  select c.s as slot_start, array_agg(c.staff_id order by c.sort, c.staff_id) as staff_ids
  from cand c, b, bh
  where c.s >= p_now + make_interval(mins => b.notice)
    and not (bh.break_start is not null and tstzrange(c.s, c.e, '[)') &&
             tstzrange((p_date + bh.break_start) at time zone b.tz, (p_date + bh.break_end) at time zone b.tz, '[)'))
    and not exists (
      select 1 from time_off t
      where t.business_id = p_business_id and (t.staff_id is null or t.staff_id = c.staff_id)
        and tstzrange(t.starts_at, t.ends_at, '[)') && tstzrange(c.s, c.e, '[)')
    )
    and not exists (
      select 1 from appointments a
      where a.staff_id = c.staff_id
        and a.id is distinct from p_exclude_appointment
        and a.time_range && tstzrange(c.s, c.e, '[)')
        and (a.status in ('confirmed', 'checked_in', 'completed')
             or (a.status = 'pending_payment' and a.hold_expires_at > p_now))
    )
  group by c.s
  order by c.s;
$$;

create or replace function public.get_available_days(
  p_business_id uuid, p_service_ids uuid[], p_staff_id uuid, p_from date, p_count int default 14,
  p_exclude_appointment uuid default null
) returns table (day date, available boolean)
language sql stable security definer set search_path = public as $$
  select d::date as day,
         exists (select 1 from get_available_slots(p_business_id, p_service_ids, p_staff_id, d::date, p_exclude_appointment)) as available
  from generate_series(p_from, p_from + (least(p_count, 31) - 1), interval '1 day') as d;
$$;

-- Earliest free slot over the next 7 days for the salon's shortest service (search cards).
create or replace function public.next_available_slot(p_business_id uuid) returns timestamptz
language plpgsql stable security definer set search_path = public as $$
declare
  v_service uuid;
  v_tz text := business_tz(p_business_id);
  v_day date := (now() at time zone v_tz)::date;
  v_slot timestamptz;
begin
  select id into v_service from services where business_id = p_business_id and active
    and exists (select 1 from staff_services ss join staff s on s.id = ss.staff_id where ss.service_id = services.id and s.active)
    order by duration_min, price limit 1;
  if v_service is null then return null; end if;
  for i in 0..6 loop
    select slot_start into v_slot from get_available_slots(p_business_id, array[v_service], null, v_day + i) limit 1;
    if v_slot is not null then return v_slot; end if;
  end loop;
  return null;
end $$;

-- ---------------------------------------------------------------- holds
create or replace function public.release_expired_holds() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update payments set status = 'failed'
    where status = 'pending' and appointment_id in (
      select id from appointments where status = 'pending_payment' and hold_expires_at <= now());
  update appointments set status = 'cancelled', payment_status = 'failed', hold_expires_at = null
    where status = 'pending_payment' and hold_expires_at <= now();
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.upsert_client(
  p_business_id uuid, p_first_name text, p_last_name text, p_phone text, p_email text, p_profile_id uuid
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if p_phone !~ '^\+[0-9]{8,15}$' then perform kz_raise('INVALID_PHONE'); end if;
  insert into clients (business_id, first_name, last_name, phone, email, profile_id)
  values (p_business_id, trim(p_first_name), coalesce(trim(p_last_name), ''), p_phone, coalesce(p_email, ''), p_profile_id)
  on conflict (business_id, phone) do update
    set first_name = excluded.first_name,
        last_name = case when excluded.last_name <> '' then excluded.last_name else clients.last_name end,
        email = case when excluded.email <> '' then excluded.email else clients.email end,
        profile_id = coalesce(clients.profile_id, excluded.profile_id)
  returning id into v_id;
  return v_id;
end $$;

-- Creates a pending_payment appointment that blocks the slot for 10 minutes.
-- Raises SLOT_TAKEN when the slot is no longer free (including a lost race: the
-- exclusion constraint is the final arbiter).
create or replace function public.create_booking_hold(
  p_business_id uuid,
  p_service_ids uuid[],
  p_staff_id uuid,
  p_start timestamptz,
  p_first_name text,
  p_last_name text,
  p_phone text,
  p_email text default ''
) returns public.appointments
language plpgsql security definer set search_path = public as $$
declare
  v_tz text := business_tz(p_business_id);
  v_b businesses;
  v_staff uuid[];
  v_candidate uuid;
  v_client uuid;
  v_dur int;
  v_total int;
  v_deposit int;
  v_appt appointments;
begin
  if length(coalesce(trim(p_first_name), '')) = 0 then perform kz_raise('INVALID_INPUT'); end if;
  perform check_rate_limit('hold:' || p_phone, 6, interval '10 minutes');
  perform release_expired_holds();

  select * into v_b from businesses where id = p_business_id and status = 'active';
  if not found then perform kz_raise('NOT_FOUND'); end if;

  select staff_ids into v_staff
  from get_available_slots(p_business_id, p_service_ids, p_staff_id, (p_start at time zone v_tz)::date)
  where slot_start = p_start;
  if v_staff is null then perform kz_raise('SLOT_TAKEN'); end if;

  select sum(duration_min), sum(price) into v_dur, v_total from services where id = any(p_service_ids);
  select greatest(
           compute_deposit(v_total, v_b.deposit_type, v_b.deposit_value),
           coalesce(sum(compute_deposit(price, deposit_type, deposit_value)) filter (where deposit_type is not null), 0)::int)
    into v_deposit from services where id = any(p_service_ids);
  v_deposit := least(v_deposit, v_total);

  v_client := upsert_client(p_business_id, p_first_name, p_last_name, p_phone, p_email, auth.uid());

  -- "Peu importe": try free staff in priority order; a concurrent booking may win a race.
  foreach v_candidate in array v_staff loop
    begin
      insert into appointments (reference, business_id, staff_id, client_id, profile_id, starts_at, ends_at,
                                status, payment_status, total, deposit, hold_expires_at, source)
      values (new_reference(), p_business_id, v_candidate, v_client, auth.uid(), p_start,
              p_start + make_interval(mins => v_dur), 'pending_payment', 'pending', v_total, v_deposit,
              now() + interval '10 minutes', 'online')
      returning * into v_appt;
      exit;
    exception when exclusion_violation then
      v_appt := null;
    end;
  end loop;
  if v_appt.id is null then perform kz_raise('SLOT_TAKEN'); end if;

  insert into appointment_services (appointment_id, service_id, name, duration_min, price, sort)
  select v_appt.id, s.id, s.name, s.duration_min, s.price, array_position(p_service_ids, s.id)
  from services s where s.id = any(p_service_ids);

  return v_appt;
end $$;

create or replace function public.release_hold(p_appointment_id uuid) returns void
language sql security definer set search_path = public as $$
  update appointments set status = 'cancelled', payment_status = 'failed', hold_expires_at = null
  where id = p_appointment_id and status = 'pending_payment';
$$;

-- ---------------------------------------------------------------- notifications (mock channels)
create or replace function public.notify_appointment(p_appointment_id uuid, p_event text) returns void
language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_when text;
begin
  select a.*, b.name as salon, b.whatsapp as salon_phone, c.first_name, c.phone as client_phone, ci.timezone as tz,
         (select string_agg(name, ', ' order by sort) from appointment_services where appointment_id = a.id) as svc
  into r
  from appointments a join businesses b on b.id = a.business_id join clients c on c.id = a.client_id
  join cities ci on ci.id = b.city_id where a.id = p_appointment_id;
  if not found then return; end if;
  v_when := to_char(r.starts_at at time zone r.tz, 'DD/MM à HH24"h"MI');

  if p_event = 'booking_confirmed' then
    insert into notifications(channel, event, recipient, body, business_id, appointment_id) values
      ('whatsapp', 'booking_confirmed', r.client_phone,
       format('Bonjour %s, c''est réservé : %s le %s chez %s. Réf. %s', r.first_name, r.svc, v_when, r.salon, r.reference), r.business_id, r.id),
      ('whatsapp', 'new_booking_salon', r.salon_phone,
       format('Nouvelle réservation : %s, %s le %s. Réf. %s', r.first_name, r.svc, v_when, r.reference), r.business_id, r.id);
  elsif p_event = 'booking_cancelled' then
    insert into notifications(channel, event, recipient, body, business_id, appointment_id) values
      ('sms', 'booking_cancelled', r.client_phone,
       format('Votre rendez-vous du %s chez %s est annulé. Réf. %s', v_when, r.salon, r.reference), r.business_id, r.id);
  elsif p_event = 'reminder_d1' then
    insert into notifications(channel, event, recipient, body, business_id, appointment_id) values
      ('whatsapp', 'reminder_d1', r.client_phone,
       format('Rappel : %s le %s chez %s. À bientôt !', r.svc, v_when, r.salon), r.business_id, r.id);
  end if;
end $$;

create or replace function public.send_reminders() returns int
language plpgsql security definer set search_path = public as $$
declare v_id uuid; n int := 0;
begin
  for v_id in
    select id from appointments
    where status = 'confirmed' and reminder_sent_at is null
      and starts_at between now() and now() + interval '24 hours'
  loop
    perform notify_appointment(v_id, 'reminder_d1');
    update appointments set reminder_sent_at = now() where id = v_id;
    n := n + 1;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------- payments (adapter: mock provider)
-- Applies a provider result. Called by verify_payment (mock) or by the payments Edge Function webhook.
create or replace function public.apply_payment_result(p_payment_id uuid, p_success boolean) returns void
language plpgsql security definer set search_path = public as $$
declare
  p payments;
  a appointments;
begin
  select * into p from payments where id = p_payment_id for update;
  if not found or p.status <> 'pending' then return; end if;
  select * into a from appointments where id = p.appointment_id for update;

  if p_success and a.status = 'pending_payment' and a.hold_expires_at > now() then
    update payments set status = 'succeeded' where id = p.id;
    update appointments set status = 'confirmed', hold_expires_at = null,
      amount_paid = p.amount,
      payment_status = (case when p.amount >= a.total then 'paid' else 'deposit_paid' end)::payment_status
    where id = a.id;
    perform notify_appointment(a.id, 'booking_confirmed');
  else
    update payments set status = 'failed' where id = p.id;
    -- Failed or expired payment: release the slot immediately.
    update appointments set status = 'cancelled', payment_status = 'failed', hold_expires_at = null
    where id = a.id and status = 'pending_payment';
  end if;
end $$;
revoke execute on function public.apply_payment_result(uuid, boolean) from public, anon, authenticated;

create or replace function public.start_payment(
  p_appointment_id uuid,
  p_option public.payment_option,
  p_method public.payment_method,
  p_provider text default null,
  p_phone text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  a appointments;
  b businesses;
  v_amount int;
  v_pay payments;
begin
  select * into a from appointments where id = p_appointment_id for update;
  if not found then perform kz_raise('NOT_FOUND'); end if;
  -- An expired hold already stops blocking the slot; pg_cron cancels it within a minute.
  if a.status <> 'pending_payment' or a.hold_expires_at <= now() then
    perform kz_raise('HOLD_EXPIRED');
  end if;
  select * into b from businesses where id = a.business_id;
  if not (p_option = any(b.payment_options)) then perform kz_raise('FORBIDDEN'); end if;

  if p_option = 'on_site' then
    update appointments set status = 'confirmed', payment_status = 'pay_on_site', hold_expires_at = null
      where id = a.id returning * into a;
    perform notify_appointment(a.id, 'booking_confirmed');
    return jsonb_build_object('payment_id', null, 'status', 'succeeded', 'appointment', to_jsonb(a));
  end if;

  if p_method = 'cash' or not (p_method = any(b.payment_methods)) then perform kz_raise('FORBIDDEN'); end if;
  v_amount := case when p_option = 'deposit' then greatest(a.deposit, 0) else a.total end;
  if v_amount = 0 then perform kz_raise('FORBIDDEN'); end if;

  insert into payments (appointment_id, business_id, provider, method, amount, status, phone, provider_ref, mock_outcome, resolves_at)
  values (a.id, a.business_id, coalesce(p_provider, p_method::text), p_method, v_amount, 'pending', p_phone,
          'MOCK-' || upper(substr(md5(random()::text), 1, 10)),
          -- Mock rule: a mobile-money number ending in 0000 is declined.
          case when coalesce(p_phone, '') like '%0000' then 'failed' else 'succeeded' end,
          now() + interval '4 seconds')
  returning * into v_pay;
  return jsonb_build_object('payment_id', v_pay.id, 'status', 'pending', 'appointment', to_jsonb(a));
end $$;

create or replace function public.verify_payment(p_payment_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  p payments;
  a appointments;
begin
  select * into p from payments where id = p_payment_id;
  if not found then perform kz_raise('NOT_FOUND'); end if;
  if p.status = 'pending' and (now() >= p.resolves_at or (select hold_expires_at <= now() from appointments where id = p.appointment_id)) then
    perform apply_payment_result(p.id, p.mock_outcome = 'succeeded');
    select * into p from payments where id = p_payment_id;
  end if;
  select * into a from appointments where id = p.appointment_id;
  return jsonb_build_object('payment_id', p.id,
    'status', case p.status when 'succeeded' then 'succeeded' when 'pending' then 'pending' else 'failed' end,
    'appointment', to_jsonb(a));
end $$;

-- ---------------------------------------------------------------- appointment lifecycle
create or replace function public.cancel_appointment(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare a appointments; b businesses;
begin
  select * into a from appointments where id = p_id for update;
  if not found then perform kz_raise('NOT_FOUND'); end if;
  select * into b from businesses where id = a.business_id;
  if owns_business(a.business_id) then
    null;
  elsif a.profile_id = auth.uid() then
    if a.starts_at - now() < make_interval(hours => b.cancellation_hours) then perform kz_raise('CANCELLATION_TOO_LATE'); end if;
  else
    perform kz_raise('FORBIDDEN');
  end if;
  if a.status not in ('pending_payment', 'confirmed') then perform kz_raise('FORBIDDEN'); end if;
  update appointments set status = 'cancelled',
    payment_status = case when amount_paid > 0 then 'refunded'::payment_status else payment_status end,
    hold_expires_at = null
  where id = p_id;
  update payments set status = 'refunded' where appointment_id = p_id and status = 'succeeded';
  perform notify_appointment(p_id, 'booking_cancelled');
end $$;

create or replace function public.reschedule_appointment(p_id uuid, p_start timestamptz, p_staff_id uuid) returns public.appointments
language plpgsql security definer set search_path = public as $$
declare
  a appointments; b businesses; v_staff uuid[]; v_ids uuid[]; v_candidate uuid; v_dur int;
begin
  select * into a from appointments where id = p_id for update;
  if not found then perform kz_raise('NOT_FOUND'); end if;
  select * into b from businesses where id = a.business_id;
  if not (owns_business(a.business_id) or a.profile_id = auth.uid()) then perform kz_raise('FORBIDDEN'); end if;
  if not owns_business(a.business_id) and a.starts_at - now() < make_interval(hours => b.cancellation_hours) then
    perform kz_raise('CANCELLATION_TOO_LATE');
  end if;
  select array_agg(service_id order by sort), sum(duration_min) into v_ids, v_dur from appointment_services where appointment_id = p_id;
  select staff_ids into v_staff from get_available_slots(a.business_id, v_ids, p_staff_id, (p_start at time zone business_tz(a.business_id))::date, p_id)
    where slot_start = p_start;
  if v_staff is null then perform kz_raise('SLOT_TAKEN'); end if;
  v_candidate := case when a.staff_id = any(v_staff) and p_staff_id is null then a.staff_id else v_staff[1] end;
  begin
    update appointments set starts_at = p_start, ends_at = p_start + make_interval(mins => v_dur), staff_id = v_candidate, reminder_sent_at = null
      where id = p_id returning * into a;
  exception when exclusion_violation then perform kz_raise('SLOT_TAKEN');
  end;
  return a;
end $$;

-- Pro drag & drop: only overlap conflicts are re-validated (the pro may book outside hours).
create or replace function public.move_appointment(p_id uuid, p_start timestamptz, p_staff_id uuid) returns public.appointments
language plpgsql security definer set search_path = public as $$
declare a appointments;
begin
  select * into a from appointments where id = p_id for update;
  if not found then perform kz_raise('NOT_FOUND'); end if;
  if not owns_business(a.business_id) then perform kz_raise('FORBIDDEN'); end if;
  if not exists (select 1 from staff where id = p_staff_id and business_id = a.business_id) then perform kz_raise('FORBIDDEN'); end if;
  begin
    update appointments set starts_at = p_start, ends_at = p_start + (a.ends_at - a.starts_at), staff_id = p_staff_id, reminder_sent_at = null
      where id = p_id returning * into a;
  exception when exclusion_violation then perform kz_raise('SLOT_TAKEN');
  end;
  return a;
end $$;

create or replace function public.create_pro_appointment(
  p_business_id uuid, p_service_ids uuid[], p_staff_id uuid, p_start timestamptz,
  p_client_id uuid, p_first_name text default null, p_last_name text default null, p_phone text default null
) returns public.appointments
language plpgsql security definer set search_path = public as $$
declare v_client uuid := p_client_id; v_dur int; v_total int; a appointments;
begin
  if not owns_business(p_business_id) then perform kz_raise('FORBIDDEN'); end if;
  if v_client is null then
    v_client := upsert_client(p_business_id, p_first_name, p_last_name, p_phone, '', null);
  end if;
  select sum(duration_min), sum(price) into v_dur, v_total from services where id = any(p_service_ids) and business_id = p_business_id;
  begin
    insert into appointments (reference, business_id, staff_id, client_id, profile_id, starts_at, ends_at, status, payment_status, total, deposit, source)
    values (new_reference(), p_business_id, p_staff_id, v_client, (select profile_id from clients where id = v_client),
            p_start, p_start + make_interval(mins => v_dur), 'confirmed', 'pay_on_site', v_total, 0, 'pro')
    returning * into a;
  exception when exclusion_violation then perform kz_raise('SLOT_TAKEN');
  end;
  insert into appointment_services (appointment_id, service_id, name, duration_min, price, sort)
  select a.id, s.id, s.name, s.duration_min, s.price, array_position(p_service_ids, s.id) from services s where s.id = any(p_service_ids);
  return a;
end $$;

create or replace function public.set_appointment_status(p_id uuid, p_status public.appointment_status) returns void
language plpgsql security definer set search_path = public as $$
declare a appointments;
begin
  select * into a from appointments where id = p_id;
  if not found then perform kz_raise('NOT_FOUND'); end if;
  if not owns_business(a.business_id) then perform kz_raise('FORBIDDEN'); end if;
  if p_status = 'cancelled' then perform cancel_appointment(p_id); return; end if;
  update appointments set status = p_status,
    payment_status = case when p_status = 'completed' then 'paid'::payment_status else payment_status end,
    amount_paid = case when p_status = 'completed' then total else amount_paid end
  where id = p_id;
end $$;

-- ---------------------------------------------------------------- reviews
create or replace function public.create_review(p_appointment_id uuid, p_rating int, p_comment text) returns public.reviews
language plpgsql security definer set search_path = public as $$
declare a appointments; r reviews; v_name text;
begin
  select * into a from appointments where id = p_appointment_id;
  if not found or a.profile_id is distinct from auth.uid() then perform kz_raise('FORBIDDEN'); end if;
  if a.status <> 'completed' then perform kz_raise('FORBIDDEN'); end if;
  select first_name || ' ' || left(last_name, 1) || case when last_name <> '' then '.' else '' end into v_name
    from clients where id = a.client_id;
  insert into reviews (appointment_id, business_id, profile_id, author_name, rating, comment)
  values (a.id, a.business_id, auth.uid(), trim(v_name), p_rating, coalesce(p_comment, ''))
  returning * into r;
  return r;
end $$;

create or replace function public.refresh_business_rating() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_bid uuid := coalesce(new.business_id, old.business_id);
begin
  update businesses set
    rating_avg = coalesce((select round(avg(rating)::numeric, 1) from reviews where business_id = v_bid), 0),
    rating_count = (select count(*) from reviews where business_id = v_bid)
  where id = v_bid;
  return null;
end $$;
create trigger reviews_refresh_rating after insert or update or delete on public.reviews
  for each row execute function public.refresh_business_rating();

-- ---------------------------------------------------------------- search
create or replace function public.search_businesses(
  p_q text default null,
  p_country_code text default null,
  p_city_id uuid default null,
  p_category_slug text default null,
  p_lat double precision default null,
  p_lng double precision default null,
  p_available_today boolean default false,
  p_max_price int default null,
  p_min_rating numeric default null,
  p_mobile_money boolean default false,
  p_instant_only boolean default false,
  p_audience public.audience default null,
  p_sort text default 'relevance',
  p_offset int default 0,
  p_limit int default 12
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_tsq tsquery := case when coalesce(trim(p_q), '') = '' then null
                        else to_tsquery('simple', regexp_replace(trim(p_q), '\s+', ':* & ', 'g') || ':*') end;
  v_rows jsonb;
  v_total int;
begin
  with base as (
    select b.*, c.name as city_name,
      (select min(price) from services s where s.business_id = b.id and s.active) as min_price,
      case when p_lat is null then null else
        6371 * 2 * asin(sqrt(power(sin(radians(b.lat - p_lat) / 2), 2) +
          cos(radians(p_lat)) * cos(radians(b.lat)) * power(sin(radians(b.lng - p_lng) / 2), 2))) end as distance_km,
      case when v_tsq is null then 0 else
        ts_rank(b.search, v_tsq) + coalesce((select max(ts_rank(s.search, v_tsq)) from services s where s.business_id = b.id and s.active), 0) end as rank
    from businesses b join cities c on c.id = b.city_id
    where b.status = 'active'
      and (p_city_id is null or b.city_id = p_city_id)
      and (p_country_code is null or c.country_code = p_country_code)
      and (p_category_slug is null or exists (
        select 1 from services s join categories k on k.id = s.category_id
        where s.business_id = b.id and s.active and k.slug = p_category_slug))
      and (v_tsq is null or b.search @@ v_tsq or exists (
        select 1 from services s where s.business_id = b.id and s.active and s.search @@ v_tsq))
      and (not p_mobile_money or 'mobile_money' = any(b.payment_methods))
      and (not p_instant_only or b.instant_booking)
      and (p_audience is null or b.audience = p_audience or b.audience = 'unisex')
      and (p_min_rating is null or b.rating_avg >= p_min_rating)
  ),
  filtered as (
    select base.*, next_available_slot(base.id) as next_slot from base
    where (p_max_price is null or base.min_price <= p_max_price)
  ),
  filtered2 as (
    select * from filtered
    where not p_available_today or (next_slot is not null and
      (next_slot at time zone business_tz(id))::date = (now() at time zone business_tz(id))::date)
  )
  select count(*)::int,
    coalesce(jsonb_agg(row_json order by ord) filter (where ord > p_offset and ord <= p_offset + p_limit), '[]'::jsonb)
  into v_total, v_rows
  from (
    select row_number() over (order by
        case when p_sort = 'distance' then distance_km end asc nulls last,
        case when p_sort = 'price' then min_price end asc nulls last,
        case when p_sort = 'rating' then rating_avg end desc,
        case when p_sort = 'relevance' then rank end desc,
        next_slot asc nulls last, rating_avg desc, name) as ord,
      jsonb_build_object(
        'business', to_jsonb(f) - 'search' - 'city_name' - 'min_price' - 'distance_km' - 'rank' - 'next_slot',
        'min_price', f.min_price, 'distance_km', f.distance_km, 'next_slot', f.next_slot,
        'next_service_id', (select s.id from services s where s.business_id = f.id and s.active
           and exists (select 1 from staff_services ss join staff st on st.id = ss.staff_id where ss.service_id = s.id and st.active)
           order by s.duration_min, s.price limit 1),
        'category_ids', (select coalesce(jsonb_agg(distinct s.category_id), '[]') from services s where s.business_id = f.id and s.active)
      ) as row_json
    from filtered2 f
  ) ranked;
  return jsonb_build_object('items', v_rows, 'total', v_total);
end $$;

-- ---------------------------------------------------------------- public booking view
create or replace function public.get_booking(p_reference text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'appointment', to_jsonb(a) - 'time_range',
    'services', (select jsonb_agg(to_jsonb(s) order by s.sort) from appointment_services s where s.appointment_id = a.id),
    'staff', (select to_jsonb(st) from staff st where st.id = a.staff_id),
    'client', jsonb_build_object('id', c.id, 'first_name', c.first_name, 'last_name', c.last_name, 'phone', c.phone, 'business_id', c.business_id),
    'has_review', exists (select 1 from reviews r where r.appointment_id = a.id)
  )
  from appointments a join clients c on c.id = a.client_id
  where a.reference = upper(p_reference);
$$;

-- ---------------------------------------------------------------- dashboards
create or replace function public.business_dashboard(p_business_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_tz text := business_tz(p_business_id);
  v_today date := (now() at time zone v_tz)::date;
begin
  if not owns_business(p_business_id) then perform kz_raise('FORBIDDEN'); end if;
  return jsonb_build_object(
    'revenue_today', (select coalesce(sum(total), 0) from appointments where business_id = p_business_id
        and (starts_at at time zone v_tz)::date = v_today and status in ('confirmed', 'checked_in', 'completed')),
    'appointments_today', (select count(*) from appointments where business_id = p_business_id
        and (starts_at at time zone v_tz)::date = v_today and status not in ('cancelled', 'pending_payment')),
    'new_clients_30d', (select count(*) from clients where business_id = p_business_id and created_at >= now() - interval '30 days'),
    'no_show_rate_30d', (select coalesce(round(100.0 * count(*) filter (where status = 'no_show') /
        nullif(count(*) filter (where status in ('completed', 'no_show')), 0), 1), 0)
        from appointments where business_id = p_business_id and starts_at between now() - interval '30 days' and now()),
    'revenue_7d', (select jsonb_agg(jsonb_build_object('date', d::date, 'amount', coalesce((
        select sum(total) from appointments where business_id = p_business_id
          and (starts_at at time zone v_tz)::date = d::date and status in ('confirmed', 'checked_in', 'completed')), 0)) order by d)
        from generate_series(v_today - 6, v_today, interval '1 day') d)
  );
end $$;

create or replace function public.admin_stats() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then perform kz_raise('FORBIDDEN'); end if;
  return jsonb_build_object(
    'bookings', (select count(*) from appointments where status <> 'pending_payment'),
    'gmv', (select coalesce(sum(total), 0) from appointments where status in ('confirmed', 'checked_in', 'completed')),
    'active_salons', (select count(*) from businesses where status = 'active'),
    'users', (select count(*) from profiles));
end $$;

create or replace view public.client_stats with (security_invoker = true) as
  select c.*,
    count(a.id) filter (where a.status = 'completed') as visits,
    coalesce(sum(a.total) filter (where a.status = 'completed'), 0) as spent,
    max(a.starts_at) filter (where a.status = 'completed') as last_visit
  from clients c left join appointments a on a.client_id = c.id
  group by c.id;

-- ---------------------------------------------------------------- onboarding
create or replace function public.slugify(p text) returns text
language sql immutable as $$
  select trim(both '-' from regexp_replace(lower(translate(p,
    'àâäáãåçéèêëíìîïñóòôöõúùûüýÿÀÂÄÁÃÅÇÉÈÊËÍÌÎÏÑÓÒÔÖÕÚÙÛÜÝ’''',
    'aaaaaaceeeeiiiinooooouuuuyyAAAAAACEEEEIIIINOOOOOUUUUY  ')), '[^a-z0-9]+', '-', 'g'));
$$;
