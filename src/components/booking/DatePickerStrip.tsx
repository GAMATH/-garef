import { useEffect, useRef } from 'react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import type { DayAvailability } from '@/lib/types';
import { useFormat } from '@/hooks/useFormat';
import { Skeleton } from '../ui/Skeleton';

/** Horizontal strip of the next 14 days; days without availability are greyed out. */
export function DatePickerStrip({ days, selected, onSelect, today, loading }: { days: DayAvailability[]; selected: string | null; onSelect: (d: string) => void; today: string; loading?: boolean }) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[aria-pressed="true"]')?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }, [selected]);

  if (loading)
    return (
      <div className="flex gap-2 overflow-hidden" aria-busy="true">
        {Array.from({ length: 7 }, (_, i) => (
          <Skeleton key={i} className="h-[76px] w-[60px] shrink-0" />
        ))}
      </div>
    );

  return (
    <div ref={ref} className="no-scrollbar -mx-4 flex snap-x gap-2 overflow-x-auto px-4 pb-1" role="group" aria-label={t('booking.chooseDay')}>
      {days.map((d) => {
        const active = d.date === selected;
        return (
          <button
            key={d.date}
            type="button"
            disabled={!d.available}
            aria-pressed={active}
            aria-label={`${fmt.day(d.date, { weekday: 'long', day: 'numeric', month: 'long' })}${d.available ? '' : ` — ${t('booking.dayFull')}`}`}
            onClick={() => onSelect(d.date)}
            className={clsx(
              'flex w-[60px] shrink-0 snap-start flex-col items-center rounded-card border py-2.5 transition-colors duration-150 active:scale-95',
              active ? 'border-terracotta bg-terracotta text-white' : 'border-sand bg-surface',
              !d.available && 'cursor-not-allowed border-transparent bg-transparent text-stone/50 line-through decoration-stone/40',
            )}
          >
            <span className={clsx('text-xs font-medium uppercase', active ? 'text-white/85' : 'text-stone', !d.available && 'text-stone/50')}>
              {d.date === today ? t('booking.todayShort') : fmt.day(d.date, { weekday: 'short' }).replace('.', '')}
            </span>
            <span className="font-display text-xl font-semibold">{Number(d.date.slice(8))}</span>
            <span className={clsx('text-xs', active ? 'text-white/85' : 'text-stone', !d.available && 'text-stone/50')}>{fmt.day(d.date, { month: 'short' }).replace('.', '')}</span>
          </button>
        );
      })}
    </div>
  );
}
