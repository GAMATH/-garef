import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle } from 'lucide-react';
import { Button } from './Button';

export function EmptyState({ icon, title, body, action }: { icon?: ReactNode; title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center animate-fade-up">
      {icon && <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-sand-light text-stone">{icon}</div>}
      <p className="font-display text-lg font-semibold">{title}</p>
      {body && <p className="mt-1 max-w-sm text-stone">{body}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

export function ErrorState({ onRetry, message }: { onRetry?: () => void; message?: string }) {
  const { t } = useTranslation();
  return (
    <EmptyState
      icon={<AlertCircle strokeWidth={1.75} />}
      title={t('errors.title')}
      body={message ?? t('errors.body')}
      action={onRetry && <Button variant="secondary" onClick={onRetry}>{t('common.retry')}</Button>}
    />
  );
}
