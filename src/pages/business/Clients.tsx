import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { MessageCircle, Phone, UserSquare2 } from 'lucide-react';
import { useApp } from '@/app/AppContext';
import { useFormat } from '@/hooks/useFormat';
import { useDebounced } from '@/hooks/useDebounced';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { formatE164, whatsappLink } from '@/lib/phone';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/ui/Badge';
import { EmptyState, ErrorState } from '@/components/ui/EmptyState';
import { ListSkeleton } from '@/components/ui/Skeleton';
import { TextArea } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { useBusiness } from './BusinessContext';
import { PageHeader } from './BusinessLayout';

export default function Clients() {
  const { t } = useTranslation();
  const fmt = useFormat();
  const { api, ref } = useApp();
  const { business, tz } = useBusiness();
  useDocumentTitle(t('pro.nav.clients'));
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search, 200);
  const [open, setOpen] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['pro', 'clients', business.id, debounced], queryFn: () => api.listClients(business.id, debounced) });

  return (
    <>
      <PageHeader title={t('pro.nav.clients')} subtitle={q.data ? t('pro.clients.count', { count: q.data.length }) : undefined} />
      <input className="field max-w-md" type="search" placeholder={t('pro.clients.search')} aria-label={t('pro.clients.search')} value={search} onChange={(e) => setSearch(e.target.value)} />
      <div className="mt-4">
        {q.isPending ? (
          <ListSkeleton rows={6} />
        ) : q.isError ? (
          <ErrorState onRetry={() => q.refetch()} />
        ) : q.data.length === 0 ? (
          <div className="card"><EmptyState icon={<UserSquare2 strokeWidth={1.75} />} title={t('pro.clients.empty')} /></div>
        ) : (
          <ul className="card divide-y divide-sand">
            {q.data.map((c) => (
              <li key={c.id}>
                <button type="button" onClick={() => setOpen(c.id)} className="flex min-h-[64px] w-full items-center gap-4 px-4 py-3 text-left hover:bg-sand-light">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-bold">{c.firstName} {c.lastName}</span>
                    <span className="block text-sm text-stone">{formatE164(c.phone, ref.countries)}</span>
                  </span>
                  <span className="hidden text-right text-sm sm:block">
                    <span className="block">{t('pro.clients.visits', { count: c.visits })}</span>
                    <span className="block text-stone">{c.lastVisit ? t('pro.clients.lastVisit', { date: fmt.shortDate(c.lastVisit, tz) }) : t('pro.clients.never')}</span>
                  </span>
                  <span className="w-24 text-right font-bold tabular-nums">{fmt.money(c.spent)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {open && <ClientSheet id={open} onClose={() => setOpen(null)} />}
    </>
  );
}

function ClientSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const { api, ref } = useApp();
  const { tz } = useBusiness();
  const qc = useQueryClient();
  const toast = useToast();
  const [note, setNote] = useState('');
  const q = useQuery({ queryKey: ['pro', 'client', id], queryFn: () => api.getClient(id) });
  const add = useMutation({
    mutationFn: () => api.addClientNote(id, note),
    onSuccess: () => {
      setNote('');
      toast(t('pro.clients.noteAdded'));
      void qc.invalidateQueries({ queryKey: ['pro', 'client', id] });
    },
  });
  const c = q.data?.client;
  return (
    <BottomSheet open onClose={onClose} title={c ? `${c.firstName} ${c.lastName}`.trim() : t('pro.nav.clients')}>
      {q.isPending ? (
        <ListSkeleton rows={3} />
      ) : q.isError || !c ? (
        <ErrorState onRetry={() => q.refetch()} />
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-3 gap-2 text-center">
            <Stat label={t('pro.clients.visitsLabel')} value={String(c.visits)} />
            <Stat label={t('pro.clients.spent')} value={fmt.money(c.spent)} />
            <Stat label={t('pro.clients.last')} value={c.lastVisit ? fmt.shortDate(c.lastVisit, tz) : '—'} />
          </div>
          <div className="flex gap-2">
            <a href={`tel:${c.phone}`} className="inline-flex min-h-tap flex-1 items-center justify-center gap-2 rounded-full border border-sand text-sm font-bold"><Phone className="h-4 w-4" strokeWidth={1.75} aria-hidden />{formatE164(c.phone, ref.countries)}</a>
            <a href={whatsappLink(c.phone, t('pro.waClient', { name: c.firstName }))} target="_blank" rel="noreferrer" className="inline-flex min-h-tap items-center justify-center gap-2 rounded-full border border-sand px-4 text-sm font-bold" aria-label={t('salon.whatsapp')}><MessageCircle className="h-4 w-4" strokeWidth={1.75} /></a>
          </div>
          <section>
            <h3 className="font-sans text-sm font-bold">{t('pro.clients.notes')}</h3>
            <ul className="mt-2 space-y-2">
              {q.data.notes.map((n) => (
                <li key={n.id} className="rounded-card bg-sand-light p-3 text-sm">{n.body}</li>
              ))}
            </ul>
            <form className="mt-3 space-y-2" onSubmit={(e) => { e.preventDefault(); if (note.trim()) add.mutate(); }}>
              <TextArea label={t('pro.clients.addNote')} value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
              <Button type="submit" size="sm" variant="secondary" loading={add.isPending} disabled={!note.trim()}>{t('common.add')}</Button>
            </form>
          </section>
          <section>
            <h3 className="font-sans text-sm font-bold">{t('pro.clients.history')}</h3>
            <ul className="mt-2 divide-y divide-sand text-sm">
              {q.data.appointments.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 py-2">
                  <span className="min-w-0">
                    <span className="block first-letter:uppercase">{fmt.shortDate(a.startsAt, tz)} · {fmt.time(a.startsAt, tz)}</span>
                    <span className="block truncate text-stone">{a.services.map((s) => s.name).join(', ')}</span>
                  </span>
                  <StatusBadge status={a.status} />
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </BottomSheet>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-card bg-sand-light p-3">
      <p className="text-xs text-stone">{label}</p>
      <p className="mt-0.5 font-bold tabular-nums">{value}</p>
    </div>
  );
}
