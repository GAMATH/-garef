import clsx from 'clsx';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { AppointmentStatus, PaymentStatus } from '@/lib/types';

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'gold' | 'primary';
const tones: Record<Tone, string> = {
  neutral: 'bg-sand-light text-stone',
  success: 'bg-forest-soft text-forest',
  warning: 'bg-gold-soft text-gold-ink',
  danger: 'bg-danger-soft text-danger',
  gold: 'bg-gold-soft text-gold-ink',
  primary: 'bg-terracotta-soft text-terracotta-dark',
};

export function Badge({ tone = 'neutral', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={clsx('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold', tones[tone], className)}>{children}</span>;
}

const statusTone: Record<AppointmentStatus, Tone> = {
  pending_payment: 'warning',
  confirmed: 'primary',
  checked_in: 'gold',
  completed: 'success',
  cancelled: 'neutral',
  no_show: 'danger',
};
export function StatusBadge({ status }: { status: AppointmentStatus }) {
  const { t } = useTranslation();
  return <Badge tone={statusTone[status]}>{t(`status.${status}`)}</Badge>;
}

const payTone: Record<PaymentStatus, Tone> = {
  pending: 'warning',
  deposit_paid: 'gold',
  paid: 'success',
  pay_on_site: 'neutral',
  failed: 'danger',
  refunded: 'neutral',
};
export function PaymentBadge({ status }: { status: PaymentStatus }) {
  const { t } = useTranslation();
  return <Badge tone={payTone[status]}>{t(`paymentStatus.${status}`)}</Badge>;
}

export function DemoBadge() {
  const { t } = useTranslation();
  return <Badge tone="gold">{t('common.demo')}</Badge>;
}
