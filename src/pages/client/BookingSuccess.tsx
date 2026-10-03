import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { CalendarPlus, MessageCircle, Navigation, UserPlus } from 'lucide-react';
import { useApp } from '@/app/AppContext';
import { Pattern, Logo } from '@/components/ui/Art';
import { QrCode } from '@/components/ui/QrCode';
import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/ui/EmptyState';
import { ButtonLink, buttonClass } from '@/components/ui/Button';
import { PaymentBadge, StatusBadge } from '@/components/ui/Badge';
import { useFormat } from '@/hooks/useFormat';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { buildIcs, downloadFile } from '@/lib/ics';
import { whatsappLink } from '@/lib/phone';
import { todayIn, zonedParts, addDays } from '@/lib/time';

export default function BookingSuccess() {
  const { reference = '' } = useParams();
  const { t } = useTranslation();
  const fmt = useFormat();
  const { api, profile } = useApp();
  const q = useQuery({ queryKey: ['booking', reference], queryFn: () => api.getBooking(reference) });
  useDocumentTitle(t('success.metaTitle'));

  if (q.isPending)
    return (
      <div className="container-app max-w-md space-y-4 py-10" aria-busy="true">
        <Skeleton className="mx-auto h-20 w-20 rounded-full" />
        <Skeleton className="mx-auto h-8 w-2/3" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  if (q.isError) return <ErrorState onRetry={() => q.refetch()} />;

  const a = q.data;
  const tz = a.city.timezone;
  const day = zonedParts(a.startsAt, tz).date;
  const today = todayIn(tz);
  const when = day === today ? t('success.today') : day === addDays(today, 1) ? t('success.tomorrow') : fmt.weekday(a.startsAt, tz);
  const time = fmt.time(a.startsAt, tz);
  const url = `${window.location.origin}/booking/success/${a.reference}`;
  const address = `${a.business.address}, ${a.business.district}, ${a.city.name}`;
  const shareText = t('success.shareText', { salon: a.business.name, date: fmt.longDate(a.startsAt, tz), time, reference: a.reference, address });
  const confirmed = a.status === 'confirmed' || a.status === 'checked_in' || a.status === 'completed';

  return (
    <div className="relative min-h-dvh overflow-hidden">
      <Pattern className="absolute inset-x-0 top-0 h-72" opacity={0.08} />
      <div className="absolute inset-x-0 top-0 h-72 bg-gradient-to-b from-transparent to-ivory" aria-hidden />
      <div className="container-app relative max-w-md pb-12 pt-6">
        <Link to="/" aria-label={t('nav.home')}>
          <Logo />
        </Link>

        <div className="mt-8 flex flex-col items-center text-center">
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-forest animate-pop">
            <svg viewBox="0 0 24 24" className="h-10 w-10" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M5 12.5l4.5 4.5L19 7.5" strokeDasharray="48" className="animate-draw" />
            </svg>
          </div>
          <h1 className="mt-6 text-2xl">{confirmed ? t('success.title') : t(`status.${a.status}`)}</h1>
          <p className="mt-2 text-lg">{t('success.subtitle', { when, time, salon: a.business.name })}</p>
        </div>

        <section className="card mt-8 p-5" aria-label={t('booking.summary')}>
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm text-stone">{t('success.reference')}</p>
              <p className="whitespace-nowrap font-display text-xl font-semibold tracking-wide sm:text-2xl">{a.reference}</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <StatusBadge status={a.status} />
                <PaymentBadge status={a.paymentStatus} />
              </div>
            </div>
            <QrCode value={url} size={96} label={t('success.qr', { reference: a.reference })} />
          </div>
          <dl className="mt-5 space-y-2 border-t border-sand pt-4 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-stone">{t('success.when')}</dt>
              <dd className="text-right font-medium first-letter:uppercase">{fmt.longDate(a.startsAt, tz)} · {time}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-stone">{t('success.services')}</dt>
              <dd className="text-right font-medium">{a.services.map((s) => s.name).join(', ')}</dd>
            </div>
            {a.staff && (
              <div className="flex justify-between gap-4">
                <dt className="text-stone">{t('success.with')}</dt>
                <dd className="font-medium">{a.staff.name}</dd>
              </div>
            )}
            <div className="flex justify-between gap-4">
              <dt className="text-stone">{t('success.where')}</dt>
              <dd className="text-right font-medium">{address}</dd>
            </div>
            <div className="flex justify-between gap-4 border-t border-sand pt-2">
              <dt className="text-stone">{t('booking.total')}</dt>
              <dd className="font-bold">{fmt.money(a.total)}</dd>
            </div>
            {a.amountPaid > 0 && (
              <div className="flex justify-between gap-4">
                <dt className="text-stone">{t('success.paid')}</dt>
                <dd className="font-medium text-forest">{fmt.money(a.amountPaid)}</dd>
              </div>
            )}
            <div className="flex justify-between gap-4">
              <dt className="text-stone">{t('booking.balanceOnSite')}</dt>
              <dd className="font-medium">{fmt.money(a.total - a.amountPaid)}</dd>
            </div>
          </dl>
        </section>

        <div className="mt-6 grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={() => downloadFile(`kuzuri-${a.reference}.ics`, buildIcs({ uid: a.id, start: a.startsAt, end: a.endsAt, title: `${a.services.map((s) => s.name).join(', ')} · ${a.business.name}`, location: address, description: `${t('success.reference')} ${a.reference}` }), 'text/calendar')}
            className="flex min-h-[72px] flex-col items-center justify-center gap-1 rounded-card border border-sand bg-surface text-xs font-medium active:scale-[0.97]"
          >
            <CalendarPlus className="h-5 w-5" strokeWidth={1.75} aria-hidden />
            {t('success.addToCalendar')}
          </button>
          <a href={`https://wa.me/?text=${encodeURIComponent(`${shareText}\n${url}`)}`} target="_blank" rel="noreferrer" className="flex min-h-[72px] flex-col items-center justify-center gap-1 rounded-card border border-sand bg-surface text-xs font-medium active:scale-[0.97]">
            <MessageCircle className="h-5 w-5" strokeWidth={1.75} aria-hidden />
            {t('success.shareWhatsapp')}
          </a>
          <a href={`https://www.google.com/maps/dir/?api=1&destination=${a.business.lat},${a.business.lng}`} target="_blank" rel="noreferrer" className="flex min-h-[72px] flex-col items-center justify-center gap-1 rounded-card border border-sand bg-surface text-xs font-medium active:scale-[0.97]">
            <Navigation className="h-5 w-5" strokeWidth={1.75} aria-hidden />
            {t('salon.directions')}
          </a>
        </div>

        <a href={whatsappLink(a.business.whatsapp, t('success.salonMessage', { reference: a.reference }))} target="_blank" rel="noreferrer" className="mt-3 block text-center text-sm font-bold text-stone underline-offset-4 hover:underline">
          {t('success.contactSalon')}
        </a>

        {!profile && (
          <div className="mt-8 rounded-card border border-sand bg-sand-light p-5">
            <div className="flex gap-3">
              <UserPlus className="h-5 w-5 shrink-0 text-terracotta" strokeWidth={1.75} aria-hidden />
              <div>
                <p className="font-bold">{t('success.createAccount')}</p>
                <p className="mt-1 text-sm text-stone">{t('success.createAccountBody')}</p>
                <Link to={`/login?phone=${encodeURIComponent(a.client.phone)}&name=${encodeURIComponent(a.client.firstName)}&next=/account/appointments`} className={buttonClass('secondary', 'sm', false, 'mt-3')}>
                  {t('success.createAccountCta')}
                </Link>
              </div>
            </div>
          </div>
        )}

        <ButtonLink to="/" variant="ghost" block className="mt-6">
          {t('success.backHome')}
        </ButtonLink>
      </div>
    </div>
  );
}
