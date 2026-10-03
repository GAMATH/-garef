import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Heart, MessageCircle, Navigation, Phone, Share2, Zap } from 'lucide-react';
import clsx from 'clsx';
import { useApp } from '@/app/AppContext';
import { ApiError } from '@/data/api';
import { SalonArt } from '@/components/ui/Art';
import { Rating } from '@/components/ui/Rating';
import { Badge, DemoBadge } from '@/components/ui/Badge';
import { ServiceRow } from '@/components/salon/ServiceRow';
import { StaffAvatar } from '@/components/ui/StaffAvatar';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState, ErrorState } from '@/components/ui/EmptyState';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button, IconButton } from '@/components/ui/Button';
import { MapView } from '@/components/map/MapView';
import { useToast } from '@/components/ui/Toast';
import { useFavorites } from '@/hooks/useFavorites';
import { useFormat } from '@/hooks/useFormat';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { whatsappLink } from '@/lib/phone';
import { openStatus } from '@/lib/openStatus';
import type { Review } from '@/lib/types';

export default function Salon() {
  const { slug = '' } = useParams();
  const { t } = useTranslation();
  const fmt = useFormat();
  const { api } = useApp();
  const navigate = useNavigate();
  const toast = useToast();
  const { isFavorite, toggle } = useFavorites();
  const q = useQuery({ queryKey: ['salon', slug], queryFn: () => api.getSalon(slug) });
  const [selected, setSelected] = useState<string[]>([]);
  const [allReviews, setAllReviews] = useState(false);
  const [showMore, setShowMore] = useState(false);
  useDocumentTitle(q.data ? `${q.data.business.name} · ${q.data.business.district}, ${q.data.city.name}` : '', q.data?.business.description);

  if (q.isPending) return <SalonSkeleton />;
  if (q.isError) {
    if (q.error instanceof ApiError && q.error.code === 'NOT_FOUND')
      return <EmptyState title={t('salon.notFound')} action={<Link to="/search" className="font-bold text-terracotta">{t('salon.backToSearch')}</Link>} />;
    return <ErrorState onRetry={() => q.refetch()} />;
  }
  const { business: b, city, services, staff, reviews, categories, hours } = q.data;
  const tz = city.timezone;
  const status = openStatus(hours, tz);
  const chosen = services.filter((s) => selected.includes(s.id));
  const total = chosen.reduce((s, x) => s + x.price, 0);
  const fav = isFavorite(b.id);
  const waMessage = t('salon.waMessage', { salon: b.name });
  const directions = `https://www.google.com/maps/dir/?api=1&destination=${b.lat},${b.lng}`;

  const share = async () => {
    const url = window.location.href;
    try {
      if (navigator.share) await navigator.share({ title: b.name, text: t('salon.shareText', { salon: b.name }), url });
      else {
        await navigator.clipboard.writeText(url);
        toast(t('common.linkCopied'));
      }
    } catch {
      /* user dismissed */
    }
  };

  const book = () => navigate(`/booking/${b.slug}${selected.length ? `?services=${selected.join(',')}` : ''}`);
  const statusText =
    status.kind === 'open'
      ? t('salon.openUntil', { time: status.until.replace(':', 'h') })
      : status.kind === 'break'
        ? t('salon.breakUntil', { time: status.until.replace(':', 'h') })
        : status.opens
          ? status.today
            ? t('salon.closedOpensAt', { time: status.opens.replace(':', 'h') })
            : t('salon.closedOpensOn', { day: t(`weekdays.${status.nextDay}` as never), time: status.opens.replace(':', 'h') })
          : t('salon.closed');

  return (
    <div className="pb-28">
      {/* 1. Gallery */}
      <div className="relative mx-auto max-w-5xl sm:px-6 sm:pt-4">
        <div className="no-scrollbar flex snap-x snap-mandatory overflow-x-auto sm:grid sm:grid-cols-4 sm:grid-rows-2 sm:gap-2 sm:overflow-hidden sm:rounded-lg" aria-label={t('salon.gallery')}>
          {(b.photoUrls.length ? b.photoUrls : b.photoSeeds).slice(0, 5).map((p, i) => (
            <div key={i} className={clsx('aspect-[4/3] w-full shrink-0 snap-center bg-sand sm:aspect-auto', i === 0 ? 'sm:col-span-2 sm:row-span-2' : 'hidden sm:block')}>
              {typeof p === 'string' ? <img src={p} alt="" className="h-full w-full object-cover" loading={i ? 'lazy' : 'eager'} /> : <SalonArt seed={p} label={i === 0 ? t('salon.photoAlt', { salon: b.name }) : undefined} />}
            </div>
          ))}
        </div>
        <div className="absolute inset-x-0 top-0 flex justify-between p-3 sm:px-9 sm:pt-7">
          <IconButton label={t('common.back')} onClick={() => (history.length > 1 ? navigate(-1) : navigate('/search'))} className="bg-surface/95">
            <ArrowLeft className="h-5 w-5" strokeWidth={1.75} />
          </IconButton>
          <IconButton label={fav ? t('favorites.remove', { name: b.name }) : t('favorites.add', { name: b.name })} aria-pressed={fav} onClick={() => toggle(b.id)} className="bg-surface/95">
            <Heart className={clsx('h-5 w-5', fav && 'fill-terracotta stroke-terracotta')} strokeWidth={1.75} />
          </IconButton>
        </div>
      </div>

      <div className="container-app">
        {/* 2. Identity */}
        <div className="pt-5">
          <div className="flex flex-wrap gap-1.5">
            {b.isDemo && <DemoBadge />}
            {b.instantBooking && (
              <Badge tone="neutral"><Zap className="h-3 w-3" strokeWidth={2} aria-hidden />{t('salon.instant')}</Badge>
            )}
          </div>
          <h1 className="mt-2 text-2xl">{b.name}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            <Rating value={b.ratingAvg} count={b.ratingCount} />
            <span className="text-stone">·</span>
            <span className="text-stone">{b.district}, {city.name}</span>
          </div>
          <p className={clsx('mt-1 text-sm font-bold', status.kind === 'open' ? 'text-forest' : 'text-stone')}>{statusText}</p>
        </div>

        {/* 3. Quick actions */}
        <div className="mt-5 grid grid-cols-4 gap-2">
          {[
            { icon: Navigation, label: t('salon.directions'), href: directions },
            { icon: Phone, label: t('salon.call'), href: `tel:${b.phone}` },
            { icon: MessageCircle, label: t('salon.whatsapp'), href: whatsappLink(b.whatsapp, waMessage) },
          ].map(({ icon: Icon, label, href }) => (
            <a key={label} href={href} target={href.startsWith('http') ? '_blank' : undefined} rel="noreferrer" className="flex min-h-[64px] flex-col items-center justify-center gap-1 rounded-card border border-sand bg-surface text-xs font-medium transition-colors duration-150 hover:border-ink/40 active:scale-[0.97]">
              <Icon className="h-5 w-5" strokeWidth={1.75} aria-hidden />
              {label}
            </a>
          ))}
          <button type="button" onClick={share} className="flex min-h-[64px] flex-col items-center justify-center gap-1 rounded-card border border-sand bg-surface text-xs font-medium transition-colors duration-150 hover:border-ink/40 active:scale-[0.97]">
            <Share2 className="h-5 w-5" strokeWidth={1.75} aria-hidden />
            {t('salon.share')}
          </button>
        </div>

        {/* 4. Services */}
        <section className="mt-8" aria-labelledby="services-title">
          <h2 id="services-title" className="text-xl">{t('salon.services')}</h2>
          {services.length === 0 ? (
            <p className="mt-3 text-stone">{t('salon.noServices')}</p>
          ) : (
            categories.map((c) => (
              <div key={c.id} className="mt-4">
                <h3 className="font-sans text-sm font-bold uppercase tracking-wide text-stone">{t(`categories.${c.key}` as never)}</h3>
                <div className="divide-y divide-sand">
                  {services.filter((s) => s.categoryId === c.id).map((s) => (
                    <ServiceRow key={s.id} service={s} selected={selected.includes(s.id)} onToggle={() => setSelected((x) => (x.includes(s.id) ? x.filter((i) => i !== s.id) : [...x, s.id]))} />
                  ))}
                </div>
              </div>
            ))
          )}
        </section>

        {/* 5. Team */}
        {staff.length > 0 && (
          <section className="mt-8" aria-labelledby="team-title">
            <h2 id="team-title" className="text-xl">{t('salon.team')}</h2>
            <ul className="no-scrollbar -mx-4 mt-3 flex gap-4 overflow-x-auto px-4">
              {staff.map((s) => (
                <li key={s.id} className="flex w-20 shrink-0 flex-col items-center text-center">
                  <StaffAvatar name={s.name} color={s.color} size={64} />
                  <span className="mt-2 text-sm font-bold">{s.name}</span>
                  <span className="line-clamp-2 text-xs text-stone">{s.role}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* 6. Reviews */}
        <section className="mt-8" aria-labelledby="reviews-title">
          <div className="flex items-baseline justify-between">
            <h2 id="reviews-title" className="text-xl">{t('salon.reviews')}</h2>
            {reviews.length > 3 && (
              <button type="button" onClick={() => setAllReviews(true)} className="min-h-tap text-sm font-bold text-terracotta">
                {t('salon.seeAllReviews', { count: reviews.length })}
              </button>
            )}
          </div>
          {reviews.length === 0 ? (
            <p className="mt-3 text-stone">{t('salon.noReviews')}</p>
          ) : (
            <>
              <div className="mt-2"><Rating value={b.ratingAvg} count={b.ratingCount} size="lg" /></div>
              <ul className="mt-4 space-y-4">{reviews.slice(0, 3).map((r) => <ReviewItem key={r.id} r={r} />)}</ul>
            </>
          )}
        </section>

        {/* 7. Info */}
        <section className="mt-8" aria-labelledby="info-title">
          <h2 id="info-title" className="text-xl">{t('salon.info')}</h2>
          <p className={clsx('mt-3 text-stone', !showMore && 'line-clamp-3')}>{b.description}</p>
          {b.description.length > 140 && (
            <button type="button" className="min-h-tap text-sm font-bold" onClick={() => setShowMore((v) => !v)}>
              {showMore ? t('common.seeLess') : t('common.seeMore')}
            </button>
          )}
          <h3 className="mt-5 font-sans text-sm font-bold">{t('salon.hours')}</h3>
          <dl className="mt-2 divide-y divide-sand text-sm">
            {[1, 2, 3, 4, 5, 6, 0].map((wd) => {
              const h = hours.find((x) => x.weekday === wd);
              return (
                <div key={wd} className="flex justify-between py-2">
                  <dt className="first-letter:uppercase">{t(`weekdays.${wd}` as never)}</dt>
                  <dd className={clsx(!h && 'text-stone')}>
                    {h ? `${h.opens} – ${h.closes}${h.breakStart ? ` (${t('salon.breakShort')} ${h.breakStart}–${h.breakEnd})` : ''}` : t('salon.closedDay')}
                  </dd>
                </div>
              );
            })}
          </dl>
          <h3 className="mt-5 font-sans text-sm font-bold">{t('salon.address')}</h3>
          <p className="mt-1 text-sm">{b.address}, {b.district}, {city.name}</p>
          <LazyMap lat={b.lat} lng={b.lng} label={b.name} />
        </section>
      </div>

      {/* Sticky CTA */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-sand bg-surface/95 backdrop-blur safe-bottom">
        <div className="container-app flex items-center gap-3 pt-3">
          <div className="min-w-0 flex-1 text-sm" aria-live="polite">
            {chosen.length ? (
              <>
                <p className="font-bold">{t('booking.servicesCount', { count: chosen.length })} · {fmt.money(total)}</p>
                <p className="truncate text-stone">{fmt.duration(chosen.reduce((s, x) => s + x.durationMin, 0))}</p>
              </>
            ) : (
              <p className="text-stone">{t('salon.pickService')}</p>
            )}
          </div>
          <Button size="lg" onClick={book}>{t('common.book')}</Button>
        </div>
      </div>

      <BottomSheet open={allReviews} onClose={() => setAllReviews(false)} title={t('salon.reviews')}>
        <ul className="space-y-5">{reviews.map((r) => <ReviewItem key={r.id} r={r} />)}</ul>
      </BottomSheet>
    </div>
  );
}

function ReviewItem({ r }: { r: Review }) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const date = fmt.monthYear(r.createdAt);
  return (
    <li>
      <div className="flex items-center gap-2 text-sm">
        <span className="font-bold">{r.authorName}</span>
        <span className="text-gold-ink" aria-label={t('review.stars', { count: r.rating })}>{'★'.repeat(r.rating)}</span>
        <span className="text-stone">· {date}</span>
      </div>
      {r.comment && <p className="mt-1">{r.comment}</p>}
      {r.reply && (
        <p className="mt-2 border-l-2 border-sand pl-3 text-sm text-stone">
          <span className="font-bold text-ink">{t('review.salonReply')}</span> {r.reply}
        </p>
      )}
    </li>
  );
}

/** Light map: only mounted when scrolled into view. */
function LazyMap({ lat, lng, label }: { lat: number; lng: number; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((e) => e[0].isIntersecting && setVisible(true), { rootMargin: '200px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const markers = useMemo(() => [{ id: 'salon', lat, lng, label }], [lat, lng, label]);
  const center = useMemo(() => ({ lat, lng }), [lat, lng]);
  return (
    <div ref={ref} className="mt-3 h-48 overflow-hidden rounded-card border border-sand bg-sand-light">
      {visible && <MapView className="h-48 w-full" markers={markers} center={center} zoom={15} interactive={false} />}
    </div>
  );
}

function SalonSkeleton() {
  return (
    <div aria-busy="true">
      <Skeleton className="aspect-[4/3] w-full rounded-none sm:mx-auto sm:mt-4 sm:h-80 sm:max-w-5xl" />
      <div className="container-app mt-5 space-y-3">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
        <div className="grid grid-cols-4 gap-2 pt-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-16" />)}</div>
        {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-16" />)}
      </div>
    </div>
  );
}
