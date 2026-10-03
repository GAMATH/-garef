import { useTranslation } from 'react-i18next';
import { Compass } from 'lucide-react';
import { EmptyState } from '@/components/ui/EmptyState';
import { ButtonLink } from '@/components/ui/Button';

export default function NotFound() {
  const { t } = useTranslation();
  return <EmptyState icon={<Compass strokeWidth={1.75} />} title={t('notFound.title')} body={t('notFound.body')} action={<ButtonLink to="/">{t('notFound.cta')}</ButtonLink>} />;
}
