import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useApp } from '@/app/AppContext';
import type { Business } from '@/lib/types';
import { useToast } from '@/components/ui/Toast';
import { useFormat } from '@/hooks/useFormat';

type Bundle = Awaited<ReturnType<ReturnType<typeof useApp>['api']['getBusinessBundle']>>;
interface Value {
  business: Business;
  bundle: Bundle | undefined;
  tz: string;
  refresh: () => void;
}
const Ctx = createContext<Value | null>(null);

export function BusinessProvider({ business, children }: { business: Business; children: ReactNode }) {
  const { api } = useApp();
  const qc = useQueryClient();
  const toast = useToast();
  const { t } = useTranslation();
  const fmt = useFormat();
  const bundle = useQuery({ queryKey: ['pro', 'bundle', business.id], queryFn: () => api.getBusinessBundle(business.id) });
  const tz = bundle.data?.city.timezone ?? 'UTC';

  // Realtime: every new/updated booking refreshes the agenda instantly, new online bookings toast.
  useEffect(() => {
    const notified = new Set<string>();
    return api.subscribeAppointments(business.id, (e) => {
      void qc.invalidateQueries({ queryKey: ['pro', 'appointments'] });
      void qc.invalidateQueries({ queryKey: ['pro', 'dashboard'] });
      // A confirmed online booking created minutes ago = a new client booking (holds appear silently, dashed).
      const a = e.appointment;
      if (a.source === 'online' && a.status === 'confirmed' && Date.now() - Date.parse(a.createdAt) < 15 * 60000 && !notified.has(a.id)) {
        notified.add(a.id);
        toast(t('pro.realtime.newBooking', { time: fmt.time(a.startsAt, tz), date: fmt.shortDate(a.startsAt, tz) }));
      }
    });
  }, [api, business.id, qc, toast, t, fmt, tz]);

  return (
    <Ctx.Provider value={{ business: bundle.data?.business ?? business, bundle: bundle.data, tz, refresh: () => void qc.invalidateQueries({ queryKey: ['pro'] }) }}>
      {children}
    </Ctx.Provider>
  );
}

export function useBusiness() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useBusiness outside BusinessProvider');
  return v;
}
