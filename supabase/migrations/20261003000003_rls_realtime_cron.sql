-- Kuzuri · 0003 · Row Level Security, Realtime, scheduled jobs

-- ---------------------------------------------------------------- RLS on every table
do $$
declare t text;
begin
  foreach t in array array[
    'countries','cities','categories','profiles','businesses','business_photos','staff','services','staff_services',
    'business_hours','staff_hours','time_off','clients','client_notes','appointments','appointment_services','payments',
    'reviews','favorites','notifications','platform_settings','rate_limits','subscriptions','promotions',
    'loyalty_accounts','loyalty_transactions','waitlists','products','inventory','gift_cards']
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Reference data: public read, admin write.
create policy countries_read on public.countries for select using (true);
create policy countries_admin on public.countries for all using (is_admin()) with check (is_admin());
create policy cities_read on public.cities for select using (true);
create policy cities_admin on public.cities for all using (is_admin()) with check (is_admin());
create policy categories_read on public.categories for select using (true);
create policy categories_admin on public.categories for all using (is_admin()) with check (is_admin());

-- Profiles: self + admin. Role can only be changed by an admin.
create policy profiles_self_read on public.profiles for select using (id = auth.uid() or is_admin());
create policy profiles_self_update on public.profiles for update using (id = auth.uid() or is_admin())
  with check (id = auth.uid() or is_admin());
create or replace function public.protect_profile_role() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.role is distinct from old.role and not is_admin() and current_setting('kuzuri.allow_role_change', true) is distinct from 'on' then
    new.role := old.role;
  end if;
  return new;
end $$;
create trigger profiles_protect_role before update on public.profiles for each row execute function public.protect_profile_role();

-- Businesses: public read of active salons; owners manage theirs; admins everything.
create policy businesses_read on public.businesses for select using (status = 'active' or owner_id = auth.uid() or is_admin());
create policy businesses_insert on public.businesses for insert with check (owner_id = auth.uid());
create policy businesses_update on public.businesses for update using (owns_business(id)) with check (owns_business(id));
create policy businesses_admin_delete on public.businesses for delete using (is_admin());

-- Owners creating a salon become business_owner.
create or replace function public.promote_owner() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform set_config('kuzuri.allow_role_change', 'on', true);
  update profiles set role = 'business_owner' where id = new.owner_id and role = 'client';
  perform set_config('kuzuri.allow_role_change', 'off', true);
  return new;
end $$;
create trigger businesses_promote_owner after insert on public.businesses for each row execute function public.promote_owner();

-- Owners cannot self-activate a suspended salon.
create or replace function public.protect_business_status() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status and not is_admin() then new.status := old.status; end if;
  if new.is_demo is distinct from old.is_demo and not is_admin() then new.is_demo := old.is_demo; end if;
  if (new.rating_avg, new.rating_count) is distinct from (old.rating_avg, old.rating_count) and current_user not in ('postgres', 'supabase_admin') and not is_admin() then
    -- ratings are maintained by trigger only (which runs as definer/postgres)
    new.rating_avg := old.rating_avg; new.rating_count := old.rating_count;
  end if;
  return new;
end $$;
create trigger businesses_protect_status before update on public.businesses for each row execute function public.protect_business_status();

-- Salon catalogue tables: public read, owner write.
create policy business_photos_read on public.business_photos for select using (true);
create policy business_photos_write on public.business_photos for all using (owns_business(business_id)) with check (owns_business(business_id));
create policy staff_read on public.staff for select using (true);
create policy staff_write on public.staff for all using (owns_business(business_id)) with check (owns_business(business_id));
create policy services_read on public.services for select using (true);
create policy services_write on public.services for all using (owns_business(business_id)) with check (owns_business(business_id));
create policy staff_services_read on public.staff_services for select using (true);
create policy staff_services_write on public.staff_services for all
  using (owns_business((select business_id from public.staff where id = staff_id)))
  with check (owns_business((select business_id from public.staff where id = staff_id)));
create policy business_hours_read on public.business_hours for select using (true);
create policy business_hours_write on public.business_hours for all using (owns_business(business_id)) with check (owns_business(business_id));
create policy staff_hours_read on public.staff_hours for select using (true);
create policy staff_hours_write on public.staff_hours for all
  using (owns_business((select business_id from public.staff where id = staff_id)))
  with check (owns_business((select business_id from public.staff where id = staff_id)));
create policy time_off_owner on public.time_off for all using (owns_business(business_id)) with check (owns_business(business_id));

-- Clients & notes: salon only (a client sees their own client rows).
create policy clients_owner on public.clients for all using (owns_business(business_id)) with check (owns_business(business_id));
create policy clients_self on public.clients for select using (profile_id = auth.uid());
create policy client_notes_owner on public.client_notes for all
  using (owns_business((select business_id from public.clients where id = client_id)))
  with check (owns_business((select business_id from public.clients where id = client_id)));

-- Appointments: the client sees theirs, the salon sees its own. Writes go through RPCs
-- (security definer) so holds, conflicts and payment rules can't be bypassed.
create policy appointments_client on public.appointments for select using (profile_id = auth.uid());
create policy appointments_owner on public.appointments for select using (owns_business(business_id));
create policy appointment_services_read on public.appointment_services for select using (
  exists (select 1 from public.appointments a where a.id = appointment_id and (a.profile_id = auth.uid() or owns_business(a.business_id))));
create policy payments_read on public.payments for select using (
  owns_business(business_id) or exists (select 1 from public.appointments a where a.id = appointment_id and a.profile_id = auth.uid()));

-- Reviews: public read; written via create_review(); owners reply.
create policy reviews_read on public.reviews for select using (true);
create policy reviews_reply on public.reviews for update using (owns_business(business_id)) with check (owns_business(business_id));

create policy favorites_self on public.favorites for all using (profile_id = auth.uid()) with check (profile_id = auth.uid());

create policy notifications_read on public.notifications for select using (is_admin() or (business_id is not null and owns_business(business_id)));
create policy platform_settings_read on public.platform_settings for select using (true);
create policy platform_settings_admin on public.platform_settings for all using (is_admin()) with check (is_admin());
-- rate_limits: no policy → only security-definer functions touch it.

-- Roadmap tables: owner read/write, no UI yet.
create policy subscriptions_owner on public.subscriptions for select using (owns_business(business_id));
create policy promotions_owner on public.promotions for all using (owns_business(business_id)) with check (owns_business(business_id));
create policy loyalty_owner on public.loyalty_accounts for all using (owns_business(business_id)) with check (owns_business(business_id));
create policy loyalty_tx_owner on public.loyalty_transactions for select using (
  owns_business((select business_id from public.loyalty_accounts where id = account_id)));
create policy waitlists_owner on public.waitlists for all using (owns_business(business_id)) with check (owns_business(business_id));
create policy products_owner on public.products for all using (owns_business(business_id)) with check (owns_business(business_id));
create policy inventory_owner on public.inventory for all using (
  owns_business((select business_id from public.products where id = product_id)));
create policy gift_cards_owner on public.gift_cards for all using (owns_business(business_id)) with check (owns_business(business_id));

-- ---------------------------------------------------------------- grants for RPCs
grant execute on function public.get_available_slots(uuid, uuid[], uuid, date, uuid, timestamptz) to anon, authenticated;
grant execute on function public.get_available_days(uuid, uuid[], uuid, date, int, uuid) to anon, authenticated;
grant execute on function public.create_booking_hold(uuid, uuid[], uuid, timestamptz, text, text, text, text) to anon, authenticated;
grant execute on function public.release_hold(uuid) to anon, authenticated;
grant execute on function public.start_payment(uuid, public.payment_option, public.payment_method, text, text) to anon, authenticated;
grant execute on function public.verify_payment(uuid) to anon, authenticated;
grant execute on function public.search_businesses(text, uuid, text, double precision, double precision, boolean, int, numeric, boolean, boolean, public.audience, text, int, int) to anon, authenticated;
grant execute on function public.get_booking(text) to anon, authenticated;
-- Internal security-definer helpers are never callable from the API.
revoke execute on function public.send_reminders() from public, anon, authenticated;
revoke execute on function public.release_expired_holds() from public, anon, authenticated;
revoke execute on function public.upsert_client(uuid, text, text, text, text, uuid) from public, anon, authenticated;
revoke execute on function public.notify_appointment(uuid, text) from public, anon, authenticated;
revoke execute on function public.check_rate_limit(text, int, interval) from public, anon, authenticated;

-- ---------------------------------------------------------------- Realtime (agenda < 2 s)
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.appointments;
  end if;
end $$;
alter table public.appointments replica identity full;

-- ---------------------------------------------------------------- pg_cron jobs
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('kuzuri-release-holds', '* * * * *', 'select public.release_expired_holds()');
    perform cron.schedule('kuzuri-reminders', '*/15 * * * *', 'select public.send_reminders()');
  end if;
end $$;
