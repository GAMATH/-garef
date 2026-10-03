import { useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CalendarDays, Compass, Heart, User, Store } from 'lucide-react';
import clsx from 'clsx';
import { Logo } from '@/components/ui/Art';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { useApp } from './AppContext';
import { setLocale } from '@/i18n';
import type { Locale } from '@/lib/types';

export function ClientLayout() {
  const { t, i18n } = useTranslation();
  const { country, ref, setCountryCode, profile } = useApp();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const showNav = location.pathname === '/' || location.pathname.startsWith('/account') || location.pathname === '/search';

  return (
    <div className={clsx('min-h-dvh', showNav && 'pb-20 md:pb-0')}>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-ink focus:px-4 focus:py-2 focus:text-ivory">
        {t('common.skip')}
      </a>
      <header className="sticky top-0 z-30 border-b border-sand/70 bg-ivory/95 backdrop-blur">
        <div className="container-app flex h-14 items-center justify-between gap-2">
          <Link to="/" aria-label={t('nav.home')}>
            <Logo />
          </Link>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="flex min-h-tap items-center gap-1.5 rounded-full px-3 text-sm font-medium hover:bg-sand/60"
              aria-label={t('country.change', { country: country.name })}
            >
              <span aria-hidden>{country.flag}</span>
              <span>FCFA</span>
            </button>
            <nav className="hidden items-center gap-1 md:flex" aria-label={t('nav.main')}>
              <NavLink to="/search" className="min-h-tap rounded-full px-3 py-2.5 text-sm font-medium hover:bg-sand/60">
                {t('nav.explore')}
              </NavLink>
              <NavLink to={profile ? '/account/appointments' : '/login'} className="min-h-tap rounded-full px-3 py-2.5 text-sm font-medium hover:bg-sand/60">
                {profile ? t('nav.appointments') : t('nav.login')}
              </NavLink>
              <Link to={profile?.role === 'admin' ? '/admin' : '/business'} className="flex min-h-tap items-center gap-1.5 rounded-full border border-sand px-3 py-2 text-sm font-medium hover:border-ink/40">
                <Store className="h-4 w-4" strokeWidth={1.75} aria-hidden />
                {profile?.role === 'admin' ? t('nav.admin') : t('nav.forSalons')}
              </Link>
            </nav>
          </div>
        </div>
      </header>

      <main id="main">
        <Outlet />
      </main>

      {showNav && <BottomNav />}

      <BottomSheet open={open} onClose={() => setOpen(false)} title={t('country.title')}>
        <ul className="divide-y divide-sand">
          {ref.countries.map((c) => (
            <li key={c.code}>
              <button
                type="button"
                className="flex min-h-[52px] w-full items-center gap-3 text-left"
                onClick={() => {
                  setCountryCode(c.code);
                  setOpen(false);
                }}
                aria-pressed={c.code === country.code}
              >
                <span className="text-2xl" aria-hidden>
                  {c.flag}
                </span>
                <span className="flex-1 font-medium">{c.name}</span>
                <span className="text-sm text-stone">
                  {c.dialCode} · {c.currency === 'XAF' ? t('country.xaf') : t('country.xof')}
                </span>
                {c.code === country.code && <span className="h-2.5 w-2.5 rounded-full bg-terracotta" aria-hidden />}
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-6">
          <p className="label">{t('profile.language')}</p>
          <div className="flex gap-2">
            {(['fr', 'en'] as Locale[]).map((l) => (
              <button
                key={l}
                type="button"
                aria-pressed={i18n.language === l}
                onClick={() => void setLocale(l)}
                className={clsx('min-h-tap flex-1 rounded-full border text-sm font-bold', i18n.language === l ? 'border-ink bg-ink text-ivory' : 'border-sand')}
              >
                {t(`languages.${l}`)}
              </button>
            ))}
          </div>
        </div>
      </BottomSheet>
    </div>
  );
}

function BottomNav() {
  const { t } = useTranslation();
  const { profile } = useApp();
  const items = [
    { to: '/', icon: Compass, label: t('nav.explore'), end: true },
    { to: profile ? '/account/appointments' : '/login?next=/account/appointments', icon: CalendarDays, label: t('nav.appointments') },
    { to: profile ? '/account/favorites' : '/login?next=/account/favorites', icon: Heart, label: t('nav.favorites') },
    { to: profile ? '/account/profile' : '/login?next=/account/profile', icon: User, label: t('nav.profile') },
  ];
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-sand bg-surface/95 backdrop-blur safe-bottom md:hidden" aria-label={t('nav.main')}>
      <ul className="mx-auto flex max-w-md">
        {items.map(({ to, icon: Icon, label, end }) => (
          <li key={label} className="flex-1">
            <NavLink
              to={to}
              end={end}
              className={({ isActive }) => clsx('flex min-h-[56px] flex-col items-center justify-center gap-0.5 text-xs font-medium transition-colors duration-150', isActive ? 'text-terracotta' : 'text-stone')}
            >
              <Icon className="h-6 w-6" strokeWidth={1.75} aria-hidden />
              {label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
