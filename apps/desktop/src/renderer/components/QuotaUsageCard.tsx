import { QuotaUsageCard as SharedQuotaUsageCard, type QuotaUsageCardProps } from '../../../../../packages/dashboard/src/components/QuotaUsageCard';

export function QuotaUsageCard(props: Omit<QuotaUsageCardProps, 'onRefresh' | 'onOpenExternal'>) {
  return <SharedQuotaUsageCard {...props} onRefresh={id => window.tud.quota.refresh(id)} onOpenExternal={url => window.tud.openExternal(url)} />;
}
