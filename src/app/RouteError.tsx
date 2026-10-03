import { useTranslation } from 'react-i18next';
import { ErrorState } from '@/components/ui/EmptyState';

export function RouteError() {
  const { t } = useTranslation();
  return (
    <div className="container-app py-16">
      <ErrorState message={t('errors.body')} onRetry={() => window.location.reload()} />
    </div>
  );
}
