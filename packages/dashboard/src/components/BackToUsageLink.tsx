import { Link } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { useTranslation } from 'quotern-i18n/react';

export function BackToUsageLink() {
  const { t } = useTranslation();
  return <Link to="/dashboard" className="-ml-2 mb-3 inline-flex min-h-10 items-center gap-1.5 rounded-lg px-2 py-2 text-xs text-muted transition-colors hover:bg-surface-secondary hover:text-foreground focus-visible:outline-2 focus-visible:outline-accent">
    <ArrowLeft size={14} aria-hidden="true" />{t('shell.backToUsage')}
  </Link>;
}
