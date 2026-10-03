import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Heart, Zap } from 'lucide-react';
import clsx from 'clsx';
import type { SalonSummary } from '@/lib/types';
import { SalonArt } from '../ui/Art';
import { Rating } from '../ui/Rating';
import { Badge, DemoBadge } from '../ui/Badge';
import { useFormat } from '@/hooks/useFormat';
import { useFavorites } from '@/hooks/useFavorites';
import { todayIn, zonedParts } from '@/lib/time';

export function SalonCard({ salon, compact }: { salon: SalonSummary; compact?: boolean }) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const navigate = useNavigate();
  const { isFavorite, toggle } = useFavorites();
  const { business: b, city } = salon;
  const fav = isFavorite(b.id);

  const nextLabel = (() => {
    if (!salon.nextSlot) return null;
    const day = zonedParts(salon.nextSlot, city.timezone).date;
    const today = todayIn(city.timezone);
    const time = fmt.time(salon.nextSlot, city.timezone);
    if (day === today) return t('salon.todayAt', { time });
    return `${fmt.shortDate(salon.nextSlot, city.timezone)} · ${time}`;
  })();

  return (
    <article className={clsx('group relative', compact ? 'w-[260px] shrink-0 snap-start' : '')}>
      <Link to={`/salon/${b.slug}`} className="block rounded-card focus-visible:outline-offset-4">
        <div className="relative aspect-[4/3] overflow-hidden rounded-card bg-sand">
          {b.photoUrls[0] ? <img src={b.photoUrls[0]} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" /> : <SalonArt seed={b.photoSeeds[0] ?? 1} />}
          <div className="absolute left-3 top-3 flex gap-1.5">
            {b.isDemo && <DemoBadge />}
            {b.instantBooking && (
              <Badge tone="neutral" className="bg-surface/95 text-ink">
                <Zap className="h-3 w-3" strokeWidth={2} aria-hidden />
                {t('salon.instant')}
              </Badge>
            )}
          </div>
        </div>
        <div className="mt-3 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="truncate font-sans text-base font-bold">{b.name}</h3>
            <p className="truncate text-sm text-stone">
              {b.district} · {city.name}
              {salon.distanceKm !== null && ` · ${t('salon.km', { km: salon.distanceKm })}`}
            </p>
          </div>
        </div>
        <div className="mt-1 flex items-center gap-2 text-sm">
          <Rating value={b.ratingAvg} count={b.ratingCount} />
          <span className="text-stone">·</span>
          <span>{t('salon.from', { price: fmt.money(salon.minPrice) })}</span>
        </div>
      </Link>
      <button
        type="button"
        onClick={() => toggle(b.id)}
        aria-pressed={fav}
        aria-label={fav ? t('favorites.remove', { name: b.name }) : t('favorites.add', { name: b.name })}
        className="absolute right-2 top-2 flex h-11 w-11 items-center justify-center rounded-full bg-surface/95 transition-transform duration-150 active:scale-90"
      >
        <Heart className={clsx('h-5 w-5 transition-colors duration-150', fav ? 'fill-terracotta stroke-terracotta' : 'stroke-ink')} strokeWidth={1.75} />
      </button>
      {nextLabel ? (
        <button
          type="button"
          onClick={() => navigate(`/booking/${b.slug}?service=${salon.nextSlotServiceId ?? ''}&start=${encodeURIComponent(salon.nextSlot!)}`)}
          className="mt-3 inline-flex min-h-[40px] items-center gap-2 rounded-full bg-forest-soft px-4 text-sm font-bold text-forest transition-colors duration-150 hover:bg-forest hover:text-white active:scale-[0.97]"
        >
          <span className="h-2 w-2 rounded-full bg-forest" aria-hidden />
          {nextLabel}
        </button>
      ) : (
        <p className="mt-3 text-sm text-stone">{t('salon.noSlotSoon')}</p>
      )}
    </article>
  );
}
