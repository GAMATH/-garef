-- Booking engine tests (run by supabase/tests/run.sh). Each assertion raises on failure.
create or replace function pg_temp.assert(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'ASSERTION FAILED: %', msg; end if; end $$;

-- Seed sanity ------------------------------------------------------------------
select pg_temp.assert((select count(*) from businesses) = 10, '10 salons');
select pg_temp.assert((select count(distinct city_id) from businesses) = 8, '8 cities');
select pg_temp.assert((select count(*) from staff) = 30, '30 staff');
select pg_temp.assert((select count(*) from services) = 50, '50 services');
select pg_temp.assert((select count(*) from clients) = 100, '100 clients');
select pg_temp.assert((select count(*) from appointments) = 200, '200 appointments');
select pg_temp.assert((select count(*) from reviews) > 20, 'reviews seeded');
select pg_temp.assert((select bool_and(rating_count > 0) from businesses), 'ratings refreshed by trigger');
select pg_temp.assert((select count(*) from profiles where role = 'admin') = 1, 'admin profile');

-- Fixture: a salon open Mondays 09:00–12:00 in Brazzaville (UTC+1), 2 pros, one 60-min service.
insert into businesses (id, slug, name, city_id, lat, lng, deposit_type, deposit_value, payment_options, payment_methods)
values ('11111111-0000-4000-8000-000000000001', 'test-salon', 'Test Salon', '0c000000-0000-4000-8000-000000000001', -4.26, 15.24,
        'percent', 20, '{on_site,deposit,full}', '{mobile_money,card,cash}');
insert into staff (id, business_id, name, sort) values
  ('11111111-0000-4000-8000-0000000000a1', '11111111-0000-4000-8000-000000000001', 'A', 0),
  ('11111111-0000-4000-8000-0000000000b2', '11111111-0000-4000-8000-000000000001', 'B', 1);
insert into services (id, business_id, category_id, name, duration_min, price) values
  ('11111111-0000-4000-8000-0000000000c1', '11111111-0000-4000-8000-000000000001', '0ca70000-0000-4000-8000-000000000001', 'Coupe', 60, 5000);
insert into staff_services values
  ('11111111-0000-4000-8000-0000000000a1', '11111111-0000-4000-8000-0000000000c1'),
  ('11111111-0000-4000-8000-0000000000b2', '11111111-0000-4000-8000-0000000000c1');
insert into business_hours values ('11111111-0000-4000-8000-000000000001', 1, '09:00', '12:00', null, null);

-- 2030-01-07 is a Monday.
create temp view t_slots as
  select * from get_available_slots('11111111-0000-4000-8000-000000000001', array['11111111-0000-4000-8000-0000000000c1']::uuid[], null, '2030-01-07');

select pg_temp.assert((select count(*) from t_slots) = 9, '9 slots on a 15-min grid between 09:00 and 11:00');
select pg_temp.assert((select min(slot_start) from t_slots) = '2030-01-07 08:00+00', 'first slot 09:00 local = 08:00 UTC');
select pg_temp.assert((select staff_ids from t_slots order by slot_start limit 1) = array['11111111-0000-4000-8000-0000000000a1','11111111-0000-4000-8000-0000000000b2']::uuid[], 'both pros free, priority order');
select pg_temp.assert(not exists (select 1 from get_available_slots('11111111-0000-4000-8000-000000000001', array['11111111-0000-4000-8000-0000000000c1']::uuid[], null, '2030-01-08')), 'closed Tuesday');
select pg_temp.assert((select count(*) from get_available_days('11111111-0000-4000-8000-000000000001', array['11111111-0000-4000-8000-0000000000c1']::uuid[], null, '2030-01-06', 3) where available) = 1, 'days strip: only Monday available');

-- Holds & anti double-booking ---------------------------------------------------
select pg_temp.assert((select status from create_booking_hold('11111111-0000-4000-8000-000000000001', array['11111111-0000-4000-8000-0000000000c1']::uuid[],
  '11111111-0000-4000-8000-0000000000a1', '2030-01-07 08:00+00', 'Awa', '', '+242060000001')) = 'pending_payment', 'hold created');
select pg_temp.assert((select deposit from appointments where client_id = (select id from clients where phone = '+242060000001')) = 1000, '20 % deposit');

do $$ begin
  perform create_booking_hold('11111111-0000-4000-8000-000000000001', array['11111111-0000-4000-8000-0000000000c1']::uuid[],
    '11111111-0000-4000-8000-0000000000a1', '2030-01-07 08:30+00', 'Ben', '', '+242060000002');
  raise exception 'ASSERTION FAILED: overlapping hold for same pro must fail';
exception when others then
  if sqlerrm <> 'SLOT_TAKEN' then raise; end if;
end $$;

-- "Peu importe" lands on B.
select pg_temp.assert((select staff_id from create_booking_hold('11111111-0000-4000-8000-000000000001', array['11111111-0000-4000-8000-0000000000c1']::uuid[],
  null, '2030-01-07 08:00+00', 'Chloé', '', '+242060000003')) = '11111111-0000-4000-8000-0000000000b2', 'any → first free pro');
select pg_temp.assert(not exists (select 1 from t_slots where slot_start = '2030-01-07 08:00+00'), 'slot gone once both pros held');

-- Exclusion constraint is the final guarantee, even bypassing the RPC.
do $$ begin
  insert into appointments (reference, business_id, staff_id, client_id, starts_at, ends_at, status, total)
  select 'KZ-TEST1', '11111111-0000-4000-8000-000000000001', '11111111-0000-4000-8000-0000000000a1', id,
         '2030-01-07 08:15+00', '2030-01-07 08:45+00', 'confirmed', 0 from clients where phone = '+242060000001';
  raise exception 'ASSERTION FAILED: exclusion constraint did not fire';
exception when exclusion_violation then null;
end $$;

-- Expired hold frees the slot.
update appointments set hold_expires_at = now() - interval '1 second' where client_id = (select id from clients where phone = '+242060000001');
select pg_temp.assert(release_expired_holds() = 1, 'one hold released');
select pg_temp.assert(exists (select 1 from t_slots where slot_start = '2030-01-07 08:00+00' and staff_ids = array['11111111-0000-4000-8000-0000000000a1']::uuid[]), 'released slot is bookable again');

-- Payments ------------------------------------------------------------------------
-- Pay on site → confirmed immediately + notifications.
select pg_temp.assert((start_payment(id, 'on_site', 'cash') ->> 'status') = 'succeeded', 'on-site confirms')
  from appointments where client_id = (select id from clients where phone = '+242060000003');
select pg_temp.assert((select status from appointments where client_id = (select id from clients where phone = '+242060000003')) = 'confirmed', 'confirmed');
select pg_temp.assert((select count(*) from notifications where appointment_id = (select id from appointments where client_id = (select id from clients where phone = '+242060000003'))) = 2, 'client + salon notified');

-- Mobile money declined (number ending 0000) → slot released.
create temp table t_hold as select * from create_booking_hold('11111111-0000-4000-8000-000000000001', array['11111111-0000-4000-8000-0000000000c1']::uuid[],
  '11111111-0000-4000-8000-0000000000a1', '2030-01-07 09:00+00', 'Dédé', '', '+242060000004');
create temp table t_pay as select (start_payment(id, 'deposit', 'mobile_money', 'mtn_momo', '+242060000000') ->> 'payment_id')::uuid as pid from t_hold;
select pg_temp.assert((verify_payment(pid) ->> 'status') = 'pending', 'pending before provider answers') from t_pay;
update payments set resolves_at = now() where id = (select pid from t_pay);
select pg_temp.assert((verify_payment(pid) ->> 'status') = 'failed', 'declined') from t_pay;
select pg_temp.assert((select status from appointments where id = (select id from t_hold)) = 'cancelled', 'failed payment cancels hold');
select pg_temp.assert(exists (select 1 from t_slots where slot_start = '2030-01-07 09:00+00' and '11111111-0000-4000-8000-0000000000a1' = any(staff_ids)), 'failed payment frees slot');

-- Mobile money accepted → deposit_paid.
create temp table t_hold2 as select * from create_booking_hold('11111111-0000-4000-8000-000000000001', array['11111111-0000-4000-8000-0000000000c1']::uuid[],
  '11111111-0000-4000-8000-0000000000a1', '2030-01-07 09:00+00', 'Eli', '', '+242060000005');
create temp table t_pay2 as select (start_payment(id, 'deposit', 'mobile_money', 'mtn_momo', '+242061111111') ->> 'payment_id')::uuid as pid from t_hold2;
update payments set resolves_at = now() where id = (select pid from t_pay2);
select pg_temp.assert((verify_payment(pid) ->> 'status') = 'succeeded', 'accepted') from t_pay2;
select pg_temp.assert((select payment_status from appointments where id = (select id from t_hold2)) = 'deposit_paid', 'deposit paid');
select pg_temp.assert((select amount_paid from appointments where id = (select id from t_hold2)) = 1000, 'amount paid = deposit');

-- Expired hold cannot be paid.
create temp table t_hold3 as select * from create_booking_hold('11111111-0000-4000-8000-000000000001', array['11111111-0000-4000-8000-0000000000c1']::uuid[],
  null, '2030-01-07 10:00+00', 'Fanny', '', '+242060000006');
update appointments set hold_expires_at = now() - interval '1 second' where id = (select id from t_hold3);
do $$ begin
  perform start_payment((select id from t_hold3), 'full', 'card');
  raise exception 'ASSERTION FAILED: expired hold accepted a payment';
exception when others then if sqlerrm <> 'HOLD_EXPIRED' then raise; end if;
end $$;
select pg_temp.assert(exists (select 1 from t_slots where slot_start = '2030-01-07 10:00+00'), 'expired hold no longer blocks the slot');
select pg_temp.assert(release_expired_holds() >= 1, 'cron job releases it');
select pg_temp.assert((select status from appointments where id = (select id from t_hold3)) = 'cancelled', 'expired hold cancelled');

-- Hours change → slots change immediately.
update business_hours set opens = '10:00' where business_id = '11111111-0000-4000-8000-000000000001';
select pg_temp.assert((select min(slot_start) from t_slots) = '2030-01-07 09:00+00', 'opening moved to 10:00 local');

-- Break, staff hours, closures.
update business_hours set opens = '09:00', closes = '14:00', break_start = '12:00', break_end = '13:00' where business_id = '11111111-0000-4000-8000-000000000001';
select pg_temp.assert(not exists (select 1 from t_slots where slot_start in ('2030-01-07 10:15+00', '2030-01-07 11:00+00')), 'no slot across the break');
select pg_temp.assert(exists (select 1 from t_slots where slot_start = '2030-01-07 12:00+00'), 'slot right after break');
insert into time_off (business_id, staff_id, starts_at, ends_at) values ('11111111-0000-4000-8000-000000000001', null, '2030-01-07 00:00+00', '2030-01-08 00:00+00');
select pg_temp.assert(not exists (select 1 from t_slots), 'exceptional closure removes every slot');

-- Search ------------------------------------------------------------------------
select pg_temp.assert((search_businesses() ->> 'total')::int = 11, 'search: all active salons');
select pg_temp.assert(jsonb_array_length(search_businesses() -> 'items') = 11, 'page size');
select pg_temp.assert(jsonb_array_length(search_businesses(p_limit => 4) -> 'items') = 4, 'limit');
select pg_temp.assert((search_businesses(p_category_slug => 'locks') ->> 'total')::int between 1 and 5, 'category filter');
select pg_temp.assert((search_businesses(p_q => 'barb') ->> 'total')::int >= 2, 'prefix full-text search');
select pg_temp.assert((search_businesses(p_city_id => '0c000000-0000-4000-8000-000000000006') ->> 'total')::int = 2, 'city filter: Abidjan');
select pg_temp.assert((search_businesses(p_country_code => 'CM') ->> 'total')::int = 2, 'country filter: Cameroun');

-- RLS ------------------------------------------------------------------------
set role anon;
do $$ begin
  perform upsert_client('b0000000-0000-4000-8000-000000000001', 'X', '', '+242069999999', '', null);
  raise exception 'ASSERTION FAILED: anon called an internal helper';
exception when insufficient_privilege then null;
end $$;
select pg_temp.assert((select count(*) from appointments) = 0, 'anon cannot list appointments');
select pg_temp.assert((select count(*) from clients) = 0, 'anon cannot list clients');
select pg_temp.assert((select count(*) from businesses) = 11, 'anon reads salons');
reset role;
set role authenticated;
set request.jwt.claim.sub = 'a0000000-0000-4000-8000-000000000002';
select pg_temp.assert((select count(distinct business_id) from appointments) = 1, 'owner sees only own salon');
select pg_temp.assert((business_dashboard('b0000000-0000-4000-8000-000000000001') ->> 'appointments_today') is not null, 'owner dashboard');
do $$ begin
  perform business_dashboard('b0000000-0000-4000-8000-000000000002');
  raise exception 'ASSERTION FAILED: dashboard of another salon';
exception when others then if sqlerrm <> 'FORBIDDEN' then raise; end if;
end $$;
set request.jwt.claim.sub = 'a0000000-0000-4000-8000-000000000001';
select pg_temp.assert((select bool_and(profile_id = 'a0000000-0000-4000-8000-000000000001') from appointments), 'client sees only own appointments');
select pg_temp.assert((select count(*) from appointments) > 0, 'demo client has appointments');
reset role;
