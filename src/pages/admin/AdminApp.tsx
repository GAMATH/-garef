import { useState } from 'react';
import { Link, Navigate, NavLink, Route, Routes, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { LogOut, MessageSquare, Plus, RefreshCcw } from 'lucide-react';
import clsx from 'clsx';
import { useApp } from '@/app/AppContext';
import type { Category, City, Country } from '@/lib/types';
import { useFormat } from '@/hooks/useFormat';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { formatE164 } from '@/lib/phone';
import { OPERATOR_LABELS } from '@/lib/payments';
import { Logo } from '@/components/ui/Art';
import { Badge, DemoBadge, PaymentBadge, StatusBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { SelectField, TextField } from '@/components/ui/Field';
import { EmptyState, ErrorState } from '@/components/ui/EmptyState';
import { ListSkeleton, Skeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';

const TABS = ['overview', 'salons', 'users', 'bookings', 'payments', 'messages', 'reference'] as const;

export default function AdminApp() {
  const { t } = useTranslation();
  const { profile, signOut } = useApp();
  const navigate = useNavigate();
  useDocumentTitle(t('admin.title'));
  if (!profile) return <Navigate to="/login?next=/admin" replace />;
  if (profile.role !== 'admin') return <Navigate to="/" replace />;
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-sand bg-surface/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4">
          <Link to="/"><Logo /></Link>
          <Badge tone="primary">{t('admin.badge')}</Badge>
          <div className="flex-1" />
          <button type="button" onClick={async () => { await signOut(); navigate('/'); }} className="flex min-h-tap items-center gap-2 rounded-full px-3 text-sm font-medium hover:bg-sand/60">
            <LogOut className="h-4 w-4" strokeWidth={1.75} aria-hidden />
            <span className="sr-only sm:not-sr-only">{t('profile.signOut')}</span>
          </button>
        </div>
        <nav className="no-scrollbar mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4 pb-2" aria-label={t('admin.title')}>
          {TABS.map((k) => (
            <NavLink key={k} to={k === 'overview' ? '/admin' : `/admin/${k}`} end className={({ isActive }) => clsx('min-h-[40px] shrink-0 rounded-full px-4 py-2 text-sm font-medium', isActive ? 'bg-ink text-ivory' : 'hover:bg-sand/60')}>
              {t(`admin.tabs.${k}`)}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">
        <Routes>
          <Route index element={<Overview />} />
          <Route path="salons" element={<Salons />} />
          <Route path="users" element={<Users />} />
          <Route path="bookings" element={<BookingsTab />} />
          <Route path="payments" element={<Payments />} />
          <Route path="messages" element={<Messages />} />
          <Route path="reference" element={<ReferenceTab />} />
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Routes>
      </main>
    </div>
  );
}

function Overview() {
  const { t } = useTranslation();
  const fmt = useFormat();
  const { api } = useApp();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['admin', 'stats'], queryFn: () => api.adminStats() });
  const reset = useMutation({ mutationFn: () => api.resetDemo!(), onSuccess: () => { qc.clear(); toast(t('admin.resetDone')); setTimeout(() => window.location.reload(), 600); } });
  if (q.isError) return <ErrorState onRetry={() => q.refetch()} />;
  const kpis = q.data ? [
    { label: t('admin.kpi.bookings'), value: String(q.data.bookings) },
    { label: t('admin.kpi.gmv'), value: fmt.money(q.data.gmv) },
    { label: t('admin.kpi.salons'), value: String(q.data.activeSalons) },
    { label: t('admin.kpi.users'), value: String(q.data.users) },
  ] : null;
  return (
    <>
      <h1 className="text-2xl">{t('admin.tabs.overview')}</h1>
      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpis ? kpis.map((k) => (
          <div key={k.label} className="card p-4"><p className="text-sm text-stone">{k.label}</p><p className="mt-1 font-display text-xl font-semibold tabular-nums">{k.value}</p></div>
        )) : [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[84px]" />)}
      </div>
      {api.resetDemo && (
        <div className="card mt-6 flex flex-wrap items-center justify-between gap-3 p-4">
          <div>
            <p className="font-bold">{t('admin.demoData')}</p>
            <p className="text-sm text-stone">{t('admin.demoDataBody')}</p>
          </div>
          <Button variant="secondary" icon={<RefreshCcw className="h-4 w-4" strokeWidth={1.75} aria-hidden />} loading={reset.isPending} onClick={() => reset.mutate()}>{t('admin.reset')}</Button>
        </div>
      )}
    </>
  );
}

function Table({ head, children, empty }: { head: string[]; children: React.ReactNode; empty?: boolean }) {
  const { t } = useTranslation();
  if (empty) return <div className="card"><EmptyState title={t('admin.empty')} /></div>;
  return (
    <div className="card overflow-x-auto">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead className="border-b border-sand text-stone"><tr>{head.map((h) => <th key={h} className="px-4 py-3 font-medium">{h}</th>)}</tr></thead>
        <tbody className="divide-y divide-sand">{children}</tbody>
      </table>
    </div>
  );
}

function Salons() {
  const { t } = useTranslation();
  const { api } = useApp();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin', 'businesses'], queryFn: () => api.adminListBusinesses() });
  const m = useMutation({
    mutationFn: (v: { id: string; status: 'active' | 'suspended' }) => api.adminSetBusinessStatus(v.id, v.status),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['admin'] }); void qc.invalidateQueries({ queryKey: ['search'] }); },
  });
  if (q.isPending) return <ListSkeleton rows={8} />;
  if (q.isError) return <ErrorState onRetry={() => q.refetch()} />;
  return (
    <Table head={[t('admin.cols.salon'), t('admin.cols.city'), t('admin.cols.rating'), t('admin.cols.status'), '']} empty={!q.data.length}>
      {q.data.map((b) => (
        <tr key={b.id}>
          <td className="px-4 py-3"><Link to={`/salon/${b.slug}`} className="font-bold hover:underline">{b.name}</Link> {b.isDemo && <DemoBadge />}</td>
          <td className="px-4 py-3">{b.district}, {b.city.name}</td>
          <td className="px-4 py-3">{b.ratingCount ? `${b.ratingAvg.toFixed(1)} (${b.ratingCount})` : '—'}</td>
          <td className="px-4 py-3"><Badge tone={b.status === 'active' ? 'success' : 'danger'}>{t(`admin.salonStatus.${b.status}`)}</Badge></td>
          <td className="px-4 py-3 text-right">
            <Button size="sm" variant={b.status === 'active' ? 'danger' : 'secondary'} loading={m.isPending && m.variables?.id === b.id} onClick={() => m.mutate({ id: b.id, status: b.status === 'active' ? 'suspended' : 'active' })}>
              {b.status === 'active' ? t('admin.suspend') : t('admin.activate')}
            </Button>
          </td>
        </tr>
      ))}
    </Table>
  );
}

function Users() {
  const { t } = useTranslation();
  const fmt = useFormat();
  const { api, ref } = useApp();
  const q = useQuery({ queryKey: ['admin', 'profiles'], queryFn: () => api.adminListProfiles() });
  if (q.isPending) return <ListSkeleton rows={6} />;
  if (q.isError) return <ErrorState onRetry={() => q.refetch()} />;
  return (
    <Table head={[t('fields.firstName'), t('fields.phone'), t('fields.email'), t('admin.cols.role'), t('admin.cols.created')]} empty={!q.data.length}>
      {q.data.map((p) => (
        <tr key={p.id}>
          <td className="px-4 py-3 font-medium">{p.firstName} {p.lastName}</td>
          <td className="px-4 py-3">{p.phone ? formatE164(p.phone, ref.countries) : '—'}</td>
          <td className="px-4 py-3">{p.email || '—'}</td>
          <td className="px-4 py-3"><Badge>{t(`admin.roles.${p.role}`)}</Badge></td>
          <td className="px-4 py-3">{fmt.date(p.createdAt)}</td>
        </tr>
      ))}
    </Table>
  );
}

function BookingsTab() {
  const { t } = useTranslation();
  const fmt = useFormat();
  const { api } = useApp();
  const q = useQuery({ queryKey: ['admin', 'appointments'], queryFn: () => api.adminListAppointments() });
  if (q.isPending) return <ListSkeleton rows={8} />;
  if (q.isError) return <ErrorState onRetry={() => q.refetch()} />;
  return (
    <Table head={[t('success.reference'), t('admin.cols.salon'), t('pro.bookings.date'), t('pro.calendar.client'), t('booking.total'), t('pro.bookings.status')]} empty={!q.data.length}>
      {q.data.map((a) => (
        <tr key={a.id}>
          <td className="px-4 py-3 font-mono text-xs">{a.reference}</td>
          <td className="px-4 py-3">{a.business.name}</td>
          <td className="whitespace-nowrap px-4 py-3 first-letter:uppercase">{fmt.shortDate(a.startsAt, a.city.timezone)} · {fmt.time(a.startsAt, a.city.timezone)}</td>
          <td className="px-4 py-3">{a.client.firstName} {a.client.lastName}</td>
          <td className="px-4 py-3 tabular-nums">{fmt.money(a.total)}</td>
          <td className="px-4 py-3"><div className="flex flex-wrap gap-1"><StatusBadge status={a.status} /><PaymentBadge status={a.paymentStatus} /></div></td>
        </tr>
      ))}
    </Table>
  );
}

function Payments() {
  const { t } = useTranslation();
  const fmt = useFormat();
  const { api } = useApp();
  const q = useQuery({ queryKey: ['admin', 'payments'], queryFn: () => api.adminListPayments() });
  if (q.isPending) return <ListSkeleton rows={8} />;
  if (q.isError) return <ErrorState onRetry={() => q.refetch()} />;
  return (
    <Table head={[t('admin.cols.date'), t('admin.cols.provider'), t('admin.cols.amount'), t('admin.cols.status'), t('admin.cols.ref')]} empty={!q.data.length}>
      {q.data.map((p) => (
        <tr key={p.id}>
          <td className="px-4 py-3">{fmt.dateTime(p.createdAt)}</td>
          <td className="px-4 py-3">{p.provider in OPERATOR_LABELS ? OPERATOR_LABELS[p.provider as keyof typeof OPERATOR_LABELS] : t(`booking.methods.${p.method}`)}</td>
          <td className="px-4 py-3 tabular-nums">{fmt.money(p.amount)}</td>
          <td className="px-4 py-3"><Badge tone={p.status === 'succeeded' ? 'success' : p.status === 'failed' ? 'danger' : p.status === 'pending' ? 'warning' : 'neutral'}>{t(`admin.paymentStatus.${p.status}`)}</Badge></td>
          <td className="px-4 py-3 font-mono text-xs">{p.providerRef}</td>
        </tr>
      ))}
    </Table>
  );
}

function Messages() {
  const { t } = useTranslation();
  const fmt = useFormat();
  const { api } = useApp();
  const q = useQuery({ queryKey: ['admin', 'notifications'], queryFn: () => api.adminListNotifications(), refetchInterval: 5000 });
  if (q.isPending) return <ListSkeleton rows={6} />;
  if (q.isError) return <ErrorState onRetry={() => q.refetch()} />;
  return (
    <>
      <h1 className="text-2xl">{t('admin.tabs.messages')}</h1>
      <p className="mt-1 text-stone">{t('admin.messagesHint')}</p>
      {q.data.length === 0 ? (
        <div className="card mt-4"><EmptyState icon={<MessageSquare strokeWidth={1.75} />} title={t('admin.noMessages')} /></div>
      ) : (
        <ul className="mt-4 space-y-2">
          {q.data.map((n) => (
            <li key={n.id} className="card p-4">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Badge tone={n.channel === 'whatsapp' ? 'success' : n.channel === 'sms' ? 'gold' : 'neutral'}>{t(`admin.channels.${n.channel}`)}</Badge>
                <span className="font-bold">{t(`admin.events.${n.event}`)}</span>
                <span className="text-stone">→ {n.recipient}</span>
                <span className="ml-auto text-xs text-stone">{fmt.dateTime(n.createdAt)}</span>
              </div>
              <p className="mt-2 text-sm">{n.body}</p>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function ReferenceTab() {
  const { t } = useTranslation();
  const { api, ref } = useApp();
  const qc = useQueryClient();
  const toast = useToast();
  const [city, setCity] = useState<City | null>(null);
  const [category, setCategory] = useState<Category | null>(null);
  const [country, setCountry] = useState<Country | null>(null);
  const done = () => { toast(t('common.saved')); void qc.invalidateQueries({ queryKey: ['reference'] }); setCity(null); setCategory(null); setCountry(null); };
  const saveCity = useMutation({ mutationFn: (c: City) => api.adminSaveCity(c), onSuccess: done });
  const saveCategory = useMutation({ mutationFn: (c: Category) => api.adminSaveCategory(c), onSuccess: done });
  const saveCountry = useMutation({ mutationFn: (c: Country) => api.adminSaveCountry(c), onSuccess: done });
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <section className="card p-4">
        <h2 className="font-sans text-base font-bold">{t('admin.countries')}</h2>
        <ul className="mt-3 divide-y divide-sand text-sm">
          {ref.countries.map((c) => (
            <li key={c.code}><button type="button" className="flex min-h-tap w-full items-center justify-between text-left" onClick={() => setCountry(c)}><span>{c.flag} {c.name}</span><span className="text-stone">{c.dialCode} · {c.currency}</span></button></li>
          ))}
        </ul>
      </section>
      <section className="card p-4">
        <div className="flex items-center justify-between">
          <h2 className="font-sans text-base font-bold">{t('admin.cities')}</h2>
          <Button size="sm" variant="ghost" icon={<Plus className="h-4 w-4" strokeWidth={2} aria-hidden />} onClick={() => setCity({ id: '', countryCode: ref.countries[0].code, name: '', slug: '', timezone: ref.countries[0].timezone, lat: 0, lng: 0 })}>{t('common.add')}</Button>
        </div>
        <ul className="mt-3 divide-y divide-sand text-sm">
          {ref.cities.map((c) => (
            <li key={c.id}><button type="button" className="flex min-h-tap w-full items-center justify-between text-left" onClick={() => setCity(c)}><span>{c.name}</span><span className="text-stone">{c.countryCode} · {c.timezone}</span></button></li>
          ))}
        </ul>
      </section>
      <section className="card p-4">
        <div className="flex items-center justify-between">
          <h2 className="font-sans text-base font-bold">{t('admin.categories')}</h2>
          <Button size="sm" variant="ghost" icon={<Plus className="h-4 w-4" strokeWidth={2} aria-hidden />} onClick={() => setCategory({ id: '', slug: '', key: '', sort: ref.categories.length + 1 })}>{t('common.add')}</Button>
        </div>
        <ul className="mt-3 divide-y divide-sand text-sm">
          {ref.categories.map((c) => (
            <li key={c.id}><button type="button" className="flex min-h-tap w-full items-center justify-between text-left" onClick={() => setCategory(c)}><span>{t(`categories.${c.key}` as never, { defaultValue: c.slug })}</span><span className="text-stone">/{c.slug}</span></button></li>
          ))}
        </ul>
      </section>

      {city && (
        <BottomSheet open onClose={() => setCity(null)} title={t('admin.cities')} footer={<Button block onClick={() => saveCity.mutate({ ...city, slug: city.slug || city.name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-') })} loading={saveCity.isPending}>{t('common.save')}</Button>}>
          <div className="space-y-4">
            <TextField label={t('admin.cols.city')} value={city.name} onChange={(e) => setCity({ ...city, name: e.target.value })} />
            <SelectField label={t('profile.country')} value={city.countryCode} onChange={(e) => { const c = ref.countries.find((x) => x.code === e.target.value)!; setCity({ ...city, countryCode: c.code, timezone: c.timezone }); }}>
              {ref.countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
            </SelectField>
            <TextField label={t('admin.timezone')} value={city.timezone} onChange={(e) => setCity({ ...city, timezone: e.target.value })} />
            <div className="grid grid-cols-2 gap-3">
              <TextField label={t('admin.lat')} type="number" step="0.0001" value={city.lat} onChange={(e) => setCity({ ...city, lat: Number(e.target.value) })} />
              <TextField label={t('admin.lng')} type="number" step="0.0001" value={city.lng} onChange={(e) => setCity({ ...city, lng: Number(e.target.value) })} />
            </div>
          </div>
        </BottomSheet>
      )}
      {category && (
        <BottomSheet open onClose={() => setCategory(null)} title={t('admin.categories')} footer={<Button block onClick={() => saveCategory.mutate({ ...category, key: category.key || category.slug })} loading={saveCategory.isPending}>{t('common.save')}</Button>}>
          <div className="space-y-4">
            <TextField label={t('admin.slug')} value={category.slug} onChange={(e) => setCategory({ ...category, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })} hint={t('admin.slugHint')} />
            <TextField label={t('admin.i18nKey')} value={category.key} onChange={(e) => setCategory({ ...category, key: e.target.value })} />
            <TextField label={t('admin.sort')} type="number" value={category.sort} onChange={(e) => setCategory({ ...category, sort: Number(e.target.value) })} />
          </div>
        </BottomSheet>
      )}
      {country && (
        <BottomSheet open onClose={() => setCountry(null)} title={`${country.flag} ${country.name}`} footer={<Button block onClick={() => saveCountry.mutate(country)} loading={saveCountry.isPending}>{t('common.save')}</Button>}>
          <div className="space-y-4">
            <TextField label={t('admin.countryName')} value={country.name} onChange={(e) => setCountry({ ...country, name: e.target.value })} />
            <TextField label={t('admin.dialCode')} value={country.dialCode} onChange={(e) => setCountry({ ...country, dialCode: e.target.value })} />
            <fieldset>
              <legend className="label">{t('admin.operators')}</legend>
              <div className="flex flex-wrap gap-2">
                {(Object.keys(OPERATOR_LABELS) as (keyof typeof OPERATOR_LABELS)[]).map((op) => (
                  <label key={op} className="flex min-h-[40px] items-center gap-2 rounded-full border border-sand px-3 text-sm">
                    <input type="checkbox" className="accent-terracotta" checked={country.operators.includes(op)} onChange={() => setCountry({ ...country, operators: country.operators.includes(op) ? country.operators.filter((x) => x !== op) : [...country.operators, op] })} />
                    {OPERATOR_LABELS[op]}
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
        </BottomSheet>
      )}
    </div>
  );
}
