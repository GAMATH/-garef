import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useApp } from '@/app/AppContext';
import type { AppointmentView } from '@/lib/types';
import { BottomSheet } from '../ui/BottomSheet';
import { StarInput } from '../ui/Rating';
import { TextArea } from '../ui/Field';
import { Button } from '../ui/Button';
import { useToast } from '../ui/Toast';

export function ReviewSheet({ appointment, onClose }: { appointment: AppointmentView | null; onClose: () => void }) {
  const { t } = useTranslation();
  const { api, profile } = useApp();
  const qc = useQueryClient();
  const toast = useToast();
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const m = useMutation({
    mutationFn: () => api.createReview({ appointmentId: appointment!.id, rating, comment, profileId: profile!.id }),
    onSuccess: () => {
      toast(t('review.thanks'));
      void qc.invalidateQueries({ queryKey: ['me'] });
      void qc.invalidateQueries({ queryKey: ['salon', appointment!.business.slug] });
      setRating(0);
      setComment('');
      onClose();
    },
    onError: () => toast(t('errors.generic'), 'error'),
  });
  return (
    <BottomSheet
      open={!!appointment}
      onClose={onClose}
      title={t('review.title', { salon: appointment?.business.name ?? '' })}
      footer={<Button block size="lg" disabled={!rating} loading={m.isPending} onClick={() => m.mutate()}>{t('review.submit')}</Button>}
    >
      <p className="label">{t('review.rating')}</p>
      <StarInput value={rating} onChange={setRating} />
      <div className="mt-5">
        <TextArea label={t('review.commentOptional')} maxLength={1000} value={comment} onChange={(e) => setComment(e.target.value)} />
      </div>
    </BottomSheet>
  );
}
