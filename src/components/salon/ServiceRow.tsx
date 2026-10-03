import { Check, Plus } from 'lucide-react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import type { Service } from '@/lib/types';
import { useFormat } from '@/hooks/useFormat';

export function ServiceRow({ service, selected, onToggle }: { service: Service; selected: boolean; onToggle: () => void }) {
  const { t } = useTranslation();
  const fmt = useFormat();
  return (
    <div className="flex items-center gap-3 py-4">
      <div className="min-w-0 flex-1">
        <p className="font-bold">{service.name}</p>
        {service.description && <p className="mt-0.5 line-clamp-2 text-sm text-stone">{service.description}</p>}
        <p className="mt-1 text-sm">
          <span className="text-stone">{fmt.duration(service.durationMin)}</span>
          <span className="mx-1.5 text-stone">·</span>
          <span className="font-bold">{fmt.money(service.price)}</span>
        </p>
      </div>
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={selected}
        aria-label={selected ? t('salon.removeService', { name: service.name }) : t('salon.addService', { name: service.name })}
        className={clsx(
          'flex h-11 w-11 shrink-0 items-center justify-center rounded-full border transition-colors duration-150 active:scale-90',
          selected ? 'border-terracotta bg-terracotta text-white' : 'border-ink/20 bg-surface text-ink hover:border-ink',
        )}
      >
        {selected ? <Check className="h-5 w-5 animate-pop" strokeWidth={2} /> : <Plus className="h-5 w-5" strokeWidth={1.75} />}
      </button>
    </div>
  );
}
