import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Star } from 'lucide-react';
import { useApp } from '@/app/AppContext';
import type { Review } from '@/lib/types';
import { useFormat } from '@/hooks/useFormat';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { Rating } from '@/components/ui/Rating';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ListSkeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { useBusiness } from './BusinessContext';
import { PageHeader } from './BusinessLayout';

export default function Reviews() {
  const { t } = useTranslation();
  const { business, bundle } = useBusiness();
  useDocumentTitle(t('pro.nav.reviews'));
  if (!bundle) return <ListSkeleton rows={4} />;
  return (
    <>
      <PageHeader title={t('pro.nav.reviews')} action={<Rating value={business.ratingAvg} count={business.ratingCount} size="lg" />} />
      {bundle.reviews.length === 0 ? (
        <div className="card"><EmptyState icon={<Star strokeWidth={1.75} />} title={t('pro.reviews.empty')} body={t('pro.reviews.emptyBody')} /></div>
      ) : (
        <ul className="space-y-3">{bundle.reviews.map((r) => <ReviewCard key={r.id} r={r} />)}</ul>
      )}
    </>
  );
}

function ReviewCard({ r }: { r: Review }) {
  const { t } = useTranslation();
  const { api } = useApp();
  const fmt = useFormat();
  const qc = useQueryClient();
  const toast = useToast();
  const [reply, setReply] = useState(r.reply ?? '');
  const [editing, setEditing] = useState(false);
  const m = useMutation({
    mutationFn: () => api.replyReview(r.id, reply),
    onSuccess: () => { toast(t('pro.reviews.replied')); setEditing(false); void qc.invalidateQueries({ queryKey: ['pro'] }); void qc.invalidateQueries({ queryKey: ['salon'] }); },
  });
  return (
    <li className="card p-4">
      <div className="flex items-center gap-2 text-sm">
        <span className="font-bold">{r.authorName}</span>
        <span className="text-gold-ink" aria-label={t('review.stars', { count: r.rating })}>{'★'.repeat(r.rating)}</span>
        <span className="text-stone">· {fmt.date(r.createdAt)}</span>
      </div>
      {r.comment && <p className="mt-1">{r.comment}</p>}
      {r.reply && !editing ? (
        <div className="mt-3 border-l-2 border-sand pl-3 text-sm">
          <p className="text-stone"><span className="font-bold text-ink">{t('review.salonReply')}</span> {r.reply}</p>
          <button type="button" className="mt-1 min-h-tap text-sm font-bold" onClick={() => setEditing(true)}>{t('common.edit')}</button>
        </div>
      ) : editing || !r.reply ? (
        <form className="mt-3 flex flex-col gap-2 sm:flex-row" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
          <input className="field flex-1" placeholder={t('pro.reviews.replyPlaceholder')} aria-label={t('pro.reviews.reply')} value={reply} onChange={(e) => setReply(e.target.value)} maxLength={500} />
          <Button type="submit" variant="secondary" loading={m.isPending} disabled={!reply.trim()}>{t('pro.reviews.reply')}</Button>
        </form>
      ) : null}
    </li>
  );
}
