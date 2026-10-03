import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Check, LogIn, MessageCircle, Phone, UserX, XCircle } from 'lucide-react';
import clsx from 'clsx';
import { useApp } from '@/app/AppContext';
import { ApiError } from '@/data/api';
import type { AppointmentStatus, AppointmentView } from '@/lib/types';
import { isValidNational, toE164, whatsappLink, formatE164 } from '@/lib/phone';
import { minutesToTime, zonedParts, zonedToUtc } from '@/lib/time';
import { useFormat } from '@/hooks/useFormat';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button } from '@/components/ui/Button';
import { PaymentBadge, StatusBadge } from '@/components/ui/Badge';
import { Chip } from '@/components/ui/Chip';
import { SelectField, TextField } from '@/components/ui/Field';
import { PhoneInput } from '@/components/ui/PhoneInput';
import { useToast } from '@/components/ui/Toast';
import { useBusiness } from './BusinessContext';

export function AppointmentSheet({ appointment: a, onClose }: { appointment: AppointmentView | null; onClose: () => void }) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const { api, ref } = useApp();
  const { tz } = useBusiness();
  const qc = useQueryClient();
  const toast = useToast();
  const m = useMutation({
    mutationFn: (status: AppointmentStatus) => api.setAppointmentStatus(a!.id, status),
    onSuccess: (_d, status) => {
      toast(t(`pro.statusUpdated.${status}` as never));
      void qc.invalidateQueries({ queryKey: ['pro'] });
      onClose();
    },
    onError: () => toast(t('errors.generic'), 'error'),
  });
  if (!a) return null;
  const active = a.status === 'confirmed' || a.status === 'checked_in';
  return (
    <BottomSheet open={!!a} onClose={onClose} title={`${a.client.firstName} ${a.client.lastName}`.trim()}>
      <div className="flex flex-wrap gap-1.5">
        <StatusBadge status={a.status} />
        <PaymentBadge status={a.paymentStatus} />
      </div>
      <dl className="mt-4 space-y-2 text-sm">
        <Row label={t('success.when')} value={<span className="inline-block first-letter:uppercase">{fmt.longDate(a.startsAt, tz)} · {fmt.time(a.startsAt, tz)}–{fmt.time(a.endsAt, tz)}</span>} />
        <Row label={t('success.services')} value={a.services.map((s) => s.name).join(', ')} />
        <Row label={t('success.with')} value={a.staff?.name ?? '—'} />
        <Row label={t('booking.total')} value={fmt.money(a.total)} />
        {a.amountPaid > 0 && <Row label={t('success.paid')} value={fmt.money(a.amountPaid)} />}
        <Row label={t('success.reference')} value={a.reference} />
        <Row label={t('fields.phone')} value={formatE164(a.client.phone, ref.countries)} />
      </dl>
      <div className="mt-4 flex gap-2">
        <a href={`tel:${a.client.phone}`} className="inline-flex min-h-tap flex-1 items-center justify-center gap-2 rounded-full border border-sand text-sm font-bold"><Phone className="h-4 w-4" strokeWidth={1.75} aria-hidden />{t('salon.call')}</a>
        <a href={whatsappLink(a.client.phone, t('pro.waClient', { name: a.client.firstName }))} target="_blank" rel="noreferrer" className="inline-flex min-h-tap flex-1 items-center justify-center gap-2 rounded-full border border-sand text-sm font-bold"><MessageCircle className="h-4 w-4" strokeWidth={1.75} aria-hidden />{t('salon.whatsapp')}</a>
      </div>
      {active && (
        <div className="mt-6 grid grid-cols-2 gap-2">
          {a.status === 'confirmed' && <Button variant="secondary" icon={<LogIn className="h-4 w-4" strokeWidth={1.75} aria-hidden />} loading={m.isPending && m.variables === 'checked_in'} onClick={() => m.mutate('checked_in')}>{t('pro.actions.arrived')}</Button>}
          <Button variant="secondary" icon={<Check className="h-4 w-4" strokeWidth={1.75} aria-hidden />} loading={m.isPending && m.variables === 'completed'} onClick={() => m.mutate('completed')}>{t('pro.actions.done')}</Button>
          <Button variant="secondary" icon={<UserX className="h-4 w-4" strokeWidth={1.75} aria-hidden />} onClick={() => m.mutate('no_show')}>{t('pro.actions.noShow')}</Button>
          <Button variant="danger" icon={<XCircle className="h-4 w-4" strokeWidth={1.75} aria-hidden />} onClick={() => m.mutate('cancelled')}>{t('pro.actions.cancel')}</Button>
        </div>
      )}
    </BottomSheet>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-stone">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}

export function CreateAppointmentSheet({ initial, onClose }: { initial: { staffId: string; start: string }; onClose: () => void }) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const { api } = useApp();
  const { business, bundle, tz } = useBusiness();
  const qc = useQueryClient();
  const toast = useToast();
  const [staffId, setStaffId] = useState(initial.staffId);
  const [date, setDate] = useState(zonedParts(initial.start, tz).date);
  const [time, setTime] = useState(zonedParts(initial.start, tz).time);
  const [serviceIds, setServiceIds] = useState<string[]>([]);
  const [clientMode, setClientMode] = useState<'existing' | 'new'>('existing');
  const [search, setSearch] = useState('');
  const [clientId, setClientId] = useState<string | null>(null);
  const [newClient, setNewClient] = useState({ firstName: '', lastName: '', phone: '' });
  const [error, setError] = useState<string>();
  const country = bundle!.country;
  const clients = useQuery({ queryKey: ['pro', 'clients', business.id, search], queryFn: () => api.listClients(business.id, search), enabled: clientMode === 'existing' });
  const staffServices = bundle!.staffServices.filter((x) => x.staffId === staffId).map((x) => x.serviceId);
  const services = bundle!.services.filter((s) => staffServices.includes(s.id));
  const times = useMemo(() => Array.from({ length: 24 * 4 }, (_, i) => minutesToTime(i * 15)), []);

  const m = useMutation({
    mutationFn: () =>
      api.createProAppointment({
        businessId: business.id,
        staffId,
        serviceIds,
        start: zonedToUtc(date, time, tz).toISOString(),
        clientId: clientMode === 'existing' ? clientId ?? undefined : undefined,
        newClient: clientMode === 'new' ? { firstName: newClient.firstName, lastName: newClient.lastName, phone: toE164(newClient.phone, country) } : undefined,
      }),
    onSuccess: () => {
      toast(t('pro.calendar.created'));
      void qc.invalidateQueries({ queryKey: ['pro'] });
      onClose();
    },
    onError: (e) => setError(e instanceof ApiError && e.code === 'SLOT_TAKEN' ? t('pro.calendar.conflict') : t('errors.generic')),
  });

  const submit = () => {
    if (!serviceIds.length) return setError(t('pro.calendar.pickService'));
    if (clientMode === 'existing' && !clientId) return setError(t('pro.calendar.pickClient'));
    if (clientMode === 'new' && (!newClient.firstName.trim() || !isValidNational(newClient.phone, country))) return setError(t('pro.calendar.clientInvalid'));
    setError(undefined);
    m.mutate();
  };

  const total = bundle!.services.filter((s) => serviceIds.includes(s.id));
  return (
    <BottomSheet
      open
      onClose={onClose}
      title={t('pro.calendar.new')}
      footer={
        <div>
          {error && <p className="mb-2 text-sm text-danger" role="alert">{error}</p>}
          <Button block size="lg" loading={m.isPending} onClick={submit}>
            {t('pro.calendar.create')}
            {total.length > 0 && ` · ${fmt.money(total.reduce((s, x) => s + x.price, 0))}`}
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        <fieldset>
          <legend className="label">{t('pro.calendar.client')}</legend>
          <div className="mb-3 flex gap-2">
            <Chip active={clientMode === 'existing'} onClick={() => setClientMode('existing')}>{t('pro.calendar.existingClient')}</Chip>
            <Chip active={clientMode === 'new'} onClick={() => setClientMode('new')}>{t('pro.calendar.newClient')}</Chip>
          </div>
          {clientMode === 'existing' ? (
            <>
              <input className="field" placeholder={t('pro.clients.search')} value={search} onChange={(e) => setSearch(e.target.value)} aria-label={t('pro.clients.search')} />
              <ul className="mt-2 max-h-40 divide-y divide-sand overflow-y-auto rounded-card border border-sand">
                {(clients.data ?? []).slice(0, 20).map((c) => (
                  <li key={c.id}>
                    <button type="button" aria-pressed={clientId === c.id} onClick={() => setClientId(c.id)} className={clsx('flex min-h-tap w-full items-center justify-between px-3 text-left text-sm', clientId === c.id && 'bg-terracotta-soft font-bold')}>
                      <span>{c.firstName} {c.lastName}</span>
                      <span className="text-stone">{c.phone}</span>
                    </button>
                  </li>
                ))}
                {clients.isSuccess && clients.data.length === 0 && <li className="px-3 py-3 text-sm text-stone">{t('pro.clients.empty')}</li>}
              </ul>
            </>
          ) : (
            <div className="space-y-3">
              <TextField label={t('fields.firstName')} value={newClient.firstName} onChange={(e) => setNewClient({ ...newClient, firstName: e.target.value })} />
              <TextField label={t('fields.lastNameOptional')} value={newClient.lastName} onChange={(e) => setNewClient({ ...newClient, lastName: e.target.value })} />
              <PhoneInput label={t('fields.phone')} country={country} value={newClient.phone} onChange={(phone) => setNewClient({ ...newClient, phone })} />
            </div>
          )}
        </fieldset>
        <SelectField label={t('pro.calendar.staff')} value={staffId} onChange={(e) => { setStaffId(e.target.value); setServiceIds([]); }}>
          {bundle!.staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </SelectField>
        <fieldset>
          <legend className="label">{t('pro.calendar.services')}</legend>
          <div className="flex flex-wrap gap-2">
            {services.map((s) => (
              <Chip key={s.id} active={serviceIds.includes(s.id)} onClick={() => setServiceIds((x) => (x.includes(s.id) ? x.filter((i) => i !== s.id) : [...x, s.id]))}>
                {s.name} · {fmt.duration(s.durationMin)}
              </Chip>
            ))}
          </div>
        </fieldset>
        <div className="grid grid-cols-2 gap-3">
          <TextField label={t('pro.calendar.date')} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <SelectField label={t('pro.calendar.time')} value={time} onChange={(e) => setTime(e.target.value)}>
            {times.map((x) => <option key={x} value={x}>{x}</option>)}
          </SelectField>
        </div>
      </div>
    </BottomSheet>
  );
}
