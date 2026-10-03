import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { ArrowLeft, Check, ChevronDown, Clock, CreditCard, Smartphone, Store, Timer } from 'lucide-react';
import clsx from 'clsx';
import { useApp } from '@/app/AppContext';
import { ApiError } from '@/data/api';
import type { Country, PaymentMethod, PaymentOperator, PaymentOption, SalonDetail, Slot } from '@/lib/types';
import { eligibleStaff } from '@/lib/booking-engine';
import { depositForServices } from '@/lib/money';
import { isValidNational, nationalNumber, toE164 } from '@/lib/phone';
import { todayIn, zonedParts } from '@/lib/time';
import { OPERATOR_LABELS } from '@/lib/payments';
import { usePersistentState } from '@/hooks/usePersistentState';
import { useFormat } from '@/hooks/useFormat';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { Button, IconButton } from '@/components/ui/Button';
import { Stepper } from '@/components/ui/Stepper';
import { ServiceRow } from '@/components/salon/ServiceRow';
import { StaffAvatar } from '@/components/ui/StaffAvatar';
import { DatePickerStrip } from '@/components/booking/DatePickerStrip';
import { TimeSlotGrid } from '@/components/booking/TimeSlotGrid';
import { TextField } from '@/components/ui/Field';
import { PhoneInput } from '@/components/ui/PhoneInput';
import { EmptyState, ErrorState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';

type Step = 0 | 1 | 2 | 3 | 4;
interface Draft {
  serviceIds: string[];
  staffId: string | null;
  date: string | null;
  start: string | null;
  firstName: string;
  phone: string; // national digits
  lastName: string;
  email: string;
  step: Step;
  holdId: string | null;
  holdExpiresAt: string | null;
  holdStaffId: string | null;
}
const EMPTY: Draft = { serviceIds: [], staffId: null, date: null, start: null, firstName: '', phone: '', lastName: '', email: '', step: 0, holdId: null, holdExpiresAt: null, holdStaffId: null };

export default function Booking() {
  const { slug = '' } = useParams();
  const [sp] = useSearchParams();
  const { t } = useTranslation();
  const { api, profile } = useApp();
  const salonQ = useQuery({ queryKey: ['salon', slug], queryFn: () => api.getSalon(slug) });
  useDocumentTitle(salonQ.data ? t('booking.metaTitle', { salon: salonQ.data.business.name }) : t('common.book'));

  if (salonQ.isPending)
    return (
      <div className="container-app max-w-xl space-y-4 py-6" aria-busy="true">
        <Skeleton className="h-6 w-1/2" />
        <Skeleton className="h-1 w-full" />
        {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-20" />)}
      </div>
    );
  if (salonQ.isError) return <ErrorState onRetry={() => salonQ.refetch()} />;
  return <Funnel key={slug} salon={salonQ.data} params={sp} loggedIn={!!profile?.phone} />;
}

function Funnel({ salon, params, loggedIn }: { salon: SalonDetail; params: URLSearchParams; loggedIn: boolean }) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const { api, profile } = useApp();
  const { business: b, city, country } = salon;
  const tz = city.timezone;
  const rescheduleId = params.get('reschedule');

  const [draft, setDraft, clearDraft] = usePersistentState<Draft>(`kuzuri-booking:${b.slug}${rescheduleId ? ':r' : ''}`, EMPTY);
  const patch = (p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p }));
  const [alternatives, setAlternatives] = useState<Slot[] | null>(null);

  // Deep links: ?services=a,b (salon page) · ?service=X&start=ISO (next-slot chip) · ?reschedule=ID
  const resched = useQuery({
    queryKey: ['me', 'appointments', profile?.id],
    queryFn: () => api.listMyAppointments(profile!.id),
    enabled: !!rescheduleId && !!profile,
    select: (list) => list.find((a) => a.id === rescheduleId) ?? null,
  });
  const initialised = useRef(false);
  useEffect(() => {
    if (initialised.current) return;
    if (rescheduleId) {
      if (!resched.data) return;
      initialised.current = true;
      setDraft({ ...EMPTY, serviceIds: resched.data.services.map((s) => s.serviceId), staffId: null, step: 1 });
      return;
    }
    initialised.current = true;
    const svc = params.get('services')?.split(',').filter((id) => salon.services.some((s) => s.id === id));
    const one = params.get('service');
    const start = params.get('start');
    const base: Partial<Draft> = loggedIn ? { firstName: profile!.firstName, phone: nationalNumber(profile!.phone, country) } : {};
    if (one && start && salon.services.some((s) => s.id === one)) {
      setDraft((d) => ({ ...EMPTY, ...pickContact(d), ...base, serviceIds: [one], staffId: null, date: zonedParts(start, tz).date, start, step: 3 }));
    } else if (svc?.length) {
      setDraft((d) => ({ ...EMPTY, ...pickContact(d), ...base, serviceIds: svc, step: 1 }));
    } else if (!draft.serviceIds.length) {
      setDraft((d) => ({ ...d, ...base, step: 0 }));
    } else if (base.firstName) {
      patch(base);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resched.data]);

  const services = salon.services.filter((s) => draft.serviceIds.includes(s.id));
  const total = services.reduce((s, x) => s + x.price, 0);
  const duration = services.reduce((s, x) => s + x.durationMin, 0);
  const deposit = depositForServices(services, b.depositRule);
  const eligible = eligibleStaff(salon.staff, salon.staffServices, draft.serviceIds).map((id) => salon.staff.find((s) => s.id === id)!);
  const query = { businessId: b.id, serviceIds: draft.serviceIds, staffId: draft.staffId, excludeAppointmentId: rescheduleId ?? undefined };
  const skipContact = loggedIn;
  const steps: Step[] = rescheduleId ? [1, 2] : skipContact ? [0, 1, 2, 4] : [0, 1, 2, 3, 4];
  const stepIndex = Math.max(0, steps.indexOf(draft.step));

  // Never keep an orphan hold when leaving the payment step.
  const releaseHold = async () => {
    if (draft.holdId) {
      const id = draft.holdId;
      patch({ holdId: null });
      await api.releaseHold(id).catch(() => undefined);
    }
  };

  const goBack = async () => {
    if (draft.step === 4) await releaseHold();
    const prev = steps[stepIndex - 1];
    if (prev === undefined) navigate(rescheduleId ? '/account/appointments' : `/salon/${b.slug}`);
    else patch({ step: prev });
  };

  // Hold creation (entering the payment step).
  const hold = useMutation({
    mutationFn: () =>
      api.createHold({
        ...query,
        start: draft.start!,
        profileId: profile?.id ?? null,
        contact: { firstName: draft.firstName.trim(), lastName: draft.lastName.trim(), phone: toE164(draft.phone, country), email: draft.email.trim() },
      }),
    onSuccess: (a) => patch({ holdId: a.id, holdExpiresAt: a.holdExpiresAt, holdStaffId: a.staffId, step: 4 }),
    onError: (e) => onSlotError(e),
  });

  const onSlotError = (e: unknown) => {
    if (e instanceof ApiError && (e.code === 'SLOT_TAKEN' || e.code === 'HOLD_EXPIRED')) {
      setAlternatives(e.alternatives);
      patch({ start: null, holdId: null, step: 2 });
      void qc.invalidateQueries({ queryKey: ['slots'] });
      void qc.invalidateQueries({ queryKey: ['days'] });
      if (e.code === 'HOLD_EXPIRED') toast(t('booking.holdExpired'), 'error');
    } else if (e instanceof ApiError && e.code === 'RATE_LIMITED') {
      toast(t('errors.rateLimited'), 'error');
    } else {
      toast(t('errors.generic'), 'error');
    }
  };

  // Payment failed or hold expired: the slot is released, back to the time choice with a clear message.
  const backToTime = async (message: string, release: boolean) => {
    if (release) await releaseHold();
    setAlternatives(null);
    patch({ start: null, holdId: null, holdExpiresAt: null, holdStaffId: null, step: 2 });
    void qc.invalidateQueries({ queryKey: ['slots'] });
    void qc.invalidateQueries({ queryKey: ['days'] });
    toast(message, 'error');
  };

  const reschedule = useMutation({
    mutationFn: () => api.rescheduleAppointment(rescheduleId!, draft.start!, draft.staffId),
    onSuccess: () => {
      clearDraft();
      void qc.invalidateQueries({ queryKey: ['me'] });
      toast(t('booking.rescheduled'));
      navigate('/account/appointments');
    },
    onError: onSlotError,
  });

  const toContactOrHold = () => {
    if (rescheduleId) return reschedule.mutate();
    if (skipContact) return hold.mutate();
    patch({ step: 3 });
  };

  const selectSlot = (s: Slot) => {
    setAlternatives(null);
    patch({ start: s.start, date: zonedParts(s.start, tz).date });
    if (!rescheduleId) setTimeout(() => (skipContact ? hold.mutate() : patch({ step: 3 })), 180);
  };

  const done = (reference: string) => {
    clearDraft();
    void qc.invalidateQueries({ queryKey: ['search'] });
    void qc.invalidateQueries({ queryKey: ['me'] });
    navigate(`/booking/success/${reference}`, { replace: true });
  };

  const stepTitles: Record<Step, string> = {
    0: t('booking.steps.services'),
    1: t('booking.steps.staff'),
    2: t('booking.steps.datetime'),
    3: t('booking.steps.contact'),
    4: t('booking.steps.payment'),
  };

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 border-b border-sand/70 bg-ivory/95 backdrop-blur">
        <div className="container-app max-w-xl pb-3 pt-2">
          <div className="flex items-center gap-2">
            <IconButton label={t('common.back')} onClick={goBack} className="-ml-2">
              <ArrowLeft className="h-5 w-5" strokeWidth={1.75} />
            </IconButton>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium text-stone">{rescheduleId ? t('booking.rescheduleTitle') : b.name}</p>
              <h1 className="truncate font-sans text-lg font-bold">{stepTitles[draft.step]}</h1>
            </div>
            <span className="text-sm text-stone" aria-hidden>
              {stepIndex + 1}/{steps.length}
            </span>
          </div>
          <div className="mt-2">
            <Stepper steps={steps.length} current={stepIndex} label={t('booking.progress', { step: stepIndex + 1, total: steps.length })} />
          </div>
        </div>
      </header>

      <main className="container-app flex w-full max-w-xl flex-1 flex-col pb-32 pt-4" key={draft.step}>
        <div className="animate-fade-up">
          {draft.step === 0 && <ServicesStep salon={salon} selected={draft.serviceIds} onChange={(ids) => patch({ serviceIds: ids, start: null })} />}
          {draft.step === 1 && (
            <StaffStep
              staff={eligible}
              selected={draft.staffId}
              onSelect={(id) => {
                patch({ staffId: id, start: null, step: 2 });
              }}
            />
          )}
          {draft.step === 2 && (
            <DateTimeStep salon={salon} query={query} draft={draft} onDate={(date) => patch({ date, start: null })} onSlot={selectSlot} alternatives={alternatives} />
          )}
          {draft.step === 3 && <ContactStep draft={draft} country={country} onChange={patch} onSubmit={() => hold.mutate()} />}
          {draft.step === 4 && draft.holdId && (
            <PaymentStep
              salon={salon}
              draft={draft}
              total={total}
              deposit={deposit}
              duration={duration}
              onDone={done}
              onSlotError={onSlotError}
              onFailed={() => backToTime(t('booking.paymentFailed'), false)}
              onExpired={() => backToTime(t('booking.holdExpired'), true)}
            />
          )}
          {draft.step === 4 && !draft.holdId && (
            <EmptyState title={t('booking.holdLost')} action={<Button onClick={() => patch({ step: 2, start: null })}>{t('booking.pickAnotherTime')}</Button>} />
          )}
        </div>
      </main>

      {draft.step !== 4 && (
        <footer className="fixed inset-x-0 bottom-0 z-30 border-t border-sand bg-surface/95 backdrop-blur safe-bottom">
          <div className="container-app flex max-w-xl items-center gap-3 pt-3">
            <div className="min-w-0 flex-1 text-sm" aria-live="polite">
              {services.length ? (
                <>
                  <p className="font-bold">
                    {t('booking.servicesCount', { count: services.length })} · {fmt.money(total)}
                  </p>
                  <p className="truncate text-stone">
                    {draft.start ? `${fmt.shortDate(draft.start, tz)} · ${fmt.time(draft.start, tz)}` : fmt.duration(duration)}
                  </p>
                </>
              ) : (
                <p className="text-stone">{t('booking.pickAtLeastOne')}</p>
              )}
            </div>
            {draft.step === 0 && (
              <Button size="lg" disabled={!services.length} onClick={() => patch({ step: 1 })}>
                {t('common.continue')}
              </Button>
            )}
            {draft.step === 1 && (
              <Button size="lg" onClick={() => patch({ step: 2 })}>
                {t('common.continue')}
              </Button>
            )}
            {draft.step === 2 && (
              <Button size="lg" disabled={!draft.start} loading={hold.isPending || reschedule.isPending} onClick={toContactOrHold}>
                {rescheduleId ? t('booking.confirmReschedule') : t('common.continue')}
              </Button>
            )}
            {draft.step === 3 && (
              <Button size="lg" type="submit" form="contact-form" loading={hold.isPending}>
                {t('common.continue')}
              </Button>
            )}
          </div>
        </footer>
      )}
    </div>
  );
}

const pickContact = (d: Draft) => ({ firstName: d.firstName, phone: d.phone, lastName: d.lastName, email: d.email });

/* ---------------------------------------------------------------- step 1: services */
function ServicesStep({ salon, selected, onChange }: { salon: SalonDetail; selected: string[]; onChange: (ids: string[]) => void }) {
  const { t } = useTranslation();
  return (
    <div>
      <p className="text-stone">{t('booking.servicesHint')}</p>
      {salon.categories.map((c) => (
        <section key={c.id} className="mt-5">
          <h2 className="font-sans text-sm font-bold uppercase tracking-wide text-stone">{t(`categories.${c.key}` as never)}</h2>
          <div className="divide-y divide-sand">
            {salon.services.filter((s) => s.categoryId === c.id).map((s) => (
              <ServiceRow key={s.id} service={s} selected={selected.includes(s.id)} onToggle={() => onChange(selected.includes(s.id) ? selected.filter((x) => x !== s.id) : [...selected, s.id])} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- step 2: staff */
function StaffStep({ staff, selected, onSelect }: { staff: SalonDetail['staff']; selected: string | null; onSelect: (id: string | null) => void }) {
  const { t } = useTranslation();
  if (!staff.length) return <EmptyState title={t('booking.noStaff')} body={t('booking.noStaffBody')} />;
  const Option = ({ id, name, role, color }: { id: string | null; name: string; role: string; color?: string }) => {
    const active = selected === id;
    return (
      <button
        type="button"
        aria-pressed={active}
        onClick={() => onSelect(id)}
        className={clsx(
          'flex min-h-[72px] w-full items-center gap-4 rounded-card border bg-surface px-4 text-left transition-colors duration-150 active:scale-[0.99]',
          active ? 'border-terracotta ring-1 ring-terracotta' : 'border-sand hover:border-ink/40',
        )}
      >
        <StaffAvatar name={name} color={color} any={id === null} />
        <span className="min-w-0 flex-1">
          <span className="block font-bold">{name}</span>
          <span className="block truncate text-sm text-stone">{role}</span>
        </span>
        {active && <Check className="h-5 w-5 text-terracotta" strokeWidth={2} aria-hidden />}
      </button>
    );
  };
  return (
    <div className="space-y-3">
      <Option id={null} name={t('booking.anyone')} role={t('booking.anyoneHint')} />
      {staff.map((s) => (
        <Option key={s.id} id={s.id} name={s.name} role={s.role} color={s.color} />
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- step 3: date & time */
function DateTimeStep({
  salon,
  query,
  draft,
  onDate,
  onSlot,
  alternatives,
}: {
  salon: SalonDetail;
  query: { businessId: string; serviceIds: string[]; staffId: string | null; excludeAppointmentId?: string };
  draft: Draft;
  onDate: (d: string) => void;
  onSlot: (s: Slot) => void;
  alternatives: Slot[] | null;
}) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const { api } = useApp();
  const tz = salon.city.timezone;
  const today = todayIn(tz);
  const days = useQuery({ queryKey: ['days', query, today], queryFn: () => api.getAvailableDays(query, today, 14), refetchInterval: 60_000 });
  const firstAvailable = days.data?.find((d) => d.available)?.date ?? null;
  const date = draft.date && days.data?.some((d) => d.date === draft.date && d.available) ? draft.date : firstAvailable;
  const slots = useQuery({ queryKey: ['slots', query, date], queryFn: () => api.getSlots({ ...query, date: date! }), enabled: !!date, refetchInterval: 30_000 });

  useEffect(() => {
    if (date && date !== draft.date) onDate(date);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  if (days.isError) return <ErrorState onRetry={() => days.refetch()} />;
  if (days.isSuccess && !firstAvailable)
    return <EmptyState icon={<Clock strokeWidth={1.75} />} title={t('booking.noAvailability')} body={t('booking.noAvailabilityBody')} />;

  return (
    <div>
      {alternatives && (
        <div className="mb-5 rounded-card border border-gold/40 bg-gold-soft p-4 animate-fade-up" role="alert">
          <p className="font-bold">{t('booking.slotTaken')}</p>
          {alternatives.length ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {alternatives.map((s) => (
                <button key={s.start} type="button" onClick={() => onSlot(s)} className="min-h-tap rounded-full border border-ink/20 bg-surface px-4 text-sm font-bold hover:border-terracotta">
                  {zonedParts(s.start, tz).date === today ? fmt.time(s.start, tz) : `${fmt.shortDate(s.start, tz)} · ${fmt.time(s.start, tz)}`}
                </button>
              ))}
            </div>
          ) : (
            <p className="mt-1 text-sm">{t('booking.slotTakenNoAlt')}</p>
          )}
        </div>
      )}
      <DatePickerStrip days={days.data ?? []} loading={days.isPending} selected={date} today={today} onSelect={onDate} />
      <div className="mt-6">
        {date && (
          <p className="mb-3 font-bold first-letter:uppercase">{fmt.day(date, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
        )}
        {slots.isError ? (
          <ErrorState onRetry={() => slots.refetch()} />
        ) : slots.isSuccess && slots.data.length === 0 ? (
          <p className="text-stone">{t('booking.dayFullBody')}</p>
        ) : (
          <TimeSlotGrid slots={slots.data ?? []} loading={days.isPending || slots.isPending} tz={tz} selected={draft.start} onSelect={onSlot} />
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- step 4: contact */
function ContactStep({ draft, country, onChange, onSubmit }: { draft: Draft; country: Country; onChange: (p: Partial<Draft>) => void; onSubmit: () => void }) {
  const { t } = useTranslation();
  const [more, setMore] = useState(!!(draft.lastName || draft.email));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const schema = useMemo(
    () =>
      z.object({
        firstName: z.string().trim().min(1, t('validation.firstName')).max(60),
        phone: z.string().refine((v) => isValidNational(v, country), t('validation.phone', { digits: country.phoneLength })),
        email: z.union([z.literal(''), z.string().trim().email(t('validation.email'))]),
      }),
    [t, country],
  );
  return (
    <form
      id="contact-form"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        const r = schema.safeParse(draft);
        if (!r.success) {
          setErrors(Object.fromEntries(r.error.issues.map((i) => [i.path[0] as string, i.message])));
          return;
        }
        setErrors({});
        onSubmit();
      }}
      className="space-y-5"
    >
      <p className="text-stone">{t('booking.contactHint')}</p>
      <TextField label={t('fields.firstName')} autoComplete="given-name" value={draft.firstName} onChange={(e) => onChange({ firstName: e.target.value })} error={errors.firstName} autoFocus={!draft.firstName} />
      <PhoneInput label={t('fields.phone')} country={country} value={draft.phone} onChange={(phone) => onChange({ phone })} error={errors.phone} hint={t('booking.phoneHint')} />
      <button type="button" onClick={() => setMore((v) => !v)} aria-expanded={more} className="flex min-h-tap items-center gap-1 text-sm font-bold">
        <ChevronDown className={clsx('h-4 w-4 transition-transform duration-200', more && 'rotate-180')} strokeWidth={1.75} aria-hidden />
        {t('booking.moreDetails')}
      </button>
      {more && (
        <div className="space-y-5 animate-fade-up">
          <TextField label={t('fields.lastNameOptional')} autoComplete="family-name" value={draft.lastName} onChange={(e) => onChange({ lastName: e.target.value })} />
          <TextField label={t('fields.emailOptional')} type="email" autoComplete="email" value={draft.email} onChange={(e) => onChange({ email: e.target.value })} error={errors.email} />
        </div>
      )}
    </form>
  );
}

/* ---------------------------------------------------------------- step 5: payment */
function PaymentStep({
  salon,
  draft,
  total,
  deposit,
  duration,
  onDone,
  onSlotError,
  onFailed,
  onExpired,
}: {
  salon: SalonDetail;
  draft: Draft;
  total: number;
  deposit: number;
  duration: number;
  onDone: (reference: string) => void;
  onSlotError: (e: unknown) => void;
  onFailed: () => void;
  onExpired: () => void;
}) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const { api } = useApp();
  const { business: b, city, country } = salon;
  const tz = city.timezone;
  const options = (['on_site', 'deposit', 'full'] as PaymentOption[]).filter((o) => b.paymentOptions.includes(o) && (o !== 'deposit' || deposit > 0));
  const methods = b.paymentMethods.filter((m) => m !== 'cash') as PaymentMethod[];
  const [option, setOption] = useState<PaymentOption>(options[0] ?? 'on_site');
  const [method, setMethod] = useState<PaymentMethod>(methods[0] ?? 'mobile_money');
  const [operator, setOperator] = useState<PaymentOperator>(country.operators[0]);
  const [wallet, setWallet] = useState(draft.phone);
  const [walletError, setWalletError] = useState<string>();
  const [pending, setPending] = useState<{ paymentId: string; amount: number } | null>(null);
  const staff = salon.staff.find((s) => s.id === (draft.holdStaffId ?? draft.staffId));
  const services = salon.services.filter((s) => draft.serviceIds.includes(s.id));
  const amount = option === 'deposit' ? deposit : option === 'full' ? total : 0;

  // The hold blocks the slot for 10 minutes; its expiry comes from the server.
  const expiresAt = draft.holdExpiresAt ? Date.parse(draft.holdExpiresAt) : null;
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const remaining = expiresAt ? Math.max(0, expiresAt - now) : null;
  useEffect(() => {
    if (remaining === 0) onExpired();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remaining === 0]);

  // Poll the provider while the customer validates on their phone.
  useEffect(() => {
    if (!pending) return;
    let stop = false;
    const tick = async () => {
      try {
        const r = await api.verifyPayment(pending.paymentId);
        if (stop) return;
        if (r.status === 'succeeded') return onDone(r.appointment.reference);
        if (r.status === 'failed') {
          setPending(null);
          return onFailed();
        }
        setTimeout(tick, 1500);
      } catch (e) {
        if (!stop) setTimeout(tick, 3000);
        void e;
      }
    };
    const id = setTimeout(tick, 1500);
    return () => {
      stop = true;
      clearTimeout(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending]);

  const pay = useMutation({
    mutationFn: () =>
      api.initiatePayment({
        appointmentId: draft.holdId!,
        option,
        method: option === 'on_site' ? 'cash' : method,
        operator: method === 'mobile_money' ? operator : undefined,
        phone: method === 'mobile_money' ? toE164(wallet, country) : undefined,
      }),
    onSuccess: (r) => {
      if (r.status === 'succeeded') onDone(r.appointment.reference);
      else if (r.paymentId) setPending({ paymentId: r.paymentId, amount });
    },
    onError: onSlotError,
  });

  const submit = () => {
    if (option !== 'on_site' && method === 'mobile_money' && !isValidNational(wallet, country)) {
      setWalletError(t('validation.phone', { digits: country.phoneLength }));
      return;
    }
    setWalletError(undefined);
    pay.mutate();
  };

  if (pending) return <PhoneValidation amount={pending.amount} method={method} operator={operator} wallet={toE164(wallet, country)} />;

  const mm = Math.floor((remaining ?? 0) / 60000);
  const ss = Math.floor(((remaining ?? 0) % 60000) / 1000);

  return (
    <div className="space-y-6">
      {remaining !== null && (
        <p className={clsx('flex items-center gap-2 text-sm', remaining < 60000 ? 'text-danger' : 'text-stone')} role="timer" aria-live="off">
          <Timer className="h-4 w-4" strokeWidth={1.75} aria-hidden />
          {t('booking.holdTimer', { time: `${mm}:${String(ss).padStart(2, '0')}` })}
        </p>
      )}

      <section className="card divide-y divide-sand" aria-label={t('booking.summary')}>
        <div className="p-4">
          <p className="font-bold">{b.name}</p>
          <p className="mt-1 text-sm first-letter:uppercase">
            {fmt.longDate(draft.start!, tz)} · {fmt.time(draft.start!, tz)}
          </p>
          <p className="text-sm text-stone">
            {fmt.duration(duration)}
            {staff ? ` · ${t('booking.withStaff', { name: staff.name })}` : ''}
          </p>
        </div>
        <ul className="space-y-2 p-4 text-sm">
          {services.map((s) => (
            <li key={s.id} className="flex justify-between gap-4">
              <span>{s.name}</span>
              <span className="tabular-nums">{fmt.money(s.price)}</span>
            </li>
          ))}
        </ul>
        <dl className="space-y-1 p-4 text-sm">
          <div className="flex justify-between font-bold">
            <dt>{t('booking.total')}</dt>
            <dd className="tabular-nums">{fmt.money(total)}</dd>
          </div>
          {deposit > 0 && (
            <div className="flex justify-between text-stone">
              <dt>{t('booking.deposit')}</dt>
              <dd className="tabular-nums">{fmt.money(deposit)}</dd>
            </div>
          )}
          <div className="flex justify-between text-stone">
            <dt>{t('booking.balanceOnSite')}</dt>
            <dd className="tabular-nums">{fmt.money(total - amount)}</dd>
          </div>
        </dl>
      </section>

      <fieldset>
        <legend className="mb-2 font-bold">{t('booking.howToPay')}</legend>
        <div className="space-y-2">
          {options.map((o) => (
            <label key={o} className={clsx('flex min-h-[60px] cursor-pointer items-center gap-3 rounded-card border bg-surface px-4 transition-colors duration-150', option === o ? 'border-terracotta ring-1 ring-terracotta' : 'border-sand')}>
              <input type="radio" name="option" value={o} checked={option === o} onChange={() => setOption(o)} className="h-5 w-5 accent-terracotta" />
              <span className="flex-1">
                <span className="block font-bold">{t(`booking.options.${o}`)}</span>
                <span className="block text-sm text-stone">
                  {o === 'on_site' ? t('booking.options.onSiteHint', { amount: fmt.money(total) }) : o === 'deposit' ? t('booking.options.depositHint', { amount: fmt.money(deposit), rest: fmt.money(total - deposit) }) : t('booking.options.fullHint', { amount: fmt.money(total) })}
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {option !== 'on_site' && (
        <fieldset className="animate-fade-up">
          <legend className="mb-2 font-bold">{t('booking.paymentMethod')}</legend>
          <div className="flex gap-2">
            {methods.map((m) => (
              <button key={m} type="button" aria-pressed={method === m} onClick={() => setMethod(m)} className={clsx('flex min-h-tap flex-1 items-center justify-center gap-2 rounded-full border text-sm font-bold', method === m ? 'border-ink bg-ink text-ivory' : 'border-sand bg-surface')}>
                {m === 'mobile_money' ? <Smartphone className="h-4 w-4" strokeWidth={1.75} aria-hidden /> : <CreditCard className="h-4 w-4" strokeWidth={1.75} aria-hidden />}
                {t(`booking.methods.${m}`)}
              </button>
            ))}
          </div>
          {method === 'mobile_money' && (
            <div className="mt-4 space-y-4">
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t('booking.operator')}>
                {country.operators.map((op) => (
                  <button key={op} type="button" role="radio" aria-checked={operator === op} onClick={() => setOperator(op)} className={clsx('min-h-tap rounded-full border px-4 text-sm font-bold', operator === op ? 'border-terracotta bg-terracotta-soft text-terracotta-dark' : 'border-sand bg-surface')}>
                    {OPERATOR_LABELS[op]}
                  </button>
                ))}
              </div>
              <PhoneInput label={t('booking.walletNumber', { operator: OPERATOR_LABELS[operator] })} country={country} value={wallet} onChange={setWallet} error={walletError} hint={t('booking.walletHint')} />
            </div>
          )}
          {method === 'card' && <p className="mt-3 text-sm text-stone">{t('booking.cardHint')}</p>}
        </fieldset>
      )}

      <p className="flex items-start gap-2 text-sm text-stone">
        <Store className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden />
        {t('booking.cancellationPolicy', { hours: b.cancellationHours })}
      </p>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-sand bg-surface/95 backdrop-blur safe-bottom">
        <div className="container-app max-w-xl pt-3">
          <Button size="lg" block loading={pay.isPending} onClick={submit}>
            {option === 'on_site' ? t('common.book') : t('booking.payAmount', { amount: fmt.money(amount) })}
          </Button>
        </div>
      </div>
    </div>
  );
}

function PhoneValidation({ amount, method, operator, wallet }: { amount: number; method: PaymentMethod; operator: PaymentOperator; wallet: string }) {
  const { t } = useTranslation();
  const fmt = useFormat();
  return (
    <div className="flex flex-col items-center py-10 text-center animate-fade-up" role="status" aria-live="polite">
      <div className="relative flex h-20 w-20 items-center justify-center rounded-full bg-terracotta-soft">
        <span className="absolute inset-0 animate-ping rounded-full bg-terracotta/20 motion-reduce:hidden" aria-hidden />
        {method === 'card' ? <CreditCard className="h-9 w-9 text-terracotta" strokeWidth={1.75} /> : <Smartphone className="h-9 w-9 text-terracotta" strokeWidth={1.75} />}
      </div>
      <h2 className="mt-6 text-xl">{method === 'card' ? t('booking.cardPending') : t('booking.validateOnPhone')}</h2>
      <p className="mt-2 max-w-xs text-stone">
        {method === 'card' ? t('booking.cardPendingBody', { amount: fmt.money(amount) }) : t('booking.validateOnPhoneBody', { amount: fmt.money(amount), operator: OPERATOR_LABELS[operator], phone: wallet })}
      </p>
      <p className="mt-6 text-xs text-stone">{t('booking.demoPaymentHint')}</p>
    </div>
  );
}
