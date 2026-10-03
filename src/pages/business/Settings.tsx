import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ImagePlus, Trash2 } from 'lucide-react';
import { useApp } from '@/app/AppContext';
import type { Business, DepositRule, PaymentMethod, PaymentOption } from '@/lib/types';
import { compressImage } from '@/lib/image';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { Button, IconButton } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { SelectField, TextArea, TextField } from '@/components/ui/Field';
import { ListSkeleton } from '@/components/ui/Skeleton';
import { SalonArt } from '@/components/ui/Art';
import { useToast } from '@/components/ui/Toast';
import { useBusiness } from './BusinessContext';
import { PageHeader } from './BusinessLayout';

export default function Settings() {
  const { t } = useTranslation();
  const { api } = useApp();
  const { business, bundle } = useBusiness();
  const qc = useQueryClient();
  const toast = useToast();
  useDocumentTitle(t('pro.nav.settings'));
  const [form, setForm] = useState<Business | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (bundle && !form) setForm(bundle.business);
  }, [bundle, form]);
  const save = useMutation({
    mutationFn: () => api.updateBusiness(business.id, form!),
    onSuccess: () => { toast(t('common.saved')); void qc.invalidateQueries({ queryKey: ['pro'] }); void qc.invalidateQueries({ queryKey: ['me', 'business'] }); void qc.invalidateQueries({ queryKey: ['salon'] }); },
    onError: () => toast(t('errors.generic'), 'error'),
  });
  if (!form) return <ListSkeleton rows={6} />;
  const set = (p: Partial<Business>) => setForm({ ...form, ...p });
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const depositValue = 'value' in form.depositRule ? form.depositRule.value : 0;

  const onFiles = async (files: FileList | null) => {
    if (!files) return;
    try {
      const urls = await Promise.all([...files].slice(0, 5 - form.photoUrls.length).map((f) => compressImage(f)));
      set({ photoUrls: [...form.photoUrls, ...urls].slice(0, 5) });
    } catch {
      toast(t('pro.settings.photoError'), 'error');
    }
  };

  return (
    <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="space-y-6 pb-24">
      <PageHeader title={t('pro.nav.settings')} />

      <section className="card space-y-4 p-4" aria-labelledby="pub">
        <h2 id="pub" className="font-sans text-base font-bold">{t('pro.settings.public')}</h2>
        <div>
          <p className="label">{t('pro.settings.photos')}</p>
          <div className="flex flex-wrap gap-2">
            {(form.photoUrls.length ? form.photoUrls : []).map((u, i) => (
              <div key={i} className="relative h-20 w-28 overflow-hidden rounded-card">
                <img src={u} alt="" className="h-full w-full object-cover" />
                <IconButton label={t('common.delete')} className="absolute right-0 top-0 h-8 w-8 bg-surface/90" onClick={() => set({ photoUrls: form.photoUrls.filter((_, j) => j !== i) })}><Trash2 className="h-4 w-4" strokeWidth={1.75} /></IconButton>
              </div>
            ))}
            {!form.photoUrls.length && <div className="h-20 w-28 overflow-hidden rounded-card"><SalonArt seed={form.photoSeeds[0] ?? 1} /></div>}
            {form.photoUrls.length < 5 && (
              <button type="button" onClick={() => fileRef.current?.click()} className="flex h-20 w-28 flex-col items-center justify-center gap-1 rounded-card border border-dashed border-ink/30 text-xs font-medium">
                <ImagePlus className="h-5 w-5" strokeWidth={1.75} aria-hidden />
                {t('pro.settings.addPhoto')}
              </button>
            )}
            <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => void onFiles(e.target.files)} />
          </div>
          <p className="mt-1.5 text-sm text-stone">{t('pro.settings.photosHint')}</p>
        </div>
        <TextField label={t('pro.onboarding.name')} value={form.name} onChange={(e) => set({ name: e.target.value })} />
        <TextArea label={t('pro.onboarding.description')} value={form.description} onChange={(e) => set({ description: e.target.value })} rows={4} />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label={t('pro.onboarding.district')} value={form.district} onChange={(e) => set({ district: e.target.value })} />
          <TextField label={t('salon.address')} value={form.address} onChange={(e) => set({ address: e.target.value })} />
          <TextField label={t('fields.phone')} type="tel" value={form.phone} onChange={(e) => set({ phone: e.target.value })} hint={t('pro.settings.e164')} />
          <TextField label={t('salon.whatsapp')} type="tel" value={form.whatsapp} onChange={(e) => set({ whatsapp: e.target.value })} hint={t('pro.settings.e164')} />
          <SelectField label={t('search.audience')} value={form.audience} onChange={(e) => set({ audience: e.target.value as Business['audience'] })}>
            {(['unisex', 'women', 'men'] as const).map((a) => <option key={a} value={a}>{t(`pro.settings.audiences.${a}`)}</option>)}
          </SelectField>
          <label className="flex min-h-tap items-center gap-3 self-end">
            <input type="checkbox" className="h-5 w-5 accent-terracotta" checked={form.instantBooking} onChange={(e) => set({ instantBooking: e.target.checked })} />
            {t('salon.instant')}
          </label>
        </div>
      </section>

      <section className="card space-y-4 p-4" aria-labelledby="booking-rules">
        <h2 id="booking-rules" className="font-sans text-base font-bold">{t('pro.settings.bookingRules')}</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <SelectField label={t('pro.settings.cancellation')} value={form.cancellationHours} onChange={(e) => set({ cancellationHours: Number(e.target.value) })}>
            {[0, 2, 6, 12, 24, 48].map((h) => <option key={h} value={h}>{h ? t('pro.settings.hoursBefore', { count: h }) : t('pro.settings.anytime')}</option>)}
          </SelectField>
          <SelectField label={t('pro.settings.slotStep')} value={form.slotStepMin} onChange={(e) => set({ slotStepMin: Number(e.target.value) })}>
            {[10, 15, 20, 30, 60].map((m) => <option key={m} value={m}>{m} min</option>)}
          </SelectField>
          <SelectField label={t('pro.settings.minNotice')} value={form.minNoticeMin} onChange={(e) => set({ minNoticeMin: Number(e.target.value) })}>
            {[0, 30, 60, 120, 240, 1440].map((m) => <option key={m} value={m}>{m >= 60 ? `${m / 60} h` : `${m} min`}</option>)}
          </SelectField>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField label={t('pro.settings.deposit')} value={form.depositRule.type} onChange={(e) => {
            const type = e.target.value as DepositRule['type'];
            set({ depositRule: type === 'fixed' || type === 'percent' ? { type, value: depositValue || (type === 'percent' ? 20 : 2000) } : ({ type } as DepositRule) });
          }}>
            {(['none', 'fixed', 'percent', 'full'] as const).map((d) => <option key={d} value={d}>{t(`pro.settings.depositTypes.${d}`)}</option>)}
          </SelectField>
          {(form.depositRule.type === 'fixed' || form.depositRule.type === 'percent') && (
            <TextField
              label={form.depositRule.type === 'fixed' ? t('pro.settings.depositAmount') : t('pro.settings.depositPercent')}
              type="number" inputMode="numeric" min={0} max={form.depositRule.type === 'percent' ? 100 : undefined}
              value={depositValue}
              onChange={(e) => set({ depositRule: { type: form.depositRule.type as 'fixed' | 'percent', value: Number(e.target.value) } })}
            />
          )}
        </div>
        <fieldset>
          <legend className="label">{t('pro.settings.paymentOptions')}</legend>
          <div className="flex flex-wrap gap-2">
            {(['on_site', 'deposit', 'full'] as PaymentOption[]).map((o) => (
              <Chip key={o} active={form.paymentOptions.includes(o)} onClick={() => { const next = toggle(form.paymentOptions, o); if (next.length) set({ paymentOptions: next }); }}>{t(`booking.options.${o}`)}</Chip>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className="label">{t('pro.settings.paymentMethods')}</legend>
          <div className="flex flex-wrap gap-2">
            {(['mobile_money', 'card', 'cash'] as PaymentMethod[]).map((m) => (
              <Chip key={m} active={form.paymentMethods.includes(m)} onClick={() => { const next = toggle(form.paymentMethods, m); if (next.length) set({ paymentMethods: next }); }}>{t(`booking.methods.${m}`)}</Chip>
            ))}
          </div>
        </fieldset>
      </section>

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-sand bg-surface/95 backdrop-blur safe-bottom lg:left-64">
        <div className="mx-auto max-w-6xl px-4 pt-3 sm:px-6">
          <Button type="submit" size="lg" loading={save.isPending}>{t('common.save')}</Button>
        </div>
      </div>
    </form>
  );
}
