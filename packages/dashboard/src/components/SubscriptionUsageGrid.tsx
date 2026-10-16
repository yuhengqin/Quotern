import { Card } from '@heroui/react';
import { QuotaUsageCard } from './QuotaUsageCard';
import { useQuotaState } from '../hooks/useQuotaState';
import { isQuotaStatusOnly } from '../lib/quota-presentation';

export function SubscriptionUsageGrid({ className = '' }: { className?: string }) {
  const { state, error, refresh } = useQuotaState();
  if (!state) return error ? <p role="status" className="mt-4 text-xs text-muted">{error}</p> : null;
  const visible = state.providers.filter(provider => provider.windows.length || provider.details.length || provider.planLabel || provider.fetchedAt || ['expired', 'access-denied', 'custom-provider'].includes(provider.status));
  const allowances = visible.filter(provider => !isQuotaStatusOnly(provider));
  const statuses = visible.filter(isQuotaStatusOnly);
  return <section aria-label="订阅额度" className={`grid items-stretch empty:hidden ${className}`.trim()}>
    {allowances.map(provider => <QuotaUsageCard key={provider.id} provider={provider} preferences={state.preferences} onRefresh={refresh} />)}
    {statuses.length > 0 && <Card data-quota-status-group role="group" aria-label="订阅状态" variant="secondary" className={`grid min-w-0 self-start gap-1 overflow-visible p-1 ${allowances.length ? '' : 'col-span-full grid-cols-subgrid'}`.trim()}>
      {statuses.map(provider => <QuotaUsageCard key={provider.id} provider={provider} preferences={state.preferences} statusRow onRefresh={refresh} />)}
    </Card>}
    {(error || state.notice) && <p role="status" className="col-span-full text-xs text-warning">{error ?? state.notice}</p>}
  </section>;
}
