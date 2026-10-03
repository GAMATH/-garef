import { useState } from 'react';
import { Navigate, NavLink, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { CalendarDays, Heart, LogOut, MessageCircle, RotateCcw, Star, Store } from 'lucide-react';
import clsx from 'clsx';
import { useApp } from '@/app/AppContext';
import { ApiError } from '@/data/api';
import type { AppointmentView, Locale } from '@/lib/types';
import { Button, ButtonLink } from '@/components/ui/Button';
import { StatusBadge } from '@/components/ui/Badge';
import { ListSkeleton, SalonCardSkeleton } from '@/components/ui/Skeleton';
import { EmptyState, ErrorState } from '@/components/ui/EmptyState';
import { SalonCard } from '@/components/salon/SalonCard';
import { ReviewSheet } from '@/components/booking/ReviewSheet';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { SelectField, TextField } from '@/components/ui/Field';
import { SalonArt } from '@/components/ui/Art';
import { useToast } from '@/components/ui/Toast';
import { useFormat } from '@/hooks/useFormat';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { formatE164, whatsappLink } from '@/lib/phone';
import { setLocale } from '@/i18n';

const TABS = ['appointments', 'favorites', 'profile'] as const;

export default function Account() {
  const { tab = 'appointments' } = useParams();
  const { t } = useTranslation();
  const { profile } = useApp();
  useDocumentTitle(t(`account.tabs.${tab as (typeof TABS)[number]}`));
  if (!profile) return <Navigate to={`/login?next=/account/${tab}`} replace />;
  if (!TABS.includes(tab as never)) return <Navigate to="/account/appointments" replace />;

  return (
    <div className="container-app max-w-2xl py-6">
      <h1 className="text-2xl">{t('account.hello', { name: profile.firstName || '' })}</h1>
      <nav className="mt-4 hidden gap-2 md:flex" aria-label={t('account.nav')}>
        {TABS.map((k) => (
          <NavLink key={k} to={`/account/${k}`} className={({ isActive }) => clsx('min-h-tap rounded-full border px-4 py-2.5 text-sm font-bold', isActive ? 'border-ink bg-ink text-ivory' : 'border-sand')}>
            {t(`account.tabs.${k}`)}
          </NavLink>
        ))}
      </nav>
      <div className="mt-6">
        {tab === 'appointments' && <Appointments />}
        {tab === 'favorites' && <Favorites />}
        {tab === 'profile' && <ProfileTab />}
      </div>
    </div>
  );
}

function Appointments() {
  const { t } = useTranslation();
  const { api, profile } = useApp();
  const q = useQuery({ queryKey: ['me', 'appointments', profile!.id], queryFn: () => api.listMyAppointments(profile!.id) });
  const [review, setReview] = useState<AppointmentView | null>(null);
  const [cancel, setCancel] = useState<AppointmentView | null>(null);
  if (q.isPending) return <ListSkeleton rows={3} />;
  if (q.isError) return <ErrorState onRetry={() => q.refetch()} />;
  const now = Date.now();
  const upcoming = q.data.filter((a) => ['confirmed', 'checked_in', 'pending_payment'].includes(a.status) && Date.parse(a.endsAt) > now);
  const past = q.data.filter((a) => !upcoming.includes(a)).reverse();
  if (!q.data.length)
    return <EmptyState icon={<CalendarDays strokeWidth={1.75} />} title={t('account.noAppointments')} body={t('account.noAppointmentsBody')} action={<ButtonLink to="/search">{t('account.findSalon')}</ButtonLink>} />;
  return (
    <>
      <section aria-labelledby="upcoming">
        <h2 id="upcoming" className="text-lg">{t('account.upcoming')}</h2>
        {upcoming.length === 0 ? (
          <p className="mt-2 text-stone">{t('account.noUpcoming')}</p>
        ) : (
          <ul className="mt-3 space-y-3">{upcoming.map((a) => <AppointmentCard key={a.id} a={a} onCancel={() => setCancel(a)} />)}</ul>
        )}
      </section>
      {past.length > 0 && (
        <section className="mt-8" aria-labelledby="past">
          <h2 id="past" className="text-lg">{t('account.past')}</h2>
          <ul className="mt-3 space-y-3">{past.map((a) => <AppointmentCard key={a.id} a={a} past onReview={() => setReview(a)} />)}</ul>
        </section>
      )}
      <ReviewSheet appointment={review} onClose={() => setReview(null)} />
      <CancelSheet appointment={cancel} onClose={() => setCancel(null)} />
    </>
  );
}

function AppointmentCard({ a, past, onCancel, onReview }: { a: AppointmentView; past?: boolean; onCancel?: () => void; onReview?: () => void }) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const navigate = useNavigate();
  const tz = a.city.timezone;
  const canChange = Date.parse(a.startsAt) - Date.now() >= a.business.cancellationHours * 3600000;
  return (
    <li className="card overflow-hidden">
      <div className="flex gap-4 p-4">
        <div className="h-16 w-16 shrink-0 overflow-hidden rounded-card">
          <SalonArt seed={a.business.photoSeeds[0] ?? 1} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="truncate font-bold">{a.business.name}</p>
            <StatusBadge status={a.status} />
          </div>
          <p className="mt-0.5 text-sm first-letter:uppercase">{fmt.longDate(a.startsAt, tz)} · {fmt.time(a.startsAt, tz)}</p>
          <p className="truncate text-sm text-stone">
            {a.services.map((s) => s.name).join(', ')} · {fmt.money(a.total)}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 border-t border-sand px-4 py-3">
        {!past ? (
          canChange ? (
            <>
              <Button size="sm" variant="secondary" onClick={() => navigate(`/booking/${a.business.slug}?reschedule=${a.id}`)}>{t('account.modify')}</Button>
              <Button size="sm" variant="ghost" className="text-danger" onClick={onCancel}>{t('account.cancel')}</Button>
              <ButtonLink size="sm" variant="ghost" to={`/booking/success/${a.reference}`}>{t('account.details')}</ButtonLink>
            </>
          ) : (
            <>
              <p className="w-full text-sm text-stone">{t('account.tooLateToChange', { hours: a.business.cancellationHours })}</p>
              <a href={whatsappLink(a.business.whatsapp, t('success.salonMessage', { reference: a.reference }))} target="_blank" rel="noreferrer" className="inline-flex min-h-[36px] items-center gap-1.5 rounded-full border border-ink/15 px-4 text-sm font-bold">
                <MessageCircle className="h-4 w-4" strokeWidth={1.75} aria-hidden />
                {t('salon.whatsapp')}
              </a>
              <ButtonLink size="sm" variant="ghost" to={`/booking/success/${a.reference}`}>{t('account.details')}</ButtonLink>
            </>
          )
        ) : (
          <>
            <Button size="sm" variant="secondary" icon={<RotateCcw className="h-4 w-4" strokeWidth={1.75} aria-hidden />} onClick={() => navigate(`/booking/${a.business.slug}?services=${a.services.map((s) => s.serviceId).join(',')}`)}>
              {t('account.bookAgain')}
            </Button>
            {a.status === 'completed' && !a.hasReview && (
              <Button size="sm" variant="ghost" icon={<Star className="h-4 w-4" strokeWidth={1.75} aria-hidden />} onClick={onReview}>{t('account.leaveReview')}</Button>
            )}
          </>
        )}
      </div>
    </li>
  );
}

function CancelSheet({ appointment, onClose }: { appointment: AppointmentView | null; onClose: () => void }) {
  const { t } = useTranslation();
  const { api } = useApp();
  const qc = useQueryClient();
  const toast = useToast();
  const m = useMutation({
    mutationFn: () => api.cancelAppointment(appointment!.id, 'client'),
    onSuccess: () => {
      toast(t('account.cancelled'));
      void qc.invalidateQueries({ queryKey: ['me'] });
      onClose();
    },
    onError: (e) => toast(e instanceof ApiError && e.code === 'CANCELLATION_TOO_LATE' ? t('account.tooLateToChange', { hours: appointment!.business.cancellationHours }) : t('errors.generic'), 'error'),
  });
  return (
    <BottomSheet
      open={!!appointment}
      onClose={onClose}
      title={t('account.cancelTitle')}
      footer={
        <div className="flex gap-2">
          <Button variant="secondary" block onClick={onClose}>{t('account.keep')}</Button>
          <Button variant="danger" block loading={m.isPending} onClick={() => m.mutate()}>{t('account.confirmCancel')}</Button>
        </div>
      }
    >
      <p>{t('account.cancelBody', { salon: appointment?.business.name ?? '' })}</p>
      {appointment && appointment.amountPaid > 0 && <p className="mt-2 text-sm text-stone">{t('account.refundNote')}</p>}
    </BottomSheet>
  );
}

function Favorites() {
  const { t } = useTranslation();
  const { api, profile } = useApp();
  const q = useQuery({ queryKey: ['me', 'favorites', profile!.id], queryFn: () => api.listFavorites(profile!.id) });
  if (q.isPending) return <div className="grid gap-6 sm:grid-cols-2"><SalonCardSkeleton /><SalonCardSkeleton /></div>;
  if (q.isError) return <ErrorState onRetry={() => q.refetch()} />;
  if (!q.data.length) return <EmptyState icon={<Heart strokeWidth={1.75} />} title={t('favorites.emptyTitle')} body={t('favorites.empty')} action={<ButtonLink to="/search" variant="secondary">{t('account.findSalon')}</ButtonLink>} />;
  return <div className="grid gap-x-5 gap-y-8 sm:grid-cols-2">{q.data.map((s) => <SalonCard key={s.business.id} salon={s} />)}</div>;
}

function ProfileTab() {
  const { t, i18n } = useTranslation();
  const { api, profile, setProfile, signOut, ref, setCountryCode } = useApp();
  const navigate = useNavigate();
  const toast = useToast();
  const [form, setForm] = useState({ firstName: profile!.firstName, lastName: profile!.lastName, email: profile!.email, locale: (i18n.language === 'en' ? 'en' : 'fr') as Locale, countryCode: profile!.countryCode });
  const m = useMutation({
    mutationFn: () => api.updateProfile(profile!.id, form),
    onSuccess: (p) => {
      setProfile(p);
      setCountryCode(p.countryCode);
      void setLocale(form.locale);
      toast(t('profile.saved'));
    },
    onError: () => toast(t('errors.generic'), 'error'),
  });
  return (
    <form onSubmit={(e) => { e.preventDefault(); m.mutate(); }} className="space-y-5">
      <TextField label={t('fields.firstName')} value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} autoComplete="given-name" />
      <TextField label={t('fields.lastNameOptional')} value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} autoComplete="family-name" />
      <TextField label={t('fields.phone')} value={profile!.phone ? formatE164(profile!.phone, ref.countries) : '—'} readOnly disabled hint={t('profile.phoneHint')} />
      <TextField label={t('fields.emailOptional')} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} autoComplete="email" />
      <SelectField label={t('profile.language')} value={form.locale} onChange={(e) => setForm({ ...form, locale: e.target.value as Locale })}>
        <option value="fr">{t('languages.fr')}</option>
        <option value="en">{t('languages.en')}</option>
      </SelectField>
      <SelectField label={t('profile.country')} value={form.countryCode} onChange={(e) => setForm({ ...form, countryCode: e.target.value as typeof form.countryCode })}>
        {ref.countries.map((c) => <option key={c.code} value={c.code}>{c.flag} {c.name}</option>)}
      </SelectField>
      <Button type="submit" size="lg" block loading={m.isPending}>{t('common.save')}</Button>
      {(profile!.role === 'business_owner' || profile!.role === 'admin') && (
        <ButtonLink to={profile!.role === 'admin' ? '/admin' : '/business'} variant="secondary" block>
          <Store className="h-4 w-4" strokeWidth={1.75} aria-hidden />
          {profile!.role === 'admin' ? t('nav.admin') : t('nav.proSpace')}
        </ButtonLink>
      )}
      <Button variant="ghost" block icon={<LogOut className="h-4 w-4" strokeWidth={1.75} aria-hidden />} onClick={async () => { await signOut(); navigate('/'); }}>
        {t('profile.signOut')}
      </Button>
    </form>
  );
}
