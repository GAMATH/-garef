import { WifiOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useOnline } from '@/hooks/useOnline';

export function OfflineBanner() {
  const online = useOnline();
  const { t } = useTranslation();
  if (online) return null;
  return (
    <div className="sticky top-0 z-40 flex items-center justify-center gap-2 bg-ink px-4 py-2 text-sm text-ivory" role="status">
      <WifiOff className="h-4 w-4" strokeWidth={1.75} aria-hidden />
      {t('common.offline')}
    </div>
  );
}
