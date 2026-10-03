import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Trash2 } from 'lucide-react';
import { useApp } from '@/app/AppContext';
import type { BusinessHours } from '@/lib/types';
import { addDays, todayIn, zonedToUtc } from '@/lib/time';
import { useFormat } from '@/hooks/useFormat';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { Button, IconButton } from '@/components/ui/Button';
import { TextField } from '@/components/ui/Field';
import { ListSkeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { useBusiness } from './BusinessContext';
import { PageHeader } from './BusinessLayout';

type Row = Omit<BusinessHours, 'businessId'>;
const WEEK = [1, 2, 3, 4, 5, 6, 0];

export function HoursEditor({ hours, onChange }: { hours: Row[]; onChange: (h: Row[]) => void }) {
  const { t } = useTranslation();
  const set = (wd: number, p: Partial<Row>) => onChange(hours.map((h) => (h.weekday === wd ? { ...h, ...p } : h)));
  return (
    <ul className="divide-y divide-sand">
      {WEEK.map((wd) => {
        const h = hours.find((x) => x.weekday === wd);
        return (
          <li key={wd} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
            <label className="flex w-32 items-center gap-2 font-medium capitalize">
              <input type="checkbox" className="h-5 w-5 accent-terracotta" checked={!!h} onChange={() => onChange(h ? hours.filter((x) => x.weekday !== wd) : [...hours, { weekday: wd, opens: '09:00', closes: '19:00', breakStart: null, breakEnd: null }])} />
              {t(`weekdays.${wd}` as never)}
            </label>
            {h ? (
              <>
                <div className="flex items-center gap-2">
                  <input type="time" step={900} aria-label={`${t(`weekdays.${wd}` as never)} ${t('pro.hours.opens')}`} className="field min-h-[40px] w-28 px-2" value={h.opens} onChange={(e) => set(wd, { opens: e.target.value })} />
                  <span aria-hidden>–</span>
                  <input type="time" step={900} aria-label={`${t(`weekdays.${wd}` as never)} ${t('pro.hours.closes')}`} className="field min-h-[40px] w-28 px-2" value={h.closes} onChange={(e) => set(wd, { closes: e.target.value })} />
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" className="h-4 w-4 accent-terracotta" checked={!!h.breakStart} onChange={(e) => set(wd, e.target.checked ? { breakStart: '13:00', breakEnd: '14:00' } : { breakStart: null, breakEnd: null })} />
                  {t('pro.hours.break')}
                </label>
                {h.breakStart && (
                  <div className="flex items-center gap-2">
                    <input type="time" step={900} aria-label={t('pro.hours.breakStart')} className="field min-h-[40px] w-28 px-2" value={h.breakStart} onChange={(e) => set(wd, { breakStart: e.target.value })} />
                    <span aria-hidden>–</span>
                    <input type="time" step={900} aria-label={t('pro.hours.breakEnd')} className="field min-h-[40px] w-28 px-2" value={h.breakEnd ?? ''} onChange={(e) => set(wd, { breakEnd: e.target.value })} />
                  </div>
                )}
              </>
            ) : (
              <span className="text-sm text-stone">{t('salon.closedDay')}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function validHours(hours: Row[]) {
  return hours.every((h) => h.closes > h.opens && (!h.breakStart || (h.breakEnd && h.breakStart >= h.opens && h.breakEnd <= h.closes && h.breakEnd > h.breakStart)));
}

export default function Hours() {
  const { t } = useTranslation();
  const fmt = useFormat();
  const { api } = useApp();
  const { business, bundle, tz } = useBusiness();
  const qc = useQueryClient();
  const toast = useToast();
  useDocumentTitle(t('pro.nav.hours'));
  const [hours, setHours] = useState<Row[] | null>(null);
  useEffect(() => {
    if (bundle && !hours) setHours(bundle.hours.map(({ businessId: _b, ...h }) => h));
  }, [bundle, hours]);
  const today = todayIn(tz);
  const [closure, setClosure] = useState({ from: today, to: today, reason: '' });
  const save = useMutation({
    mutationFn: () => api.saveHours(business.id, hours!),
    onSuccess: () => { toast(t('pro.hours.saved')); void qc.invalidateQueries({ queryKey: ['pro'] }); void qc.invalidateQueries({ queryKey: ['salon'] }); void qc.invalidateQueries({ queryKey: ['slots'] }); void qc.invalidateQueries({ queryKey: ['days'] }); },
    onError: () => toast(t('errors.generic'), 'error'),
  });
  const addClosure = useMutation({
    mutationFn: () => api.addTimeOff({ businessId: business.id, staffId: null, startsAt: zonedToUtc(closure.from, '00:00', tz).toISOString(), endsAt: zonedToUtc(addDays(closure.to, 1), '00:00', tz).toISOString(), reason: closure.reason }),
    onSuccess: () => { toast(t('pro.hours.closureAdded')); void qc.invalidateQueries({ queryKey: ['pro'] }); },
  });
  const removeClosure = useMutation({ mutationFn: (id: string) => api.deleteTimeOff(id), onSuccess: () => void qc.invalidateQueries({ queryKey: ['pro'] }) });
  if (!bundle || !hours) return <ListSkeleton rows={7} />;
  const closures = bundle.timeOff.filter((x) => x.staffId === null && Date.parse(x.endsAt) > Date.now());

  return (
    <>
      <PageHeader title={t('pro.nav.hours')} subtitle={t('pro.hours.subtitle')} />
      <section className="card p-4">
        <HoursEditor hours={hours} onChange={setHours} />
        <div className="mt-4 flex items-center gap-3">
          <Button loading={save.isPending} disabled={!validHours(hours)} onClick={() => save.mutate()}>{t('common.save')}</Button>
          {!validHours(hours) && <p className="text-sm text-danger">{t('pro.hours.invalid')}</p>}
        </div>
      </section>
      <section className="card mt-6 p-4" aria-labelledby="closures">
        <h2 id="closures" className="font-sans text-base font-bold">{t('pro.hours.closures')}</h2>
        <p className="mt-1 text-sm text-stone">{t('pro.hours.closuresHint')}</p>
        {closures.length > 0 && (
          <ul className="mt-3 space-y-2">
            {closures.map((c) => (
              <li key={c.id} className="flex items-center justify-between rounded-card bg-sand-light px-3 py-2 text-sm">
                <span className="inline-block first-letter:uppercase">{fmt.shortDate(c.startsAt, tz)} → {fmt.shortDate(new Date(Date.parse(c.endsAt) - 1).toISOString(), tz)}{c.reason ? ` · ${c.reason}` : ''}</span>
                <IconButton label={t('common.delete')} onClick={() => removeClosure.mutate(c.id)}><Trash2 className="h-4 w-4" strokeWidth={1.75} /></IconButton>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_2fr_auto] sm:items-end">
          <TextField label={t('pro.bookings.from')} type="date" value={closure.from} onChange={(e) => setClosure({ ...closure, from: e.target.value })} />
          <TextField label={t('pro.bookings.to')} type="date" value={closure.to} onChange={(e) => setClosure({ ...closure, to: e.target.value })} />
          <TextField label={t('pro.team.reasonOptional')} value={closure.reason} onChange={(e) => setClosure({ ...closure, reason: e.target.value })} />
          <Button variant="secondary" loading={addClosure.isPending} onClick={() => addClosure.mutate()}>{t('common.add')}</Button>
        </div>
      </section>
    </>
  );
}
