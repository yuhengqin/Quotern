import { Button } from '@heroui/react';
import { useTranslation } from 'quotern-i18n/react';

export function DashboardViewControl({ quick, onChange }: { quick: boolean; onChange: (quick: boolean) => void }) {
  const { t } = useTranslation();
  return <div role="group" aria-label={t('island.dashboard.view')} className="mb-3 flex flex-wrap justify-end gap-1">
    {[true, false].map(value => <Button key={String(value)} size="sm" variant={quick === value ? 'secondary' : 'tertiary'} aria-pressed={quick === value} onPress={() => onChange(value)}>{t(value ? 'island.dashboard.quick' : 'island.dashboard.full')}</Button>)}
  </div>;
}
