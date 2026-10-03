import { useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CalendarDays, Clock, ExternalLink, LayoutDashboard, ListChecks, LogOut, Menu, Scissors, Settings, Star, Users, UserSquare2 } from 'lucide-react';
import clsx from 'clsx';
import { useApp } from '@/app/AppContext';
import { Logo } from '@/components/ui/Art';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { IconButton } from '@/components/ui/Button';
import { DemoBadge } from '@/components/ui/Badge';
import { useBusiness } from './BusinessContext';

const NAV: { to: string; key: 'today' | 'calendar' | 'bookings' | 'clients' | 'services' | 'team' | 'hours' | 'reviews' | 'settings'; icon: typeof Clock; end?: boolean }[] = [
  { to: '/business', key: 'today', icon: LayoutDashboard, end: true },
  { to: '/business/calendar', key: 'calendar', icon: CalendarDays },
  { to: '/business/bookings', key: 'bookings', icon: ListChecks },
  { to: '/business/clients', key: 'clients', icon: UserSquare2 },
  { to: '/business/services', key: 'services', icon: Scissors },
  { to: '/business/team', key: 'team', icon: Users },
  { to: '/business/hours', key: 'hours', icon: Clock },
  { to: '/business/reviews', key: 'reviews', icon: Star },
  { to: '/business/settings', key: 'settings', icon: Settings },
];

export function BusinessLayout({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { business } = useBusiness();
  const { signOut } = useApp();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const current = NAV.find((n) => (n.end ? location.pathname === n.to : location.pathname.startsWith(n.to)));

  const nav = (onClick?: () => void) => (
    <ul className="space-y-1">
      {NAV.map(({ to, key, icon: Icon, end }) => (
        <li key={key}>
          <NavLink
            to={to}
            end={end}
            onClick={onClick}
            className={({ isActive }) => clsx('flex min-h-tap items-center gap-3 rounded-full px-4 text-sm font-medium transition-colors duration-150', isActive ? 'bg-terracotta-soft text-terracotta-dark' : 'text-ink hover:bg-sand/60')}
          >
            <Icon className="h-5 w-5" strokeWidth={1.75} aria-hidden />
            {t(`pro.nav.${key}`)}
          </NavLink>
        </li>
      ))}
    </ul>
  );

  const footer = (
    <div className="space-y-1 border-t border-sand pt-3">
      <Link to={`/salon/${business.slug}`} className="flex min-h-tap items-center gap-3 rounded-full px-4 text-sm font-medium text-stone hover:bg-sand/60">
        <ExternalLink className="h-5 w-5" strokeWidth={1.75} aria-hidden />
        {t('pro.publicPage')}
      </Link>
      <button type="button" onClick={async () => { await signOut(); navigate('/'); }} className="flex min-h-tap w-full items-center gap-3 rounded-full px-4 text-sm font-medium text-stone hover:bg-sand/60">
        <LogOut className="h-5 w-5" strokeWidth={1.75} aria-hidden />
        {t('profile.signOut')}
      </button>
    </div>
  );

  return (
    <div className="min-h-dvh bg-ivory lg:flex">
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r border-sand bg-surface p-4 lg:flex" aria-label={t('pro.nav.label')}>
        <Link to="/" className="px-2"><Logo /></Link>
        <div className="mt-6 px-2">
          <p className="truncate font-bold">{business.name}</p>
          {business.isDemo && <DemoBadge />}
        </div>
        <nav className="mt-4 flex-1 overflow-y-auto">{nav()}</nav>
        {footer}
      </aside>

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-sand bg-surface/95 px-2 backdrop-blur lg:hidden">
          <IconButton label={t('pro.nav.open')} onClick={() => setOpen(true)}>
            <Menu className="h-5 w-5" strokeWidth={1.75} />
          </IconButton>
          <p className="min-w-0 flex-1 truncate font-bold">{current ? t(`pro.nav.${current.key}`) : business.name}</p>
          <span className="truncate pr-3 text-sm text-stone">{business.name}</span>
        </header>
        <main className="mx-auto w-full max-w-6xl px-4 py-5 sm:px-6 lg:py-8">{children}</main>
      </div>

      <BottomSheet open={open} onClose={() => setOpen(false)} title={business.name}>
        <nav aria-label={t('pro.nav.label')}>{nav(() => setOpen(false))}</nav>
        <div className="mt-3">{footer}</div>
      </BottomSheet>
    </div>
  );
}

export function PageHeader({ title, action, subtitle }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl">{title}</h1>
        {subtitle && <p className="mt-1 text-stone">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
