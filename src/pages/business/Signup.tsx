import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { useApp } from '@/app/AppContext';
import { ApiError } from '@/data/api';
import { isValidNational, toE164 } from '@/lib/phone';
import { Logo, Pattern } from '@/components/ui/Art';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/Field';
import { PhoneInput } from '@/components/ui/PhoneInput';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';

export default function Signup() {
  const { t } = useTranslation();
  const { api, ref, country: defaultCountry, setProfile } = useApp();
  const navigate = useNavigate();
  useDocumentTitle(t('pro.signup.title'));
  const [countryCode, setCountryCode] = useState(defaultCountry.code);
  const country = ref.countries.find((c) => c.code === countryCode)!;
  const [form, setForm] = useState({ firstName: '', email: '', password: '', phone: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const schema = z.object({
    firstName: z.string().trim().min(1, t('validation.firstName')),
    email: z.string().trim().email(t('validation.email')),
    password: z.string().min(8, t('validation.password')),
    phone: z.string().refine((v) => isValidNational(v, country), t('validation.phone', { digits: country.phoneLength })),
  });
  const m = useMutation({
    mutationFn: () => api.signUpOwner({ ...form, phone: toE164(form.phone, country) }),
    onSuccess: (p) => { setProfile(p); navigate('/business/onboarding'); },
    onError: (e) => setErrors({ form: e instanceof ApiError && e.code === 'EMAIL_TAKEN' ? t('pro.signup.emailTaken') : t('errors.generic') }),
  });
  return (
    <div className="relative min-h-dvh">
      <Pattern className="absolute inset-x-0 top-0 h-48" opacity={0.06} />
      <div className="container-app relative max-w-md py-8">
        <Link to="/"><Logo /></Link>
        <h1 className="mt-8 text-2xl">{t('pro.signup.title')}</h1>
        <p className="mt-2 text-stone">{t('pro.signup.subtitle')}</p>
        <form
          className="mt-6 space-y-5"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            const r = schema.safeParse(form);
            if (!r.success) return setErrors(Object.fromEntries(r.error.issues.map((i) => [i.path[0] as string, i.message])));
            setErrors({});
            m.mutate();
          }}
        >
          <TextField label={t('fields.firstName')} autoComplete="given-name" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} error={errors.firstName} />
          <TextField label={t('fields.email')} type="email" autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} error={errors.email} />
          <TextField label={t('fields.password')} type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} error={errors.password} hint={t('validation.password')} />
          <PhoneInput label={t('fields.phone')} country={country} countries={ref.countries} onCountryChange={(c) => setCountryCode(c as typeof countryCode)} value={form.phone} onChange={(phone) => setForm({ ...form, phone })} error={errors.phone} />
          {errors.form && <p className="text-sm text-danger" role="alert">{errors.form}</p>}
          <Button type="submit" size="lg" block loading={m.isPending}>{t('pro.signup.cta')}</Button>
        </form>
        <p className="mt-6 text-center text-sm">
          {t('pro.signup.already')} <Link to="/login?next=/business" className="font-bold text-terracotta">{t('login.signIn')}</Link>
        </p>
      </div>
    </div>
  );
}
