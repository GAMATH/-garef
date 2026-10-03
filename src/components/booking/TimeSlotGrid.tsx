import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import type { Slot } from '@/lib/types';
import { dayPart, type DayPart } from '@/lib/booking-engine';
import { zonedParts } from '@/lib/time';
import { useFormat } from '@/hooks/useFormat';
import { Skeleton } from '../ui/Skeleton';

/** Free slots only, grouped Morning / Afternoon / Evening. */
export function TimeSlotGrid({ slots, tz, selected, onSelect, loading }: { slots: Slot[]; tz: string; selected: string | null; onSelect: (s: Slot) => void; loading?: boolean }) {
  const { t } = useTranslation();
  const fmt = useFormat();
  if (loading)
    return (
      <div className="grid grid-cols-4 gap-2" aria-busy="true">
        {Array.from({ length: 12 }, (_, i) => (
          <Skeleton key={i} className="h-11" />
        ))}
      </div>
    );
  const groups: Record<DayPart, Slot[]> = { morning: [], afternoon: [], evening: [] };
  for (const s of slots) groups[dayPart(zonedParts(s.start, tz).time)].push(s);
  return (
    <div className="space-y-5">
      {(Object.keys(groups) as DayPart[])
        .filter((k) => groups[k].length)
        .map((k) => (
          <section key={k} aria-label={t(`booking.parts.${k}`)}>
            <h3 className="mb-2 font-sans text-sm font-bold text-stone">{t(`booking.parts.${k}`)}</h3>
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
              {groups[k].map((s) => {
                const active = s.start === selected;
                return (
                  <button
                    key={s.start}
                    type="button"
                    aria-pressed={active}
                    onClick={() => onSelect(s)}
                    className={clsx(
                      'min-h-tap rounded-full border text-sm font-bold tabular-nums transition-colors duration-150 active:scale-95',
                      active ? 'border-terracotta bg-terracotta text-white' : 'border-sand bg-surface hover:border-terracotta',
                    )}
                  >
                    {fmt.time(s.start, tz)}
                  </button>
                );
              })}
            </div>
          </section>
        ))}
    </div>
  );
}
