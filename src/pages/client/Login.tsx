import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { KeyRound, Store } from 'lucide-react';
import { useApp } from '@/app/AppContext';
import { ApiError } from '@/data/api';
import { DEMO_ACCOUNTS } from '@/data/demoAccounts';
import type { Profile } from '@/lib/types';
import { isValidNational, nationalNumber, toE164 } from '@/lib/phone';
import { Button } from '@/components/ui/Button';
import { PhoneInput } from '@/components/ui/PhoneInput';
import { TextField } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';

export function landingFor(p: Profile) {
  return p.role === 'admin' ? '/admin' : p.role === 'business_owner' || p.role === 'staff' ? '/business' : '/account/appointments';
}

export default function Login() {
  const { t } = useTranslation();
  const { api, ref, country: defaultCountry, setProfile } = useApp();
  const navigate = useNavigate();
  const toast = useToast();
  const [sp] = useSearchParams();
  const next = sp.get('next');
  const prefill = sp.get('phone') ?? '';
  const prefillCountry = ref.countries.find((c) => prefill.startsWith(c.dialCode)) ?? defaultCountry;
  const [mode, setMode] = useState<'phone' | 'email'>('phone');
  const [countryCode, setCountryCode] = useState(prefillCountry.code);
  const country = ref.countries.find((c) => c.code === countryCode) ?? defaultCountry;
  const [phone, setPhone] = useState(prefill ? nationalNumber(prefill, prefillCountry) : '');
  const [firstName, setFirstName] = useState(sp.get('name') ?? '');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState<{ devCode: string | null } | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string>();
  useDocumentTitle(t('login.title'));

  const done = (p: Profile) => {
    setProfile(p);
    toast(t('login.welcome', { name: p.firstName || '' }));
    navigate(next ?? landingFor(p), { replace: true });
  };
  const fail = (e: unknown) => {
    const c = e instanceof ApiError ? e.code : 'UNKNOWN';
    setError(c === 'INVALID_OTP' ? t('login.badCode') : c === 'INVALID_CREDENTIALS' ? t('login.badCredentials') : c === 'RATE_LIMITED' ? t('errors.rateLimited') : t('errors.generic'));
  };

  const send = useMutation({ mutationFn: () => api.sendOtp(toE164(phone, country)), onSuccess: (r) => { setCodeSent(r); setError(undefined); }, onError: fail });
  const verify = useMutation({ mutationFn: () => api.verifyOtp(toE164(phone, country), code, firstName), onSuccess: done, onError: fail });
  const signIn = useMutation({ mutationFn: (v: { email: string; password: string }) => api.signInWithPassword(v.email, v.password), onSuccess: done, onError: fail });

  const onPhone = (e: FormEvent) => {
    e.preventDefault();
    if (!isValidNational(phone, country)) return setError(t('validation.phone', { digits: country.phoneLength }));
    if (!codeSent) return send.mutate();
    if (!/^\d{6}$/.test(code)) return setError(t('login.codeFormat'));
    verify.mutate();
  };

  return (
    <div className="container-app max-w-md py-8">
      <h1 className="text-2xl">{t('login.title')}</h1>
      <p className="mt-2 text-stone">{t('login.subtitle')}</p>

      <div className="mt-6 inline-flex w-full rounded-full border border-sand bg-surface p-1" role="tablist">
        {(['phone', 'email'] as const).map((m) => (
          <button key={m} role="tab" aria-selected={mode === m} onClick={() => { setMode(m); setError(undefined); }} className={clsx('min-h-[40px] flex-1 rounded-full text-sm font-bold transition-colors duration-150', mode === m ? 'bg-ink text-ivory' : '')}>
            {t(`login.${m}`)}
          </button>
        ))}
      </div>

      {mode === 'phone' ? (
        <form onSubmit={onPhone} className="mt-6 space-y-5" noValidate>
          <PhoneInput label={t('fields.phone')} country={country} countries={ref.countries} onCountryChange={(c) => setCountryCode(c as typeof countryCode)} value={phone} onChange={(v) => { setPhone(v); setCodeSent(null); }} autoFocus={!prefill} />
          {codeSent && (
            <div className="space-y-5 animate-fade-up">
              <TextField
                label={t('login.code')}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                hint={codeSent.devCode ? t('login.devCode', { code: codeSent.devCode }) : t('login.codeSent')}
                autoFocus
              />
              <TextField label={t('fields.firstNameIfNew')} autoComplete="given-name" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
            </div>
          )}
          {error && <p className="text-sm text-danger" role="alert">{error}</p>}
          <Button type="submit" size="lg" block loading={send.isPending || verify.isPending}>
            {codeSent ? t('login.signIn') : t('login.sendCode')}
          </Button>
        </form>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); signIn.mutate({ email, password }); }} className="mt-6 space-y-5" noValidate>
          <TextField label={t('fields.email')} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
          <TextField label={t('fields.password')} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          {error && <p className="text-sm text-danger" role="alert">{error}</p>}
          <Button type="submit" size="lg" block loading={signIn.isPending}>{t('login.signIn')}</Button>
        </form>
      )}

      <section className="mt-10 rounded-card border border-dashed border-gold bg-gold-soft/50 p-4" aria-labelledby="demo-accounts">
        <h2 id="demo-accounts" className="flex items-center gap-2 font-sans text-sm font-bold">
          <KeyRound className="h-4 w-4" strokeWidth={1.75} aria-hidden />
          {t('login.demoAccounts')}
        </h2>
        <ul className="mt-3 space-y-3 text-sm">
          <li className="flex items-center justify-between gap-3">
            <span>
              <span className="font-bold">{t('login.demoClient')}</span>
              <br />
              <span className="text-stone">{DEMO_ACCOUNTS.client.phone} · {t('login.code')} {DEMO_ACCOUNTS.client.otp}</span>
            </span>
            <Button size="sm" variant="secondary" loading={verify.isPending} onClick={() => api.sendOtp(DEMO_ACCOUNTS.client.phone).then(() => api.verifyOtp(DEMO_ACCOUNTS.client.phone, DEMO_ACCOUNTS.client.otp)).then(done, fail)}>
              {t('login.use')}
            </Button>
          </li>
          {(['owner', 'admin'] as const).map((k) => (
            <li key={k} className="flex items-center justify-between gap-3">
              <span>
                <span className="font-bold">{t(k === 'owner' ? 'login.demoOwner' : 'login.demoAdmin')}</span>
                <br />
                <span className="text-stone">{DEMO_ACCOUNTS[k].email} · {DEMO_ACCOUNTS[k].password}</span>
              </span>
              <Button size="sm" variant="secondary" onClick={() => signIn.mutate({ email: DEMO_ACCOUNTS[k].email, password: DEMO_ACCOUNTS[k].password })}>
                {t('login.use')}
              </Button>
            </li>
          ))}
        </ul>
      </section>

      <Link to="/business/signup" className="mt-6 flex min-h-tap items-center justify-center gap-2 text-sm font-bold">
        <Store className="h-4 w-4" strokeWidth={1.75} aria-hidden />
        {t('login.areYouSalon')}
      </Link>
    </div>
  );
}
