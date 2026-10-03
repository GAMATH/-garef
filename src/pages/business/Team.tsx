import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Pencil, Plus, Trash2, Users } from 'lucide-react';
import { useApp } from '@/app/AppContext';
import type { Staff, StaffHours } from '@/lib/types';
import { addDays, todayIn, zonedToUtc } from '@/lib/time';
import { useFormat } from '@/hooks/useFormat';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button, IconButton } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { TextField } from '@/components/ui/Field';
import { EmptyState } from '@/components/ui/EmptyState';
import { ListSkeleton } from '@/components/ui/Skeleton';
import { StaffAvatar } from '@/components/ui/StaffAvatar';
import { useToast } from '@/components/ui/Toast';
import { useBusiness } from './BusinessContext';
import { PageHeader } from './BusinessLayout';

const WEEK = [1, 2, 3, 4, 5, 6, 0];

export default function Team() {
  const { t } = useTranslation();
  const { bundle } = useBusiness();
  useDocumentTitle(t('pro.nav.team'));
  const [editing, setEditing] = useState<Staff | 'new' | null>(null);
  if (!bundle) return <ListSkeleton rows={4} />;
  return (
    <>
      <PageHeader title={t('pro.nav.team')} action={<Button size="sm" icon={<Plus className="h-4 w-4" strokeWidth={2} aria-hidden />} onClick={() => setEditing('new')}>{t('pro.team.add')}</Button>} />
      {bundle.staff.length === 0 ? (
        <div className="card"><EmptyState icon={<Users strokeWidth={1.75} />} title={t('pro.team.empty')} /></div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {bundle.staff.map((s) => {
            const own = bundle.staffHours.filter((h) => h.staffId === s.id);
            const off = bundle.timeOff.filter((x) => x.staffId === s.id && Date.parse(x.endsAt) > Date.now());
            return (
              <li key={s.id} className="card flex items-center gap-4 p-4">
                <StaffAvatar name={s.name} color={s.color} size={52} />
                <div className="min-w-0 flex-1">
                  <p className="font-bold">{s.name}</p>
                  <p className="truncate text-sm text-stone">{s.role}</p>
                  <p className="text-sm text-stone">
                    {t('pro.team.servicesCount', { count: bundle.staffServices.filter((x) => x.staffId === s.id && bundle.services.some((sv) => sv.id === x.serviceId)).length })}
                    {own.length ? ` · ${t('pro.team.ownHours')}` : ''}
                    {off.length ? ` · ${t('pro.team.upcomingLeave', { count: off.length })}` : ''}
                  </p>
                </div>
                <IconButton label={t('common.edit')} onClick={() => setEditing(s)}><Pencil className="h-4 w-4" strokeWidth={1.75} /></IconButton>
              </li>
            );
          })}
        </ul>
      )}
      {editing && <StaffSheet staff={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function StaffSheet({ staff, onClose }: { staff: Staff | null; onClose: () => void }) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const { api } = useApp();
  const { business, bundle, tz } = useBusiness();
  const qc = useQueryClient();
  const toast = useToast();
  const own = staff ? bundle!.staffHours.filter((h) => h.staffId === staff.id) : [];
  const [name, setName] = useState(staff?.name ?? '');
  const [role, setRole] = useState(staff?.role ?? '');
  const [serviceIds, setServiceIds] = useState(staff ? bundle!.staffServices.filter((x) => x.staffId === staff.id).map((x) => x.serviceId) : bundle!.services.map((s) => s.id));
  const [custom, setCustom] = useState(own.length > 0);
  const [hours, setHours] = useState<Omit<StaffHours, 'staffId'>[]>(
    own.length ? own.map(({ staffId: _s, ...h }) => h) : bundle!.hours.map((h) => ({ weekday: h.weekday, starts: h.opens, ends: h.closes })),
  );
  const today = todayIn(tz);
  const [leave, setLeave] = useState({ from: today, to: addDays(today, 1), reason: '' });
  const [error, setError] = useState<string>();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['pro'] });

  const save = useMutation({
    mutationFn: () => api.saveStaff({ id: staff?.id, businessId: business.id, name: name.trim(), role: role.trim(), photoUrl: staff?.photoUrl ?? null, active: true }, serviceIds, custom ? hours : []),
    onSuccess: () => { toast(t('common.saved')); void invalidate(); onClose(); },
    onError: () => setError(t('errors.generic')),
  });
  const archive = useMutation({ mutationFn: () => api.archiveStaff(staff!.id), onSuccess: () => { toast(t('pro.team.archived')); void invalidate(); onClose(); } });
  const addLeave = useMutation({
    mutationFn: () => api.addTimeOff({ businessId: business.id, staffId: staff!.id, startsAt: zonedToUtc(leave.from, '00:00', tz).toISOString(), endsAt: zonedToUtc(addDays(leave.to, 1), '00:00', tz).toISOString(), reason: leave.reason }),
    onSuccess: () => { toast(t('pro.team.leaveAdded')); void invalidate(); },
  });
  const removeLeave = useMutation({ mutationFn: (id: string) => api.deleteTimeOff(id), onSuccess: () => void invalidate() });
  const leaves = staff ? bundle!.timeOff.filter((x) => x.staffId === staff.id && Date.parse(x.endsAt) > Date.now()) : [];

  const toggleDay = (wd: number) => setHours((h) => (h.some((x) => x.weekday === wd) ? h.filter((x) => x.weekday !== wd) : [...h, { weekday: wd, starts: '09:00', ends: '18:00' }]));

  return (
    <BottomSheet
      open
      onClose={onClose}
      title={staff ? staff.name : t('pro.team.add')}
      footer={
        <div className="space-y-2">
          {error && <p className="text-sm text-danger" role="alert">{error}</p>}
          <Button block size="lg" loading={save.isPending} onClick={() => (name.trim() ? save.mutate() : setError(t('pro.team.nameRequired')))}>{t('common.save')}</Button>
          {staff && <Button block variant="ghost" className="text-danger" loading={archive.isPending} onClick={() => archive.mutate()}>{t('pro.team.archive')}</Button>}
        </div>
      }
    >
      <div className="space-y-5">
        <TextField label={t('fields.firstName')} value={name} onChange={(e) => setName(e.target.value)} />
        <TextField label={t('pro.team.role')} value={role} onChange={(e) => setRole(e.target.value)} />
        <fieldset>
          <legend className="label">{t('pro.team.services')}</legend>
          <div className="flex flex-wrap gap-2">
            {bundle!.services.map((s) => (
              <Chip key={s.id} active={serviceIds.includes(s.id)} onClick={() => setServiceIds((x) => (x.includes(s.id) ? x.filter((i) => i !== s.id) : [...x, s.id]))}>{s.name}</Chip>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className="label">{t('pro.team.hours')}</legend>
          <div className="flex gap-2">
            <Chip active={!custom} onClick={() => setCustom(false)}>{t('pro.team.sameAsSalon')}</Chip>
            <Chip active={custom} onClick={() => setCustom(true)}>{t('pro.team.customHours')}</Chip>
          </div>
          {custom && (
            <ul className="mt-3 space-y-2">
              {WEEK.map((wd) => {
                const h = hours.find((x) => x.weekday === wd);
                return (
                  <li key={wd} className="flex items-center gap-2">
                    <label className="flex w-28 items-center gap-2 text-sm capitalize">
                      <input type="checkbox" className="h-5 w-5 accent-terracotta" checked={!!h} onChange={() => toggleDay(wd)} />
                      {t(`weekdays.${wd}` as never)}
                    </label>
                    {h ? (
                      <>
                        <input type="time" step={900} aria-label={t('pro.hours.opens')} className="field min-h-[40px] w-28 px-2" value={h.starts} onChange={(e) => setHours((x) => x.map((y) => (y.weekday === wd ? { ...y, starts: e.target.value } : y)))} />
                        <span aria-hidden>–</span>
                        <input type="time" step={900} aria-label={t('pro.hours.closes')} className="field min-h-[40px] w-28 px-2" value={h.ends} onChange={(e) => setHours((x) => x.map((y) => (y.weekday === wd ? { ...y, ends: e.target.value } : y)))} />
                      </>
                    ) : (
                      <span className="text-sm text-stone">{t('salon.closedDay')}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </fieldset>
        {staff && (
          <fieldset>
            <legend className="label">{t('pro.team.leave')}</legend>
            {leaves.length > 0 && (
              <ul className="mb-3 space-y-2">
                {leaves.map((l) => (
                  <li key={l.id} className="flex items-center justify-between rounded-card bg-sand-light px-3 py-2 text-sm">
                    <span className="inline-block first-letter:uppercase">{fmt.shortDate(l.startsAt, tz)} → {fmt.shortDate(new Date(Date.parse(l.endsAt) - 1).toISOString(), tz)}{l.reason ? ` · ${l.reason}` : ''}</span>
                    <IconButton label={t('common.delete')} onClick={() => removeLeave.mutate(l.id)}><Trash2 className="h-4 w-4" strokeWidth={1.75} /></IconButton>
                  </li>
                ))}
              </ul>
            )}
            <div className="grid grid-cols-2 gap-2">
              <TextField label={t('pro.bookings.from')} type="date" value={leave.from} onChange={(e) => setLeave({ ...leave, from: e.target.value })} />
              <TextField label={t('pro.bookings.to')} type="date" value={leave.to} onChange={(e) => setLeave({ ...leave, to: e.target.value })} />
            </div>
            <div className="mt-2 flex items-end gap-2">
              <div className="flex-1"><TextField label={t('pro.team.reasonOptional')} value={leave.reason} onChange={(e) => setLeave({ ...leave, reason: e.target.value })} /></div>
              <Button variant="secondary" loading={addLeave.isPending} onClick={() => addLeave.mutate()}>{t('common.add')}</Button>
            </div>
          </fieldset>
        )}
      </div>
    </BottomSheet>
  );
}
