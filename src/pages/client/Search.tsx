import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { List, Map as MapIcon, SlidersHorizontal, SearchX } from 'lucide-react';
import clsx from 'clsx';
import { useApp } from '@/app/AppContext';
import type { SearchParams } from '@/data/api';
import { SearchBar } from '@/components/salon/SearchBar';
import { SalonCard } from '@/components/salon/SalonCard';
import { Chip } from '@/components/ui/Chip';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button } from '@/components/ui/Button';
import { SalonCardSkeleton } from '@/components/ui/Skeleton';
import { EmptyState, ErrorState } from '@/components/ui/EmptyState';
import { MapView } from '@/components/map/MapView';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useFormat } from '@/hooks/useFormat';
import { useToast } from '@/components/ui/Toast';

const PRICE_STEPS = [5000, 10000, 20000];

export default function Search() {
  const { t } = useTranslation();
  const fmt = useFormat();
  const toast = useToast();
  const { api, ref, country } = useApp();
  const params = useParams();
  const [sp, setSp] = useSearchParams();
  const [view, setView] = useState<'list' | 'map'>('list');
  const [sheet, setSheet] = useState<null | 'filters' | 'price'>(null);

  const citySlug = params.city ?? sp.get('city') ?? '';
  const categorySlug = params.category ?? sp.get('category') ?? '';
  const city = ref.cities.find((c) => c.slug === citySlug);
  const category = ref.categories.find((c) => c.slug === categorySlug);
  const near = sp.get('near')?.split(',').map(Number);

  const query: SearchParams = useMemo(
    () => ({
      q: sp.get('q') ?? undefined,
      cityId: city?.id,
      countryCode: city || near ? undefined : country.code,
      categorySlug: category?.slug,
      near: near && near.length === 2 ? { lat: near[0], lng: near[1] } : null,
      availableToday: sp.get('today') === '1',
      mobileMoney: sp.get('mm') === '1',
      instantOnly: sp.get('instant') === '1',
      minRating: sp.get('rating') ? Number(sp.get('rating')) : null,
      maxPrice: sp.get('price') ? Number(sp.get('price')) : null,
      audience: (sp.get('audience') as SearchParams['audience']) || null,
      sort: (sp.get('sort') as SearchParams['sort']) || 'relevance',
      limit: 12,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sp.toString(), city?.id, category?.slug, country.code],
  );

  const results = useInfiniteQuery({
    queryKey: ['search', query],
    queryFn: ({ pageParam }) => api.searchSalons({ ...query, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (last) => last.nextOffset ?? undefined,
  });
  const items = results.data?.pages.flatMap((p) => p.items) ?? [];
  const total = results.data?.pages[0]?.total ?? 0;

  // Infinite scroll in batches of 12.
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((e) => {
      if (e[0].isIntersecting && results.hasNextPage && !results.isFetchingNextPage) void results.fetchNextPage();
    }, { rootMargin: '400px' });
    io.observe(el);
    return () => io.disconnect();
  }, [results]);

  const title = category && city
    ? t('search.titleCategoryCity', { category: t(`categories.${category.key}` as never), city: city.name })
    : category
      ? t(`categories.${category.key}` as never)
      : city
        ? t('search.titleCity', { city: city.name })
        : sp.get('q')
          ? t('search.titleQuery', { q: sp.get('q') })
          : t('search.titleAll');
  useDocumentTitle(title, t('search.metaDescription', { title }));

  const set = (key: string, value: string | null) => {
    const next = new URLSearchParams(sp);
    if (value === null) next.delete(key);
    else next.set(key, value);
    setSp(next, { replace: true });
  };
  const toggle = (key: string) => set(key, sp.get(key) === '1' ? null : '1');

  const sortByDistance = () => {
    if (query.sort === 'distance') return set('sort', null);
    if (query.near) return set('sort', 'distance');
    navigator.geolocation?.getCurrentPosition(
      (pos) => {
        const next = new URLSearchParams(sp);
        next.set('near', `${pos.coords.latitude.toFixed(4)},${pos.coords.longitude.toFixed(4)}`);
        next.set('sort', 'distance');
        setSp(next, { replace: true });
      },
      () => toast(t('search.geoDenied'), 'error'),
    );
  };

  const activeSecondary = ['audience', 'instant'].filter((k) => sp.get(k)).length + (params.category ? 0 : sp.get('category') ? 1 : 0);

  return (
    <div className="container-app py-4">
      <SearchBar compact initial={{ q: sp.get('q') ?? '', city: citySlug, near: sp.get('near') ?? undefined }} />

      <div className="mt-5 flex items-baseline justify-between gap-3">
        <h1 className="text-xl">{title}</h1>
        {results.isSuccess && <p className="shrink-0 text-sm text-stone">{t('search.count', { count: total })}</p>}
      </div>

      <div className="no-scrollbar -mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1" role="toolbar" aria-label={t('search.filters')}>
        <Chip active={query.availableToday} onClick={() => toggle('today')}>{t('search.chips.today')}</Chip>
        <Chip active={query.sort === 'distance'} onClick={sortByDistance}>{t('search.chips.distance')}</Chip>
        <Chip active={!!query.maxPrice} onClick={() => setSheet('price')}>
          {query.maxPrice ? t('search.chips.priceMax', { price: fmt.money(query.maxPrice) }) : t('search.chips.price')}
        </Chip>
        <Chip active={!!query.minRating} onClick={() => set('rating', query.minRating ? null : '4.5')}>{t('search.chips.rating')}</Chip>
        <Chip active={query.mobileMoney} onClick={() => toggle('mm')}>{t('search.chips.mobileMoney')}</Chip>
        <Chip active={activeSecondary > 0} onClick={() => setSheet('filters')} icon={<SlidersHorizontal className="h-4 w-4" strokeWidth={1.75} aria-hidden />}>
          {t('search.chips.filters')}
          {activeSecondary > 0 && ` · ${activeSecondary}`}
        </Chip>
      </div>

      <div className="mt-3 flex justify-end">
        <div className="inline-flex rounded-full border border-sand bg-surface p-1" role="tablist" aria-label={t('search.view')}>
          {(['list', 'map'] as const).map((v) => (
            <button
              key={v}
              role="tab"
              aria-selected={view === v}
              onClick={() => setView(v)}
              className={clsx('inline-flex min-h-[36px] items-center gap-1.5 rounded-full px-3 text-sm font-medium transition-colors duration-150', view === v ? 'bg-ink text-ivory' : 'text-ink')}
            >
              {v === 'list' ? <List className="h-4 w-4" strokeWidth={1.75} aria-hidden /> : <MapIcon className="h-4 w-4" strokeWidth={1.75} aria-hidden />}
              {t(`search.${v}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4">
        {results.isError ? (
          <ErrorState onRetry={() => results.refetch()} />
        ) : results.isPending ? (
          <div className="grid gap-x-5 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }, (_, i) => <SalonCardSkeleton key={i} />)}
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon={<SearchX strokeWidth={1.75} />}
            title={t('search.emptyTitle')}
            body={t('search.emptyBody')}
            action={<Button variant="secondary" onClick={() => setSp(new URLSearchParams(), { replace: true })}>{t('search.clear')}</Button>}
          />
        ) : view === 'map' ? (
          <MapView
            className="h-[60vh] w-full overflow-hidden rounded-card border border-sand"
            markers={items.map((s) => ({ id: s.business.id, lat: s.business.lat, lng: s.business.lng, label: s.business.name, href: `/salon/${s.business.slug}` }))}
          />
        ) : (
          <>
            <div className="grid gap-x-5 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((s) => <SalonCard key={s.business.id} salon={s} />)}
              {results.isFetchingNextPage && Array.from({ length: 3 }, (_, i) => <SalonCardSkeleton key={`sk${i}`} />)}
            </div>
            <div ref={sentinel} className="h-4" aria-hidden />
          </>
        )}
      </div>

      <BottomSheet open={sheet === 'price'} onClose={() => setSheet(null)} title={t('search.priceTitle')}>
        <div className="flex flex-col gap-2">
          {[null, ...PRICE_STEPS].map((p) => (
            <Chip key={p ?? 'any'} active={(query.maxPrice ?? null) === p} className="justify-center" onClick={() => { set('price', p ? String(p) : null); setSheet(null); }}>
              {p ? t('search.chips.priceMax', { price: fmt.money(p) }) : t('search.anyPrice')}
            </Chip>
          ))}
        </div>
      </BottomSheet>

      <BottomSheet
        open={sheet === 'filters'}
        onClose={() => setSheet(null)}
        title={t('search.chips.filters')}
        footer={<Button block size="lg" onClick={() => setSheet(null)}>{t('search.showResults', { count: total })}</Button>}
      >
        <fieldset>
          <legend className="label">{t('search.audience')}</legend>
          <div className="flex flex-wrap gap-2">
            {(['', 'women', 'men'] as const).map((a) => (
              <Chip key={a || 'all'} active={(sp.get('audience') ?? '') === a} onClick={() => set('audience', a || null)}>
                {t(`search.audiences.${a || 'all'}`)}
              </Chip>
            ))}
          </div>
        </fieldset>
        <fieldset className="mt-6">
          <legend className="label">{t('search.booking')}</legend>
          <Chip active={query.instantOnly} onClick={() => toggle('instant')}>{t('salon.instant')}</Chip>
        </fieldset>
        {!params.category && (
          <fieldset className="mt-6">
            <legend className="label">{t('search.category')}</legend>
            <div className="flex flex-wrap gap-2">
              <Chip active={!categorySlug} onClick={() => set('category', null)}>{t('search.audiences.all')}</Chip>
              {ref.categories.map((c) => (
                <Chip key={c.id} active={categorySlug === c.slug} onClick={() => set('category', c.slug)}>
                  {t(`categories.${c.key}` as never)}
                </Chip>
              ))}
            </div>
          </fieldset>
        )}
      </BottomSheet>
    </div>
  );
}
