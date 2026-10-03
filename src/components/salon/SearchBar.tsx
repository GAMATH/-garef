import { useId, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { LocateFixed, MapPin, Search, Store, Scissors, Tag } from 'lucide-react';
import clsx from 'clsx';
import { useApp } from '@/app/AppContext';
import { useDebounced } from '@/hooks/useDebounced';
import { Button } from '../ui/Button';
import { useToast } from '../ui/Toast';

export interface SearchValues {
  q: string;
  city: string; // city slug, '' = whole country, 'near' = around me
  near?: string; // "lat,lng"
}

type Option = { kind: 'category' | 'service' | 'salon'; label: string; sub?: string; value: string };

/** Two fields only: What? (with suggestions) and Where? (city / around me). The date comes later. */
export function SearchBar({ initial, compact }: { initial?: Partial<SearchValues>; compact?: boolean }) {
  const { t } = useTranslation();
  const { api, ref, country } = useApp();
  const navigate = useNavigate();
  const toast = useToast();
  const [q, setQ] = useState(initial?.q ?? '');
  const [city, setCity] = useState(initial?.city ?? '');
  const [near, setNear] = useState(initial?.near);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [locating, setLocating] = useState(false);
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const debounced = useDebounced(q.trim(), 180);

  const sugg = useQuery({ queryKey: ['suggest', debounced], queryFn: () => api.suggest(debounced), enabled: debounced.length >= 2, staleTime: 60_000 });
  const options: Option[] = [
    ...(sugg.data?.categories ?? []).map((c) => ({ kind: 'category' as const, label: t(`categories.${c.key}` as never), value: c.slug })),
    ...(sugg.data?.services ?? []).map((s) => ({ kind: 'service' as const, label: s, value: s })),
    ...(sugg.data?.salons ?? []).map((s) => ({ kind: 'salon' as const, label: s.name, sub: `${s.district} · ${s.city}`, value: s.slug })),
  ];
  const cities = ref.cities.filter((c) => c.countryCode === country.code);

  const go = (values: { q?: string; category?: string }) => {
    const params = new URLSearchParams();
    if (values.q) params.set('q', values.q);
    if (city === 'near' && near) {
      params.set('near', near);
      params.set('sort', 'distance');
    }
    const citySlug = city && city !== 'near' ? city : '';
    if (values.category && citySlug) return navigate(`/${citySlug}/${values.category}`);
    if (values.category) params.set('category', values.category);
    if (citySlug) params.set('city', citySlug);
    navigate(`/search?${params.toString()}`);
  };

  const pick = (o: Option) => {
    setOpen(false);
    if (o.kind === 'salon') return navigate(`/salon/${o.value}`);
    if (o.kind === 'category') return go({ category: o.value });
    setQ(o.value);
    go({ q: o.value });
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (open && active >= 0 && options[active]) return pick(options[active]);
    setOpen(false);
    go({ q: q.trim() });
  };

  const locate = () => {
    if (!('geolocation' in navigator)) return toast(t('search.geoUnavailable'), 'error');
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setNear(`${pos.coords.latitude.toFixed(4)},${pos.coords.longitude.toFixed(4)}`);
        setCity('near');
        setLocating(false);
      },
      () => {
        setLocating(false);
        setCity('');
        toast(t('search.geoDenied'), 'error');
      },
      { timeout: 8000, maximumAge: 300000 },
    );
  };

  return (
    <form onSubmit={onSubmit} role="search" className={clsx('relative rounded-lg border border-sand bg-surface', compact ? 'p-1.5' : 'p-2 shadow-soft')}>
      <div className={clsx('flex flex-col', !compact && 'sm:flex-row sm:items-center')}>
        <div className="relative flex-1">
          <label className="flex min-h-[52px] items-center gap-3 px-3">
            <Search className="h-5 w-5 shrink-0 text-stone" strokeWidth={1.75} aria-hidden />
            <span className="sr-only">{t('search.what')}</span>
            <input
              ref={inputRef}
              role="combobox"
              aria-expanded={open && options.length > 0}
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setOpen(true);
                setActive(-1);
              }}
              onFocus={() => setOpen(true)}
              onBlur={() => setTimeout(() => setOpen(false), 150)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setActive((a) => Math.min(options.length - 1, a + 1));
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setActive((a) => Math.max(-1, a - 1));
                } else if (e.key === 'Escape') setOpen(false);
              }}
              placeholder={t('search.whatPlaceholder')}
              className="min-w-0 flex-1 bg-transparent text-base placeholder:text-stone focus:outline-none"
              autoComplete="off"
              enterKeyHint="search"
            />
          </label>
          {open && options.length > 0 && (
            <ul id={listId} role="listbox" className="absolute inset-x-0 top-full z-20 mt-2 overflow-hidden rounded-card border border-sand bg-surface py-1 shadow-soft animate-fade-up">
              {options.map((o, i) => {
                const Icon = o.kind === 'salon' ? Store : o.kind === 'category' ? Tag : Scissors;
                return (
                  <li
                    key={`${o.kind}-${o.value}`}
                    id={`${listId}-${i}`}
                    role="option"
                    aria-selected={i === active}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pick(o)}
                    className={clsx('flex min-h-tap cursor-pointer items-center gap-3 px-4 py-2', i === active ? 'bg-sand-light' : 'hover:bg-sand-light')}
                  >
                    <Icon className="h-4 w-4 shrink-0 text-stone" strokeWidth={1.75} aria-hidden />
                    <span className="min-w-0 flex-1 truncate">{o.label}</span>
                    {o.sub && <span className="truncate text-sm text-stone">{o.sub}</span>}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <div className={clsx('border-sand', compact ? 'border-t' : 'border-t sm:border-l sm:border-t-0')} />
        <div className="flex flex-1 items-center gap-1 px-3">
          <MapPin className="h-5 w-5 shrink-0 text-stone" strokeWidth={1.75} aria-hidden />
          <label className="sr-only" htmlFor={`${listId}-where`}>
            {t('search.where')}
          </label>
          <select
            id={`${listId}-where`}
            value={city}
            onChange={(e) => (e.target.value === 'near' ? locate() : setCity(e.target.value))}
            className="min-h-[52px] min-w-0 flex-1 appearance-none bg-transparent text-base focus:outline-none"
          >
            <option value="">{t('search.allCountry', { country: country.name })}</option>
            {cities.map((c) => (
              <option key={c.id} value={c.slug}>
                {c.name}
              </option>
            ))}
            <option value="near">{city === 'near' ? t('search.nearMeActive') : t('search.nearMe')}</option>
          </select>
          <button type="button" onClick={locate} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-stone hover:bg-sand/60" aria-label={t('search.nearMe')}>
            <LocateFixed className={clsx('h-5 w-5', locating && 'animate-spin', city === 'near' && 'text-terracotta')} strokeWidth={1.75} />
          </button>
        </div>
        <Button type="submit" size="lg" className={clsx('mt-1', !compact && 'sm:mt-0')} aria-label={t('search.submit')}>
          <Search className="h-5 w-5" strokeWidth={1.75} aria-hidden />
          <span className={clsx(compact && 'sr-only')}>{t('search.submit')}</span>
        </Button>
      </div>
    </form>
  );
}
