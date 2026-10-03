import { Star } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export function Rating({ value, count, size = 'sm' }: { value: number; count?: number; size?: 'sm' | 'lg' }) {
  const { t } = useTranslation();
  if (!count) return <span className="text-sm text-stone">{t('salon.new')}</span>;
  return (
    <span className="inline-flex items-center gap-1" aria-label={t('salon.ratingAria', { value: value.toFixed(1), count })}>
      <Star className={size === 'lg' ? 'h-5 w-5' : 'h-4 w-4'} fill="#D9A441" stroke="#D9A441" strokeWidth={1.75} aria-hidden />
      <span className={size === 'lg' ? 'text-lg font-bold' : 'text-sm font-bold'}>{value.toFixed(1)}</span>
      {count !== undefined && <span className="text-sm text-stone">({count})</span>}
    </span>
  );
}

export function StarInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex gap-1" role="radiogroup" aria-label={t('review.rating')}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={t('review.stars', { count: n })} onClick={() => onChange(n)} className="flex h-12 w-12 items-center justify-center rounded-full transition-transform duration-150 active:scale-90">
          <Star className="h-8 w-8" strokeWidth={1.75} fill={n <= value ? '#D9A441' : 'none'} stroke={n <= value ? '#D9A441' : '#6B645C'} />
        </button>
      ))}
    </div>
  );
}
