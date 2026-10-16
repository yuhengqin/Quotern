import { Card } from '@heroui/react';
import { QuotaUsageCard } from './QuotaUsageCard';
import { useQuotaState } from '../hooks/useQuotaState';
import { isQuotaStatusOnly } from '../lib/quota-presentation';

interface SubscriptionUsageGridProps {
  className?: string;
  singleColumn?: boolean;
}

const RESPONSIVE_COLUMNS = [
  'grid-cols-1',
  'grid-cols-1 sm:grid-cols-2',
  'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
  'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4',
];

/** Shared subscription allowance cards used by the desktop dashboard and tray. */
export function SubscriptionUsageGrid({ className = '', singleColumn = false }: SubscriptionUsageGridProps) {
  const { state, error } = useQuotaState();
  if (!state) return error ? <p role="status" className="text-xs text-muted">{error}</p> : null;
  const visible = state.providers.filter(provider => provider.windows.length || provider.details.length || provider.planLabel || provider.fetchedAt || ['expired', 'access-denied', 'custom-provider'].includes(provider.status));
  const allowances = visible.filter(provider => !isQuotaStatusOnly(provider));
  const statuses = visible.filter(isQuotaStatusOnly);
  const itemCount = allowances.length ? allowances.length + Number(statuses.length > 0) : statuses.length;
  const columns = singleColumn ? 'grid-cols-1' : RESPONSIVE_COLUMNS[Math.min(4, Math.max(1, itemCount)) - 1];

  return (
    <section
      aria-label="订阅额度"
      className={`grid items-stretch empty:hidden ${columns} ${className}`.trim()}
    >
      {allowances.map(provider => <QuotaUsageCard key={provider.id} provider={provider} preferences={state.preferences} />)}
      {statuses.length > 0 && <Card data-quota-status-group role="group" aria-label="订阅状态" variant="secondary"
        className={`grid min-w-0 self-start gap-1 overflow-visible p-1 ${allowances.length ? '' : 'col-span-full grid-cols-subgrid'}`.trim()}>
        {statuses.map(provider => <QuotaUsageCard key={provider.id} provider={provider} preferences={state.preferences} statusRow />)}
      </Card>}
      {state.notice && <p role="status" className="col-span-full text-xs text-warning">{state.notice}</p>}
    </section>
  );
}
