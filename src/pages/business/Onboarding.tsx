import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Check, MessageCircle, Plus, Trash2 } from 'lucide-react';
import { useApp } from '@/app/AppContext';
import type { Business, BusinessHours } from '@/lib/types';
import { isValidNational, toE164 } from '@/lib/phone';
import { useFormat } from '@/hooks/useFormat';
import { usePersistentState } from '@/hooks/usePersistentState';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { Logo, Pattern } from '@/components/ui/Art';
import { Button, ButtonLink, IconButton } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { SelectField, TextArea, TextField } from '@/components/ui/Field';
import { PhoneInput } from '@/components/ui/PhoneInput';
import { Stepper } from '@/components/ui/Stepper';
import { useToast } from '@/components/ui/Toast';
import { HoursEditor, validHours } from './Hours';
import { DURATIONS } from './Services';

/** Suggested services per category (name key, duration, typical price in FCFA). */
const SUGGESTIONS: Record<string, [string, number, number][]> = {
  'coupe-homme': [['menCut', 30, 4000], ['fade', 45, 6000], ['kidsCut', 20, 2500]],
  barbe: [['beardTrim', 20, 2500], ['shave', 30, 4000]],
  braids: [['boxBraids', 240, 25000], ['knotless', 300, 35000], ['cornrows', 90, 12000]],
  tissage: [['sewIn', 120, 15000], ['wig', 60, 10000]],
  locks: [['locsStart', 180, 25000], ['locsRetwist', 90, 10000]],
  manucure: [['manicure', 45, 6000], ['gel', 75, 12000]],
  pedicure: [['pedicure', 60, 9000]],
  'soins-visage': [['facial', 60, 12000]],
};

type ServiceDraft = { name: string; categoryId: string; durationMin: number; price: number };
interface Draft {
  step: number;
  name: string;
  cityId: string;
  district: string;
  address: string;
  phone: string;
  audience: Business['audience'];
  description: string;
  services: ServiceDraft[];
  staff: { name: string; role: string }[];
  hours: Omit<BusinessHours, 'businessId'>[];
}

export default function Onboarding() {
  const { t } = useTranslation();
  const fmt = useFormat();
  const { api, ref, profile, country: defaultCountry } = useApp();
  const qc = useQueryClient();
  const toast = useToast();
  useDocumentTitle(t('pro.onboarding.title'));
  const firstCity = ref.cities.find((c) => c.countryCode === (profile?.countryCode ?? defaultCountry.code)) ?? ref.cities[0];
  const [d, setD, clear] = usePersistentState<Draft>('kuzuri-onboarding', {
    step: 0,
    name: '',
    cityId: firstCity.id,
    district: '',
    address: '',
    phone: '',
    audience: 'unisex',
    description: '',
    services: [],
    staff: [{ name: profile?.firstName ?? '', role: t('pro.onboarding.ownerRole') }],
    hours: [1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opens: '09:00', closes: '19:00', breakStart: null, breakEnd: null })),
  });
  const set = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }));
  const [error, setError] = useState<string>();
  const [created, setCreated] = useState<Business | null>(null);
  const city = ref.cities.find((c) => c.id === d.cityId)!;
  const country = ref.countries.find((c) => c.code === city.countryCode)!;

  const create = useMutation({
    mutationFn: () =>
      api.createBusiness({
        ownerId: profile!.id,
        name: d.name.trim(),
        cityId: d.cityId,
        district: d.district.trim(),
        address: d.address.trim(),
        phone: toE164(d.phone, country),
        description: d.description.trim() || t('pro.onboarding.defaultDescription', { name: d.name.trim(), district: d.district.trim() }),
        audience: d.audience,
        services: d.services,
        staff: d.staff.filter((s) => s.name.trim()),
        hours: d.hours,
      }),
    onSuccess: (b) => {
      clear();
      setCreated(b);
      void qc.invalidateQueries({ queryKey: ['me', 'business'] });
      void qc.invalidateQueries({ queryKey: ['search'] });
    },
    onError: () => toast(t('errors.generic'), 'error'),
  });

  const next = () => {
    setError(undefined);
    if (d.step === 0) {
      if (!d.name.trim() || !d.district.trim()) return setError(t('pro.onboarding.infoRequired'));
      if (!isValidNational(d.phone, country)) return setError(t('validation.phone', { digits: country.phoneLength }));
    }
    if (d.step === 1 && (!d.services.length || d.services.some((s) => !s.name.trim() || s.price < 0))) return setError(t('pro.onboarding.servicesRequired'));
    if (d.step === 2 && !d.staff.some((s) => s.name.trim())) return setError(t('pro.onboarding.staffRequired'));
    if (d.step === 3) {
      if (!d.hours.length || !validHours(d.hours)) return setError(t('pro.hours.invalid'));
      return create.mutate();
    }
    set({ step: d.step + 1 });
  };

  if (created) {
    const url = `${window.location.origin}/salon/${created.slug}`;
    return (
      <div className="relative min-h-dvh">
        <Pattern className="absolute inset-x-0 top-0 h-64" opacity={0.08} />
        <div className="container-app relative max-w-md py-10 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-forest animate-pop"><Check className="h-8 w-8 text-white" strokeWidth={2.5} /></div>
          <h1 className="mt-6 text-2xl">{t('pro.onboarding.doneTitle')}</h1>
          <p className="mt-2 text-stone">{t('pro.onboarding.doneBody')}</p>
          <div className="mt-8 space-y-3">
            <a href={`https://wa.me/?text=${encodeURIComponent(t('pro.onboarding.shareText', { name: created.name, url }))}`} target="_blank" rel="noreferrer" className="inline-flex min-h-[52px] w-full items-center justify-center gap-2 rounded-full bg-terracotta px-6 font-bold text-white">
              <MessageCircle className="h-5 w-5" strokeWidth={1.75} aria-hidden />
              {t('pro.onboarding.shareWhatsapp')}
            </a>
            <ButtonLink to={`/salon/${created.slug}`} variant="secondary" size="lg" block>{t('pro.onboarding.preview')}</ButtonLink>
            <ButtonLink to="/business" variant="ghost" size="lg" block>{t('pro.onboarding.toDashboard')}</ButtonLink>
          </div>
        </div>
      </div>
    );
  }

  const titles = [t('pro.onboarding.steps.info'), t('pro.onboarding.steps.services'), t('pro.onboarding.steps.team'), t('pro.onboarding.steps.hours')];
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-sand/70 bg-ivory/95 backdrop-blur">
        <div className="container-app max-w-xl pb-3 pt-2">
          <div className="flex items-center gap-2">
            {d.step > 0 ? (
              <IconButton label={t('common.back')} onClick={() => set({ step: d.step - 1 })} className="-ml-2"><ArrowLeft className="h-5 w-5" strokeWidth={1.75} /></IconButton>
            ) : (
              <Link to="/" className="py-2"><Logo /></Link>
            )}
            <div className="min-w-0 flex-1">
              {d.step > 0 && <p className="text-xs text-stone">{t('pro.onboarding.title')}</p>}
              {d.step > 0 && <h1 className="font-sans text-lg font-bold">{titles[d.step]}</h1>}
            </div>
            <span className="text-sm text-stone">{d.step + 1}/4</span>
          </div>
          <div className="mt-2"><Stepper steps={4} current={d.step} label={titles[d.step]} /></div>
        </div>
      </header>

      <main className="container-app max-w-xl pb-32 pt-5">
        <div className="animate-fade-up" key={d.step}>
          {d.step === 0 && (
            <div className="space-y-5">
              <div>
                <h1 className="text-2xl">{t('pro.onboarding.welcome')}</h1>
                <p className="mt-1 text-stone">{t('pro.onboarding.welcomeBody')}</p>
              </div>
              <TextField label={t('pro.onboarding.name')} value={d.name} onChange={(e) => set({ name: e.target.value })} autoFocus />
              <div className="grid gap-4 sm:grid-cols-2">
                <SelectField label={t('pro.onboarding.city')} value={d.cityId} onChange={(e) => set({ cityId: e.target.value })}>
                  {ref.countries.map((c) => (
                    <optgroup key={c.code} label={`${c.flag} ${c.name}`}>
                      {ref.cities.filter((x) => x.countryCode === c.code).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                    </optgroup>
                  ))}
                </SelectField>
                <TextField label={t('pro.onboarding.district')} value={d.district} onChange={(e) => set({ district: e.target.value })} />
              </div>
              <TextField label={t('salon.address')} value={d.address} onChange={(e) => set({ address: e.target.value })} />
              <PhoneInput label={t('pro.onboarding.whatsapp')} country={country} value={d.phone} onChange={(phone) => set({ phone })} />
              <fieldset>
                <legend className="label">{t('search.audience')}</legend>
                <div className="flex gap-2">
                  {(['unisex', 'women', 'men'] as const).map((a) => <Chip key={a} active={d.audience === a} onClick={() => set({ audience: a })}>{t(`pro.settings.audiences.${a}`)}</Chip>)}
                </div>
              </fieldset>
              <TextArea label={t('pro.onboarding.descriptionOptional')} value={d.description} onChange={(e) => set({ description: e.target.value })} />
            </div>
          )}

          {d.step === 1 && (
            <div className="space-y-5">
              <p className="text-stone">{t('pro.onboarding.servicesHint')}</p>
              <div className="flex flex-wrap gap-2">
                {ref.categories.map((c) => {
                  const on = d.services.some((s) => s.categoryId === c.id);
                  return (
                    <Chip
                      key={c.id}
                      active={on}
                      onClick={() =>
                        set({
                          services: on
                            ? d.services.filter((s) => s.categoryId !== c.id)
                            : [...d.services, ...(SUGGESTIONS[c.slug] ?? []).map(([key, durationMin, price]) => ({ name: t(`pro.onboarding.suggestions.${key}` as never), categoryId: c.id, durationMin, price }))],
                        })
                      }
                    >
                      {t(`categories.${c.key}` as never)}
                    </Chip>
                  );
                })}
              </div>
              {d.services.length > 0 && (
                <ul className="card divide-y divide-sand">
                  {d.services.map((s, i) => (
                    <li key={i} className="grid grid-cols-[1fr_auto] gap-2 p-3 sm:grid-cols-[1fr_110px_120px_auto] sm:items-end">
                      <TextField label={t('pro.services.name')} value={s.name} onChange={(e) => set({ services: d.services.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
                      <IconButton label={t('common.delete')} className="self-end sm:order-last" onClick={() => set({ services: d.services.filter((_, j) => j !== i) })}><Trash2 className="h-4 w-4" strokeWidth={1.75} /></IconButton>
                      <SelectField label={t('pro.services.duration')} value={s.durationMin} onChange={(e) => set({ services: d.services.map((x, j) => (j === i ? { ...x, durationMin: Number(e.target.value) } : x)) })}>
                        {DURATIONS.map((m) => <option key={m} value={m}>{fmt.duration(m)}</option>)}
                      </SelectField>
                      <TextField label={t('pro.services.price')} type="number" inputMode="numeric" step={500} min={0} value={s.price} onChange={(e) => set({ services: d.services.map((x, j) => (j === i ? { ...x, price: Number(e.target.value) } : x)) })} />
                    </li>
                  ))}
                </ul>
              )}
              <Button variant="secondary" icon={<Plus className="h-4 w-4" strokeWidth={2} aria-hidden />} onClick={() => set({ services: [...d.services, { name: '', categoryId: ref.categories[0].id, durationMin: 30, price: 5000 }] })}>
                {t('pro.services.add')}
              </Button>
            </div>
          )}

          {d.step === 2 && (
            <div className="space-y-4">
              <p className="text-stone">{t('pro.onboarding.teamHint')}</p>
              {d.staff.map((s, i) => (
                <div key={i} className="card grid grid-cols-[1fr_1fr_auto] items-end gap-2 p-3">
                  <TextField label={t('fields.firstName')} value={s.name} onChange={(e) => set({ staff: d.staff.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
                  <TextField label={t('pro.team.role')} value={s.role} onChange={(e) => set({ staff: d.staff.map((x, j) => (j === i ? { ...x, role: e.target.value } : x)) })} />
                  <IconButton label={t('common.delete')} disabled={d.staff.length === 1} onClick={() => set({ staff: d.staff.filter((_, j) => j !== i) })}><Trash2 className="h-4 w-4" strokeWidth={1.75} /></IconButton>
                </div>
              ))}
              <Button variant="secondary" icon={<Plus className="h-4 w-4" strokeWidth={2} aria-hidden />} onClick={() => set({ staff: [...d.staff, { name: '', role: '' }] })}>{t('pro.team.add')}</Button>
            </div>
          )}

          {d.step === 3 && (
            <div>
              <p className="text-stone">{t('pro.onboarding.hoursHint')}</p>
              <div className="card mt-4 px-4"><HoursEditor hours={d.hours} onChange={(hours) => set({ hours })} /></div>
            </div>
          )}
        </div>
      </main>

      <footer className="fixed inset-x-0 bottom-0 z-30 border-t border-sand bg-surface/95 backdrop-blur safe-bottom">
        <div className="container-app max-w-xl pt-3">
          {error && <p className="mb-2 text-sm text-danger" role="alert">{error}</p>}
          <Button size="lg" block loading={create.isPending} onClick={next}>{d.step === 3 ? t('pro.onboarding.finish') : t('common.continue')}</Button>
        </div>
      </footer>
    </div>
  );
}
