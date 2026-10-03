import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Pencil, Plus, Scissors } from 'lucide-react';
import { useApp } from '@/app/AppContext';
import type { DepositRule, Service } from '@/lib/types';
import { useFormat } from '@/hooks/useFormat';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { SelectField, TextArea, TextField } from '@/components/ui/Field';
import { EmptyState } from '@/components/ui/EmptyState';
import { ListSkeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { useBusiness } from './BusinessContext';
import { PageHeader } from './BusinessLayout';

export const DURATIONS = [15, 20, 30, 45, 60, 75, 90, 120, 150, 180, 210, 240, 300, 360, 420, 480];

export default function Services() {
  const { t } = useTranslation();
  const fmt = useFormat();
  const { bundle } = useBusiness();
  useDocumentTitle(t('pro.nav.services'));
  const [editing, setEditing] = useState<Service | 'new' | null>(null);
  if (!bundle) return <ListSkeleton rows={6} />;
  const used = bundle.categories.filter((c) => bundle.services.some((s) => s.categoryId === c.id));
  return (
    <>
      <PageHeader title={t('pro.nav.services')} action={<Button size="sm" icon={<Plus className="h-4 w-4" strokeWidth={2} aria-hidden />} onClick={() => setEditing('new')}>{t('pro.services.add')}</Button>} />
      {bundle.services.length === 0 ? (
        <div className="card"><EmptyState icon={<Scissors strokeWidth={1.75} />} title={t('pro.services.empty')} action={<Button onClick={() => setEditing('new')}>{t('pro.services.add')}</Button>} /></div>
      ) : (
        <div className="space-y-6">
          {used.map((c) => (
            <section key={c.id}>
              <h2 className="font-sans text-sm font-bold uppercase tracking-wide text-stone">{t(`categories.${c.key}` as never)}</h2>
              <ul className="card mt-2 divide-y divide-sand">
                {bundle.services.filter((s) => s.categoryId === c.id).map((s) => (
                  <li key={s.id} className="flex items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-bold">{s.name}</p>
                      <p className="text-sm text-stone">
                        {fmt.duration(s.durationMin)} · {fmt.money(s.price)} · {t('pro.services.prosCount', { count: bundle.staffServices.filter((x) => x.serviceId === s.id && bundle.staff.some((st) => st.id === x.staffId)).length })}
                      </p>
                    </div>
                    <Button size="sm" variant="ghost" icon={<Pencil className="h-4 w-4" strokeWidth={1.75} aria-hidden />} onClick={() => setEditing(s)}>{t('common.edit')}</Button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
      {editing && <ServiceSheet service={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function ServiceSheet({ service, onClose }: { service: Service | null; onClose: () => void }) {
  const { t } = useTranslation();
  const { api } = useApp();
  const { business, bundle } = useBusiness();
  const qc = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState({
    name: service?.name ?? '',
    categoryId: service?.categoryId ?? bundle!.categories[0].id,
    description: service?.description ?? '',
    durationMin: service?.durationMin ?? 30,
    price: service?.price ?? 5000,
    deposit: (service?.depositRule?.type ?? 'default') as DepositRule['type'] | 'default',
    depositValue: service?.depositRule && 'value' in service.depositRule ? service.depositRule.value : 0,
    staffIds: service ? bundle!.staffServices.filter((x) => x.serviceId === service.id).map((x) => x.staffId) : bundle!.staff.map((s) => s.id),
  });
  const [error, setError] = useState<string>();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['pro'] });
  const save = useMutation({
    mutationFn: () => {
      const depositRule: DepositRule | null = form.deposit === 'default' ? null : form.deposit === 'fixed' || form.deposit === 'percent' ? { type: form.deposit, value: form.depositValue } : { type: form.deposit };
      return api.saveService({ id: service?.id, businessId: business.id, categoryId: form.categoryId, name: form.name.trim(), description: form.description.trim(), durationMin: form.durationMin, price: form.price, depositRule, active: true }, form.staffIds);
    },
    onSuccess: () => { toast(t('common.saved')); void invalidate(); onClose(); },
    onError: () => setError(t('errors.generic')),
  });
  const archive = useMutation({ mutationFn: () => api.archiveService(service!.id), onSuccess: () => { toast(t('pro.services.archived')); void invalidate(); onClose(); } });
  const submit = () => {
    if (!form.name.trim()) return setError(t('pro.services.nameRequired'));
    if (!form.staffIds.length) return setError(t('pro.services.staffRequired'));
    if (form.price < 0) return setError(t('pro.services.priceInvalid'));
    save.mutate();
  };
  return (
    <BottomSheet
      open
      onClose={onClose}
      title={service ? t('pro.services.edit') : t('pro.services.add')}
      footer={
        <div className="space-y-2">
          {error && <p className="text-sm text-danger" role="alert">{error}</p>}
          <Button block size="lg" loading={save.isPending} onClick={submit}>{t('common.save')}</Button>
          {service && <Button block variant="ghost" className="text-danger" loading={archive.isPending} onClick={() => archive.mutate()}>{t('pro.services.archive')}</Button>}
        </div>
      }
    >
      <div className="space-y-4">
        <TextField label={t('pro.services.name')} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <SelectField label={t('search.category')} value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
          {bundle!.categories.map((c) => <option key={c.id} value={c.id}>{t(`categories.${c.key}` as never)}</option>)}
        </SelectField>
        <div className="grid grid-cols-2 gap-3">
          <SelectField label={t('pro.services.duration')} value={form.durationMin} onChange={(e) => setForm({ ...form, durationMin: Number(e.target.value) })}>
            {DURATIONS.map((d) => <option key={d} value={d}>{d} min</option>)}
          </SelectField>
          <TextField label={t('pro.services.price')} type="number" inputMode="numeric" min={0} step={500} value={form.price} onChange={(e) => setForm({ ...form, price: Number(e.target.value) })} />
        </div>
        <TextArea label={t('pro.services.descriptionOptional')} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        <fieldset>
          <legend className="label">{t('pro.services.staff')}</legend>
          <div className="flex flex-wrap gap-2">
            {bundle!.staff.map((s) => (
              <Chip key={s.id} active={form.staffIds.includes(s.id)} onClick={() => setForm({ ...form, staffIds: form.staffIds.includes(s.id) ? form.staffIds.filter((x) => x !== s.id) : [...form.staffIds, s.id] })}>{s.name}</Chip>
            ))}
          </div>
        </fieldset>
        <div className="grid grid-cols-2 gap-3">
          <SelectField label={t('pro.settings.deposit')} value={form.deposit} onChange={(e) => setForm({ ...form, deposit: e.target.value as typeof form.deposit })}>
            <option value="default">{t('pro.services.depositDefault')}</option>
            {(['none', 'fixed', 'percent', 'full'] as const).map((d) => <option key={d} value={d}>{t(`pro.settings.depositTypes.${d}`)}</option>)}
          </SelectField>
          {(form.deposit === 'fixed' || form.deposit === 'percent') && (
            <TextField label={form.deposit === 'fixed' ? t('pro.settings.depositAmount') : t('pro.settings.depositPercent')} type="number" inputMode="numeric" min={0} value={form.depositValue} onChange={(e) => setForm({ ...form, depositValue: Number(e.target.value) })} />
          )}
        </div>
      </div>
    </BottomSheet>
  );
}
