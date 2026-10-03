import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ArrowRight, CalendarCheck, Smartphone, Sparkles } from 'lucide-react';
import { useApp } from '@/app/AppContext';
import { Pattern } from '@/components/ui/Art';
import { SearchBar } from '@/components/salon/SearchBar';
import { SalonCard } from '@/components/salon/SalonCard';
import { SalonCardSkeleton } from '@/components/ui/Skeleton';
import { EmptyState, ErrorState } from '@/components/ui/EmptyState';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';

const POPULAR = ['coupe-homme', 'barbe', 'braids', 'tissage', 'locks', 'manucure'];

export default function Home() {
  const { t } = useTranslation();
  const { api, country, ref } = useApp();
  useDocumentTitle('', t('home.metaDescription'));
  const today = useQuery({
    queryKey: ['search', 'home-today', country.code],
    queryFn: () => api.searchSalons({ countryCode: country.code, availableToday: true, limit: 8 }),
  });
  const fallback = useQuery({
    queryKey: ['search', 'home-all', country.code],
    queryFn: () => api.searchSalons({ countryCode: country.code, limit: 8 }),
    enabled: today.isSuccess && today.data.total === 0,
  });
  const list = today.data?.total ? today.data : fallback.data;
  const categories = POPULAR.map((slug) => ref.categories.find((c) => c.slug === slug)).filter(Boolean);

  return (
    <>
      <section className="relative overflow-hidden border-b border-sand/70">
        <Pattern className="absolute inset-0" opacity={0.08} />
        <div className="absolute inset-0 bg-gradient-to-b from-ivory/40 via-ivory/80 to-ivory" aria-hidden />
        <div className="container-app relative pb-8 pt-10 sm:pb-14 sm:pt-16">
          <h1 className="max-w-xl text-2xl sm:text-3xl">{t('home.title')}</h1>
          <p className="mt-3 max-w-md text-lg text-stone">{t('home.subtitle')}</p>
          <div className="mt-6 max-w-3xl">
            <SearchBar />
          </div>
          <div className="no-scrollbar -mx-4 mt-5 flex gap-2 overflow-x-auto px-4" role="list" aria-label={t('home.popular')}>
            {categories.map((c) => (
              <Link
                key={c!.id}
                role="listitem"
                to={`/search?category=${c!.slug}`}
                className="inline-flex min-h-[40px] shrink-0 items-center rounded-full border border-sand bg-surface px-4 text-sm font-medium transition-colors duration-150 hover:border-ink/40 active:scale-[0.97]"
              >
                {t(`categories.${c!.key}` as never)}
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="container-app py-8" aria-labelledby="today-title">
        <div className="mb-4 flex items-end justify-between gap-4">
          <h2 id="today-title" className="text-xl">
            {today.data?.total || today.isPending ? t('home.availableToday') : t('home.nearYou')}
          </h2>
          <Link to={`/search?today=1`} className="inline-flex min-h-tap shrink-0 items-center gap-1 whitespace-nowrap text-sm font-bold text-terracotta">
            {t('common.seeAll')}
            <ArrowRight className="h-4 w-4" strokeWidth={1.75} aria-hidden />
          </Link>
        </div>
        {today.isError ? (
          <ErrorState onRetry={() => today.refetch()} />
        ) : !list ? (
          <div className="no-scrollbar -mx-4 flex gap-4 overflow-hidden px-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="w-[260px] shrink-0">
                <SalonCardSkeleton />
              </div>
            ))}
          </div>
        ) : list.items.length === 0 ? (
          <EmptyState title={t('home.emptyCountry', { country: country.name })} body={t('home.emptyCountryBody')} />
        ) : (
          <div className="no-scrollbar -mx-4 flex snap-x gap-4 overflow-x-auto px-4 pb-2">
            {list.items.map((s) => (
              <SalonCard key={s.business.id} salon={s} compact />
            ))}
          </div>
        )}
      </section>

      <section className="container-app pb-12" aria-label={t('home.howTitle')}>
        <ul className="grid gap-4 sm:grid-cols-3">
          {[
            { icon: Sparkles, title: t('home.how1'), body: t('home.how1b') },
            { icon: CalendarCheck, title: t('home.how2'), body: t('home.how2b') },
            { icon: Smartphone, title: t('home.how3'), body: t('home.how3b') },
          ].map(({ icon: Icon, title, body }) => (
            <li key={title} className="card flex gap-4 p-5">
              <Icon className="h-6 w-6 shrink-0 text-terracotta" strokeWidth={1.75} aria-hidden />
              <div>
                <p className="font-bold">{title}</p>
                <p className="mt-1 text-sm text-stone">{body}</p>
              </div>
            </li>
          ))}
        </ul>
        <div className="mt-8 flex flex-col items-start justify-between gap-4 rounded-lg bg-ink p-6 text-ivory sm:flex-row sm:items-center">
          <div>
            <p className="font-display text-xl">{t('home.proTitle')}</p>
            <p className="mt-1 text-sm text-ivory/75">{t('home.proBody')}</p>
          </div>
          <Link to="/business" className="inline-flex min-h-tap items-center gap-2 rounded-full bg-ivory px-5 font-bold text-ink transition-transform duration-150 active:scale-[0.97]">
            {t('home.proCta')}
            <ArrowRight className="h-4 w-4" strokeWidth={1.75} aria-hidden />
          </Link>
        </div>
      </section>
    </>
  );
}
