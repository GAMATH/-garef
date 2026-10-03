import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import clsx from 'clsx';
import { useApp } from '@/app/AppContext';
import { ApiError } from '@/data/api';
import type { AppointmentView, PaymentStatus, Staff } from '@/lib/types';
import { addDays, minutesToTime, timeToMinutes, todayIn, weekdayOf, zonedParts, zonedToUtc } from '@/lib/time';
import { useFormat } from '@/hooks/useFormat';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { Button, IconButton } from '@/components/ui/Button';
import { StaffAvatar } from '@/components/ui/StaffAvatar';
import { ErrorState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { useBusiness } from './BusinessContext';
import { AppointmentSheet, CreateAppointmentSheet } from './AppointmentSheets';

const ROW = 16; // px per 15 minutes
const STEP = 15;
const PAY_DOT: Record<PaymentStatus, string> = {
  paid: 'bg-forest',
  deposit_paid: 'bg-gold',
  pay_on_site: 'bg-stone/50',
  pending: 'bg-gold',
  failed: 'bg-danger',
  refunded: 'bg-stone/30',
};

export default function Calendar() {
  const { t } = useTranslation();
  const fmt = useFormat();
  const { api } = useApp();
  const { business, bundle, tz } = useBusiness();
  const qc = useQueryClient();
  const toast = useToast();
  useDocumentTitle(t('pro.nav.calendar'));
  const [view, setView] = useState<'day' | 'week'>('day');
  const [date, setDate] = useState(() => todayIn(tz));
  const [selected, setSelected] = useState<AppointmentView | null>(null);
  const [create, setCreate] = useState<{ staffId: string; start: string } | null>(null);

  const weekStart = addDays(date, -((weekdayOf(date) + 6) % 7)); // Monday
  const from = view === 'day' ? date : weekStart;
  const days = view === 'day' ? [date] : Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const range = { from: zonedToUtc(from, '00:00', tz).toISOString(), to: zonedToUtc(addDays(from, days.length), '00:00', tz).toISOString() };
  const q = useQuery({
    queryKey: ['pro', 'appointments', business.id, view, from],
    queryFn: () => api.listAppointments({ businessId: business.id, ...range }),
    enabled: !!bundle,
    refetchInterval: 60_000,
  });
  const appts = (q.data ?? []).filter((a) => a.status !== 'cancelled');
  const staff = bundle?.staff ?? [];

  // Visible time axis: union of opening hours (and any booking outside them).
  const [axisStart, axisEnd] = useMemo(() => {
    const hours = bundle?.hours ?? [];
    let s = hours.length ? Math.min(...hours.map((h) => timeToMinutes(h.opens))) : 8 * 60;
    let e = hours.length ? Math.max(...hours.map((h) => timeToMinutes(h.closes))) : 20 * 60;
    for (const a of appts) {
      const m = localMin(a.startsAt, tz);
      s = Math.min(s, m);
      e = Math.max(e, m + durationMin(a));
    }
    return [Math.floor(s / 60) * 60, Math.min(24 * 60, Math.ceil(e / 60) * 60)];
  }, [bundle?.hours, appts, tz]);
  const slots = (axisEnd - axisStart) / STEP;

  const move = useMutation({
    mutationFn: (v: { id: string; start: string; staffId: string }) => api.moveAppointment(v.id, v.start, v.staffId),
    onSuccess: () => toast(t('pro.calendar.moved')),
    onError: (e) => toast(e instanceof ApiError && e.code === 'SLOT_TAKEN' ? t('pro.calendar.conflict') : t('errors.generic'), 'error'),
    onSettled: () => qc.invalidateQueries({ queryKey: ['pro'] }),
  });

  /* ---------------- drag & drop (pointer events: mouse, pen, touch) ---------------- */
  const columnsRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ id: string; x: number; y: number; col: number; started: boolean } | null>(null);
  const [drag, setDrag] = useState<{ id: string; col: number; dSlots: number } | null>(null);

  const colAt = (clientX: number) => {
    const cols = columnsRef.current?.querySelectorAll<HTMLElement>('[data-col]') ?? [];
    for (const el of cols) {
      const r = el.getBoundingClientRect();
      if (clientX >= r.left && clientX < r.right) return Number(el.dataset.col);
    }
    return null;
  };

  const onBlockDown = (e: ReactPointerEvent, a: AppointmentView, col: number) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { id: a.id, x: e.clientX, y: e.clientY, col, started: false };
  };
  const onBlockMove = (e: ReactPointerEvent, a: AppointmentView) => {
    const d = dragRef.current;
    if (!d || d.id !== a.id) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.started && Math.hypot(dx, dy) < 6) return;
    if (!['confirmed', 'checked_in'].includes(a.status)) return;
    d.started = true;
    const col = view === 'day' ? colAt(e.clientX) ?? d.col : d.col;
    setDrag({ id: a.id, col, dSlots: Math.round(dy / ROW) });
  };
  const onBlockUp = (a: AppointmentView, col: number) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d) return;
    if (!d.started || !drag) {
      setDrag(null);
      setSelected(a);
      return;
    }
    const newMin = localMin(a.startsAt, tz) + drag.dSlots * STEP;
    const day = view === 'day' ? date : zonedParts(a.startsAt, tz).date;
    const staffId = view === 'day' ? staff[drag.col]?.id ?? a.staffId : a.staffId;
    setDrag(null);
    if (drag.dSlots === 0 && drag.col === col) return;
    if (newMin < 0 || newMin + durationMin(a) > 24 * 60) return;
    move.mutate({ id: a.id, start: zonedToUtc(day, minutesToTime(newMin), tz).toISOString(), staffId });
  };

  const onEmptyClick = (e: React.MouseEvent<HTMLDivElement>, day: string, staffId: string) => {
    const r = e.currentTarget.getBoundingClientRect();
    const m = axisStart + Math.floor((e.clientY - r.top) / ROW) * STEP;
    setCreate({ staffId, start: zonedToUtc(day, minutesToTime(m), tz).toISOString() });
  };

  const columns: { key: string; label: React.ReactNode; day: string; staff: Staff | null; items: AppointmentView[] }[] =
    view === 'day'
      ? staff.map((s) => ({ key: s.id, day: date, staff: s, label: <><StaffAvatar name={s.name} color={s.color} size={28} /><span className="truncate">{s.name}</span></>, items: appts.filter((a) => a.staffId === s.id) }))
      : days.map((d) => ({
          key: d,
          day: d,
          staff: null,
          label: <span className={clsx('inline-block first-letter:uppercase', d === todayIn(tz) && 'text-terracotta')}>{fmt.day(d, { weekday: 'short', day: 'numeric' })}</span>,
          items: appts.filter((a) => zonedParts(a.startsAt, tz).date === d),
        }));

  const closedBands = (day: string) => {
    const h = bundle?.hours.find((x) => x.weekday === weekdayOf(day));
    if (!h) return [[axisStart, axisEnd]];
    const bands: number[][] = [];
    if (timeToMinutes(h.opens) > axisStart) bands.push([axisStart, timeToMinutes(h.opens)]);
    if (h.breakStart && h.breakEnd) bands.push([timeToMinutes(h.breakStart), timeToMinutes(h.breakEnd)]);
    if (timeToMinutes(h.closes) < axisEnd) bands.push([timeToMinutes(h.closes), axisEnd]);
    return bands;
  };

  const label = view === 'day' ? fmt.day(date, { weekday: 'long', day: 'numeric', month: 'long' }) : `${fmt.day(weekStart, { day: 'numeric', month: 'short' })} – ${fmt.day(addDays(weekStart, 6), { day: 'numeric', month: 'short' })}`;
  const nowMin = localMin(new Date().toISOString(), tz);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex items-center">
          <IconButton label={t('pro.calendar.prev')} onClick={() => setDate(addDays(date, view === 'day' ? -1 : -7))}><ChevronLeft className="h-5 w-5" strokeWidth={1.75} /></IconButton>
          <IconButton label={t('pro.calendar.next')} onClick={() => setDate(addDays(date, view === 'day' ? 1 : 7))}><ChevronRight className="h-5 w-5" strokeWidth={1.75} /></IconButton>
        </div>
        <h1 className="min-w-0 flex-1 truncate font-sans text-lg font-bold first-letter:uppercase">{label}</h1>
        <Button size="sm" variant="secondary" onClick={() => setDate(todayIn(tz))}>{t('pro.calendar.today')}</Button>
        <div className="inline-flex rounded-full border border-sand bg-surface p-1" role="tablist" aria-label={t('pro.calendar.view')}>
          {(['day', 'week'] as const).map((v) => (
            <button key={v} role="tab" aria-selected={view === v} onClick={() => setView(v)} className={clsx('min-h-[32px] rounded-full px-3 text-sm font-medium', view === v ? 'bg-ink text-ivory' : '')}>
              {t(`pro.calendar.${v}`)}
            </button>
          ))}
        </div>
        <Button size="sm" icon={<Plus className="h-4 w-4" strokeWidth={2} aria-hidden />} onClick={() => staff[0] && setCreate({ staffId: staff[0].id, start: zonedToUtc(date, minutesToTime(Math.max(axisStart, Math.ceil(nowMin / STEP) * STEP)), tz).toISOString() })}>
          {t('pro.calendar.new')}
        </Button>
      </div>

      {q.isError ? (
        <ErrorState onRetry={() => q.refetch()} />
      ) : !bundle || q.isPending ? (
        <Skeleton className="h-[480px] w-full" />
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <div className="min-w-max" ref={columnsRef}>
              {/* header */}
              <div className="sticky top-0 z-10 flex border-b border-sand bg-surface">
                <div className="w-12 shrink-0" />
                {columns.map((c, i) => (
                  <div key={c.key} className={clsx('flex min-w-[132px] flex-1 items-center gap-2 border-l border-sand px-2 py-2 text-sm font-bold', view === 'week' && 'min-w-[110px] justify-center')} data-col-header={i}>
                    {c.label}
                  </div>
                ))}
              </div>
              {/* grid */}
              <div className="relative flex" style={{ height: slots * ROW }}>
                <div className="w-12 shrink-0">
                  {Array.from({ length: (axisEnd - axisStart) / 60 }, (_, h) => (
                    <div key={h} className="relative border-t border-sand/0 text-right" style={{ height: ROW * 4 }}>
                      <span className="absolute -top-2 right-1.5 text-xs tabular-nums text-stone">{minutesToTime(axisStart + h * 60)}</span>
                    </div>
                  ))}
                </div>
                {columns.map((c, colIndex) => (
                  <div
                    key={c.key}
                    data-col={colIndex}
                    className="relative min-w-[132px] flex-1 border-l border-sand"
                    style={view === 'week' ? { minWidth: 110 } : undefined}
                    onClick={(e) => { if (e.target === e.currentTarget) onEmptyClick(e, c.day, c.staff?.id ?? staff[0]?.id); }}
                    role="presentation"
                  >
                    {/* hour lines */}
                    {Array.from({ length: (axisEnd - axisStart) / 60 }, (_, h) => (
                      <div key={h} className="pointer-events-none absolute inset-x-0 border-t border-sand/70" style={{ top: h * ROW * 4 }} />
                    ))}
                    {/* closed hours */}
                    {closedBands(c.day).map(([s, e]) => (
                      <div key={s} className="pointer-events-none absolute inset-x-0 bg-[repeating-linear-gradient(135deg,#F2EDE5_0,#F2EDE5_6px,#FAF7F2_6px,#FAF7F2_12px)]" style={{ top: ((s - axisStart) / STEP) * ROW, height: ((e - s) / STEP) * ROW }} />
                    ))}
                    {/* now line */}
                    {c.day === todayIn(tz) && nowMin >= axisStart && nowMin <= axisEnd && (
                      <div className="pointer-events-none absolute inset-x-0 z-[5] border-t-2 border-terracotta" style={{ top: ((nowMin - axisStart) / STEP) * ROW }} aria-hidden />
                    )}
                    {/* appointments (with drag preview applied) */}
                    {[...c.items.filter((a) => !(drag && drag.id === a.id && view === 'day' && drag.col !== colIndex)), ...(drag && view === 'day' && drag.col === colIndex ? appts.filter((a) => a.id === drag.id && a.staffId !== c.staff?.id) : [])].map((a) => {
                      const dragging = drag?.id === a.id;
                      const top = ((localMin(a.startsAt, tz) - axisStart) / STEP + (dragging ? drag.dSlots : 0)) * ROW;
                      const height = Math.max(ROW * 2, (durationMin(a) / STEP) * ROW) - 2;
                      const color = a.staff?.color ?? '#C4532D';
                      const pending = a.status === 'pending_payment';
                      return (
                        <button
                          key={a.id}
                          type="button"
                          onPointerDown={(e) => onBlockDown(e, a, colIndex)}
                          onPointerMove={(e) => onBlockMove(e, a)}
                          onPointerUp={() => onBlockUp(a, colIndex)}
                          onPointerCancel={() => { dragRef.current = null; setDrag(null); }}
                          onKeyDown={(e) => e.key === 'Enter' && setSelected(a)}
                          className={clsx(
                            'absolute inset-x-1 z-[6] flex touch-none select-none flex-col justify-start overflow-hidden rounded-sm border-l-[3px] px-1.5 py-1 text-left text-xs leading-tight transition-shadow duration-150',
                            pending ? 'border border-dashed bg-surface' : '',
                            dragging ? 'z-20 cursor-grabbing shadow-soft ring-2 ring-terracotta' : 'cursor-grab hover:shadow-soft',
                            a.status === 'completed' && 'opacity-70',
                            a.status === 'no_show' && 'opacity-50 line-through',
                          )}
                          style={{ top, height, borderLeftColor: color, background: pending ? undefined : `${color}1F` }}
                          aria-label={t('pro.calendar.blockAria', { client: a.client.firstName, service: a.services.map((s) => s.name).join(', '), time: fmt.time(a.startsAt, tz), staff: a.staff?.name ?? '' })}
                        >
                          <span className="flex items-center gap-1">
                            <span className={clsx('h-2 w-2 shrink-0 rounded-full', PAY_DOT[a.paymentStatus])} aria-hidden />
                            <span className="truncate font-bold">{a.client.firstName} {a.client.lastName.charAt(0)}</span>
                          </span>
                          <span className="block truncate text-stone">{fmt.time(a.startsAt, tz)} · {a.services.map((s) => s.name).join(', ')}</span>
                          {view === 'week' && <span className="block truncate text-stone">{a.staff?.name}</span>}
                          {pending && <span className="block truncate font-bold text-gold-ink">{t('status.pending_payment')}</span>}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-sand px-4 py-2 text-xs text-stone">
            {(['paid', 'deposit_paid', 'pay_on_site'] as PaymentStatus[]).map((p) => (
              <span key={p} className="inline-flex items-center gap-1.5"><span className={clsx('h-2 w-2 rounded-full', PAY_DOT[p])} />{t(`paymentStatus.${p}`)}</span>
            ))}
            <span className="ml-auto hidden sm:inline">{t('pro.calendar.hint')}</span>
          </div>
        </div>
      )}

      <AppointmentSheet appointment={selected} onClose={() => setSelected(null)} />
      {create && <CreateAppointmentSheet initial={create} onClose={() => setCreate(null)} />}
    </>
  );
}

function localMin(iso: string, tz: string) {
  const p = zonedParts(iso, tz);
  return p.hour * 60 + p.minute;
}
function durationMin(a: { startsAt: string; endsAt: string }) {
  return (Date.parse(a.endsAt) - Date.parse(a.startsAt)) / 60000;
}
