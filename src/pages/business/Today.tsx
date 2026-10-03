import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { CalendarDays, Check, LogIn, UserX } from 'lucide-react';
import { useApp } from '@/app/AppContext';
import type { AppointmentStatus } from '@/lib/types';
import { addDays, todayIn, zonedToUtc } from '@/lib/time';
import { useFormat } from '@/hooks/useFormat';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { PaymentBadge, StatusBadge } from '@/components/ui/Badge';
import { Button, ButtonLink } from '@/components/ui/Button';
import { EmptyState, ErrorState } from '@/components/ui/EmptyState';
import { ListSkeleton, Skeleton } from '@/components/ui/Skeleton';
import { StaffAvatar } from '@/components/ui/StaffAvatar';
import { useToast } from '@/components/ui/Toast';
import { useBusiness } from './BusinessContext';
import { PageHeader } from './BusinessLayout';

export default function Today() {
  const { t } = useTranslation();
  const fmt = useFormat();
  const { api } = useApp();
  const { business, tz } = useBusiness();
  const qc = useQueryClient();
  const toast = useToast();
  useDocumentTitle(t('pro.nav.today'));
  const today = todayIn(tz);
  const stats = useQuery({ queryKey: ['pro', 'dashboard', business.id], queryFn: () => api.getDashboard(business.id) });
  const list = useQuery({
    queryKey: ['pro', 'appointments', business.id, 'today', today],
    queryFn: () => api.listAppointments({ businessId: business.id, from: zonedToUtc(today, '00:00', tz).toISOString(), to: zonedToUtc(addDays(today, 1), '00:00', tz).toISOString() }),
  });
  const setStatus = useMutation({
    mutationFn: (v: { id: string; status: AppointmentStatus }) => api.setAppointmentStatus(v.id, v.status),
    onSuccess: (_d, v) => {
      toast(t(`pro.statusUpdated.${v.status}` as never));
      void qc.invalidateQueries({ queryKey: ['pro'] });
    },
    onError: () => toast(t('errors.generic'), 'error'),
  });

  const max = Math.max(1, ...(stats.data?.revenue7d.map((d) => d.amount) ?? [1]));
  const kpis = stats.data
    ? [
        { label: t('pro.kpi.revenueToday'), value: fmt.money(stats.data.revenueToday) },
        { label: t('pro.kpi.appointmentsToday'), value: String(stats.data.appointmentsToday) },
        { label: t('pro.kpi.newClients'), value: String(stats.data.newClients30d) },
        { label: t('pro.kpi.noShow'), value: `${stats.data.noShowRate30d.toLocaleString()} %` },
      ]
    : null;
  const visible = (list.data ?? []).filter((a) => a.status !== 'cancelled');

  return (
    <>
      <PageHeader title={t('pro.today.title', { name: '' }).trim()} subtitle={fmt.day(today, { weekday: 'long', day: 'numeric', month: 'long' })} action={<ButtonLink to="/business/calendar" variant="secondary" size="sm"><CalendarDays className="h-4 w-4" strokeWidth={1.75} aria-hidden />{t('pro.nav.calendar')}</ButtonLink>} />

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label={t('pro.kpi.label')}>
        {kpis
          ? kpis.map((k) => (
              <div key={k.label} className="card p-4">
                <p className="text-sm text-stone">{k.label}</p>
                <p className="mt-1 font-display text-xl font-semibold tabular-nums">{k.value}</p>
              </div>
            ))
          : [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[84px]" />)}
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_340px]">
        <section aria-labelledby="today-list">
          <h2 id="today-list" className="text-lg">{t('pro.today.list')}</h2>
          <div className="mt-3">
            {list.isPending ? (
              <ListSkeleton />
            ) : list.isError ? (
              <ErrorState onRetry={() => list.refetch()} />
            ) : visible.length === 0 ? (
              <div className="card"><EmptyState icon={<CalendarDays strokeWidth={1.75} />} title={t('pro.today.empty')} body={t('pro.today.emptyBody')} /></div>
            ) : (
              <ul className="card divide-y divide-sand">
                {visible.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center gap-3 p-4">
                    <div className="w-14 shrink-0 text-center">
                      <p className="font-bold tabular-nums">{fmt.time(a.startsAt, tz)}</p>
                      <p className="text-xs text-stone">{fmt.duration((Date.parse(a.endsAt) - Date.parse(a.startsAt)) / 60000)}</p>
                    </div>
                    <StaffAvatar name={a.staff?.name ?? '?'} color={a.staff?.color} size={36} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-bold">{a.client.firstName} {a.client.lastName}</p>
                      <p className="truncate text-sm text-stone">{a.services.map((s) => s.name).join(', ')} · {a.staff?.name}</p>
                      <div className="mt-1 flex flex-wrap gap-1.5"><StatusBadge status={a.status} /><PaymentBadge status={a.paymentStatus} /></div>
                    </div>
                    <div className="flex w-full gap-2 sm:w-auto">
                      {a.status === 'confirmed' && (
                        <Button size="sm" variant="secondary" icon={<LogIn className="h-4 w-4" strokeWidth={1.75} aria-hidden />} onClick={() => setStatus.mutate({ id: a.id, status: 'checked_in' })}>
                          {t('pro.actions.arrived')}
                        </Button>
                      )}
                      {(a.status === 'confirmed' || a.status === 'checked_in') && (
                        <>
                          <Button size="sm" variant="secondary" icon={<Check className="h-4 w-4" strokeWidth={1.75} aria-hidden />} onClick={() => setStatus.mutate({ id: a.id, status: 'completed' })}>
                            {t('pro.actions.done')}
                          </Button>
                          <Button size="sm" variant="ghost" className="text-danger" icon={<UserX className="h-4 w-4" strokeWidth={1.75} aria-hidden />} onClick={() => setStatus.mutate({ id: a.id, status: 'no_show' })}>
                            {t('pro.actions.noShow')}
                          </Button>
                        </>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section className="card h-fit p-4" aria-labelledby="rev7">
          <h2 id="rev7" className="font-sans text-base font-bold">{t('pro.today.revenue7d')}</h2>
          {stats.data ? (
            <>
              <p className="mt-1 text-sm text-stone">{fmt.money(stats.data.revenue7d.reduce((s, d) => s + d.amount, 0))}</p>
              <div className="mt-4 flex h-36 items-end gap-2" role="img" aria-label={t('pro.today.revenueChartAria')}>
                {stats.data.revenue7d.map((d) => (
                  <div key={d.date} className="flex flex-1 flex-col items-center gap-1" title={`${d.date} · ${fmt.money(d.amount)}`}>
                    <div className={d.date === today ? 'w-full rounded-t-sm bg-terracotta' : 'w-full rounded-t-sm bg-terracotta/35'} style={{ height: Math.max(3, Math.round((d.amount / max) * 112)) }} />
                    <span className="text-xs text-stone">{fmt.day(d.date, { weekday: 'narrow' })}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <Skeleton className="mt-4 h-36" />
          )}
        </section>
      </div>
    </>
  );
}
