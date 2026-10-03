import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ListChecks } from 'lucide-react';
import { useApp } from '@/app/AppContext';
import type { AppointmentStatus, AppointmentView } from '@/lib/types';
import { addDays, todayIn, zonedToUtc } from '@/lib/time';
import { useFormat } from '@/hooks/useFormat';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { Chip } from '@/components/ui/Chip';
import { PaymentBadge, StatusBadge } from '@/components/ui/Badge';
import { EmptyState, ErrorState } from '@/components/ui/EmptyState';
import { ListSkeleton } from '@/components/ui/Skeleton';
import { TextField } from '@/components/ui/Field';
import { useBusiness } from './BusinessContext';
import { PageHeader } from './BusinessLayout';
import { AppointmentSheet } from './AppointmentSheets';

const STATUSES: (AppointmentStatus | null)[] = [null, 'confirmed', 'checked_in', 'completed', 'cancelled', 'no_show'];

export default function Bookings() {
  const { t } = useTranslation();
  const fmt = useFormat();
  const { api } = useApp();
  const { business, tz } = useBusiness();
  useDocumentTitle(t('pro.nav.bookings'));
  const today = todayIn(tz);
  const [from, setFrom] = useState(addDays(today, -7));
  const [to, setTo] = useState(addDays(today, 14));
  const [status, setStatus] = useState<AppointmentStatus | null>(null);
  const [selected, setSelected] = useState<AppointmentView | null>(null);
  const q = useQuery({
    queryKey: ['pro', 'appointments', business.id, 'list', from, to, status],
    queryFn: () => api.listAppointments({ businessId: business.id, from: zonedToUtc(from, '00:00', tz).toISOString(), to: zonedToUtc(addDays(to, 1), '00:00', tz).toISOString(), status }),
  });

  return (
    <>
      <PageHeader title={t('pro.nav.bookings')} subtitle={q.data ? t('pro.bookings.count', { count: q.data.length }) : undefined} />
      <div className="grid grid-cols-2 gap-3 sm:max-w-md">
        <TextField label={t('pro.bookings.from')} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <TextField label={t('pro.bookings.to')} type="date" value={to} onChange={(e) => setTo(e.target.value)} />
      </div>
      <div className="no-scrollbar -mx-4 mt-4 flex gap-2 overflow-x-auto px-4" role="toolbar" aria-label={t('pro.bookings.filter')}>
        {STATUSES.map((s) => (
          <Chip key={s ?? 'all'} active={status === s} onClick={() => setStatus(s)}>{s ? t(`status.${s}`) : t('pro.bookings.all')}</Chip>
        ))}
      </div>
      <div className="mt-4">
        {q.isPending ? (
          <ListSkeleton rows={6} />
        ) : q.isError ? (
          <ErrorState onRetry={() => q.refetch()} />
        ) : q.data.length === 0 ? (
          <div className="card"><EmptyState icon={<ListChecks strokeWidth={1.75} />} title={t('pro.bookings.empty')} /></div>
        ) : (
          <div className="card overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="border-b border-sand text-stone">
                <tr>
                  <th className="px-4 py-3 font-medium">{t('pro.bookings.date')}</th>
                  <th className="px-4 py-3 font-medium">{t('pro.calendar.client')}</th>
                  <th className="px-4 py-3 font-medium">{t('pro.calendar.services')}</th>
                  <th className="px-4 py-3 font-medium">{t('pro.calendar.staff')}</th>
                  <th className="px-4 py-3 font-medium">{t('booking.total')}</th>
                  <th className="px-4 py-3 font-medium">{t('pro.bookings.status')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-sand">
                {q.data.map((a) => (
                  <tr key={a.id} className="cursor-pointer hover:bg-sand-light" onClick={() => setSelected(a)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setSelected(a)}>
                    <td className="whitespace-nowrap px-4 py-3 first-letter:uppercase">{fmt.shortDate(a.startsAt, tz)} · {fmt.time(a.startsAt, tz)}</td>
                    <td className="px-4 py-3 font-medium">{a.client.firstName} {a.client.lastName}</td>
                    <td className="max-w-[200px] truncate px-4 py-3">{a.services.map((s) => s.name).join(', ')}</td>
                    <td className="px-4 py-3">{a.staff?.name}</td>
                    <td className="whitespace-nowrap px-4 py-3 tabular-nums">{fmt.money(a.total)}</td>
                    <td className="px-4 py-3"><div className="flex flex-wrap gap-1"><StatusBadge status={a.status} /><PaymentBadge status={a.paymentStatus} /></div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <AppointmentSheet appointment={selected} onClose={() => setSelected(null)} />
    </>
  );
}
